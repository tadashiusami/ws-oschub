"""
hub.py - WebSocket hub server for Radio SCOSC
Relays OSC binary frames between performers via WebSocket.

Usage:
    python hub.py [--host HOST] [--port PORT] [--no-rewrite]
"""

import asyncio
import websockets
import json
import argparse
import struct
import time
import logging

# --- Arguments ---
parser = argparse.ArgumentParser(description="OSC WebSocket hub for Radio SCOSC")
parser.add_argument("--host", default="0.0.0.0", help="Bind address (default: 0.0.0.0)")
parser.add_argument("--port", type=int, default=8765, help="Port (default: 8765)")
parser.add_argument("--no-rewrite", action="store_true",
                    help="Disable OSC address rewriting (pass frames through verbatim)")
parser.add_argument("--max-msg-size", type=int, default=65536,
                    help="Max OSC message size in bytes per message (default: 65536)")
parser.add_argument("--rate-limit", type=int, default=200,
                    help="Max messages per second per client (default: 200)")
parser.add_argument("--log-level", default="INFO",
                    choices=["DEBUG", "INFO", "WARNING", "ERROR"],
                    help="Log level (default: INFO)")
args = parser.parse_args()

logging.basicConfig(
    level=getattr(logging, args.log_level.upper()),
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger("oschub")


# --- OSC helpers ---

def _pad4(n: int) -> int:
    """Round n up to the nearest multiple of 4 (OSC alignment)."""
    return (n + 3) & ~3


def parse_osc_address(data: bytes) -> str:
    """Extract the OSC address string from a raw OSC message."""
    if not data or data[0:1] != b'/':
        return ''
    try:
        return data[:data.index(b'\x00')].decode('utf-8')
    except (ValueError, UnicodeDecodeError):
        return ''


def encode_osc_string(s: str) -> bytes:
    """Encode a string in OSC format (null-terminated, padded to 4 bytes)."""
    b = s.encode('utf-8') + b'\x00'
    return b + b'\x00' * ((4 - len(b) % 4) % 4)


def build_osc_message(address: str, *args: str) -> bytes:
    """Build a minimal OSC message with zero or more string arguments."""
    msg = encode_osc_string(address)
    msg += encode_osc_string(',' + 's' * len(args))
    for arg in args:
        msg += encode_osc_string(str(arg))
    return msg


def rewrite_bundle(data: bytes, sender_name: str, _depth: int = 0) -> bytes:
    """Recursively rewrite OSC addresses within an OSC bundle.

    Preserves the bundle header (including timetag) and rewrites each
    contained OSC message address. Nested bundles are handled recursively.
    Returns the original data unchanged on any parse error.
    """
    if _depth > 8 or len(data) < 16:
        return data
    # '#bundle\0' (8 bytes) + timetag (8 bytes)
    header = data[:16]
    pos = 16
    result = header
    while pos + 4 <= len(data):
        size = struct.unpack('>I', data[pos:pos + 4])[0]
        pos += 4
        if pos + size > len(data):
            break
        elem = data[pos:pos + size]
        pos += size
        rewritten = rewrite_osc_address(elem, sender_name, _depth + 1)
        result += struct.pack('>I', len(rewritten)) + rewritten
    return result


def rewrite_osc_address(data: bytes, sender_name: str, _depth: int = 0) -> bytes:
    """Rewrite an OSC message address from /addr to /remote/<sender_name>/addr.

    OSC bundles are handled by rewrite_bundle (timetag preserved, each
    contained message address is rewritten recursively).
    Returns the original data unchanged on any parse error.
    """
    if len(data) < 4:
        return data
    # OSC bundles: rewrite each contained message, preserving timetag
    if data[:7] == b'#bundle':
        return rewrite_bundle(data, sender_name, _depth)
    # OSC messages must start with '/'
    if data[0:1] != b'/':
        return data
    try:
        null_pos = data.index(b'\x00')
        original_addr = data[:null_pos].decode('utf-8')
        old_padded = _pad4(null_pos + 1)

        new_addr = f"/remote/{sender_name}{original_addr}"
        new_addr_bytes = new_addr.encode('utf-8')
        new_padded = _pad4(len(new_addr_bytes) + 1)

        # Build padded address block (null-terminated, 4-byte aligned)
        addr_block = new_addr_bytes + b'\x00' * (new_padded - len(new_addr_bytes))
        return addr_block + data[old_padded:]
    except (ValueError, UnicodeDecodeError):
        return data


def bundle_contains_who(data: bytes, _depth: int = 0) -> bool:
    """Return True if data is an OSC bundle that contains a /who message."""
    if _depth > 8:
        return False
    if data[:7] != b'#bundle' or len(data) < 16:
        return False
    pos = 16
    while pos + 4 <= len(data):
        size = struct.unpack('>I', data[pos:pos + 4])[0]
        pos += 4
        if pos + size > len(data):
            break
        elem = data[pos:pos + size]
        pos += size
        if elem[:7] == b'#bundle':
            if bundle_contains_who(elem, _depth + 1):
                return True
        elif parse_osc_address(elem) == '/who':
            return True
    return False


# room name -> {ws: name}
rooms: dict[str, dict] = {}


async def send_text(ws, data: dict):
    try:
        await ws.send(json.dumps(data))
    except Exception:
        pass


async def send_binary(ws, data: bytes):
    try:
        await ws.send(data)
    except Exception:
        pass


async def broadcast_info(room, message, exclude=None):
    for ws in list(rooms.get(room, {}).keys()):
        if ws != exclude:
            await send_text(ws, {"type": "info", "message": message})


async def handler(ws):
    client_ip = ws.remote_address[0]
    logger.info(f"Connection attempt from {client_ip}")

    room = None
    name = None

    try:
        # First message must be a JSON join
        raw = await asyncio.wait_for(ws.recv(), timeout=10)

        if isinstance(raw, bytes):
            logger.warning(f"Invalid first message (binary) from {client_ip}")
            await ws.close()
            return

        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            logger.warning(f"Invalid JSON from {client_ip}")
            await ws.close()
            return
        if not isinstance(data, dict):
            logger.warning(f"Invalid JSON structure from {client_ip}")
            await ws.close()
            return
        if data.get("type") != "join":
            logger.warning(f"Invalid first message from {client_ip}: {data}")
            await ws.close()
            return

        name = data.get("name", "unknown")
        room = data.get("room", "default")

        if '/' in name:
            logger.warning(f"[!] Invalid name from {client_ip}: '/' not allowed")
            await send_text(ws, {"type": "error", "message": "Name must not contain '/'"})
            await ws.close()
            return

        if room not in rooms:
            rooms[room] = {}

        if name in rooms[room].values():
            logger.warning(f"[!] '{name}' rejected from '{room}': name already in use")
            await send_text(ws, {"type": "error", "message": f"Name '{name}' is already in use in room '{room}'"})
            await ws.close()
            return

        rooms[room][ws] = name

        member_names = list(rooms[room].values())
        logger.info(f"--- [JOIN] Room: {room} | Name: {name} | Members: {member_names} ---")

        await send_text(ws, {
            "type": "info",
            "message": f"Members in '{room}': {', '.join(member_names)}"
        })
        await broadcast_info(room, f"{name} joined", exclude=ws)

        rate_count = 0
        rate_window = 0.0

        # Relay subsequent binary OSC frames (with optional address rewriting)
        async for message in ws:
            if isinstance(message, bytes):
                # Size limit check
                if len(message) > args.max_msg_size:
                    logger.warning(f"[LIMIT] Oversized message ({len(message)} bytes) from '{name}' — dropped")
                    continue
                # Rate limit check
                now = time.monotonic()
                if now - rate_window >= 1.0:
                    rate_count = 0
                    rate_window = now
                rate_count += 1
                if rate_count > args.rate_limit:
                    logger.warning(f"[LIMIT] Rate limit exceeded by '{name}' ({rate_count} msg/s) — dropped")
                    continue

                if parse_osc_address(message) == '/who' or bundle_contains_who(message):
                    # Hub-only: reply with participant list, do not broadcast
                    members = list(rooms[room].values())
                    await send_binary(ws, build_osc_message('/who/reply', *members))
                    logger.info(f"[/who] Replied to '{name}' with {members}")
                else:
                    targets = [c for c in rooms[room] if c != ws]
                    if targets:
                        outgoing = message if args.no_rewrite else rewrite_osc_address(message, name)
                        await asyncio.gather(
                            *[send_binary(c, outgoing) for c in targets],
                            return_exceptions=True
                        )

    except asyncio.TimeoutError:
        logger.warning(f"[-] Timeout during join from {client_ip}")
    except websockets.exceptions.ConnectionClosedError:
        pass
    finally:
        if room and ws in rooms.get(room, {}):
            del rooms[room][ws]
            if not rooms[room]:
                del rooms[room]
            logger.info(f"--- [LEAVE] Room: {room} | Name: {name} ---")
            await broadcast_info(room, f"{name} left")


async def main():
    logger.info(f"Radio SCOSC hub started on ws://{args.host}:{args.port}")
    logger.info(f"Limits: max_msg_size={args.max_msg_size} bytes, rate_limit={args.rate_limit} msg/s")
    async with websockets.serve(handler, args.host, args.port):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
