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

# --- Arguments ---
parser = argparse.ArgumentParser(description="OSC WebSocket hub for Radio SCOSC")
parser.add_argument("--host", default="0.0.0.0", help="Bind address (default: 0.0.0.0)")
parser.add_argument("--port", type=int, default=8765, help="Port (default: 8765)")
parser.add_argument("--no-rewrite", action="store_true",
                    help="Disable OSC address rewriting (pass frames through verbatim)")
args = parser.parse_args()


# --- OSC address rewriting ---

def _pad4(n: int) -> int:
    """Round n up to the nearest multiple of 4 (OSC alignment)."""
    return (n + 3) & ~3


def rewrite_bundle(data: bytes, sender_name: str) -> bytes:
    """Recursively rewrite OSC addresses within an OSC bundle.

    Preserves the bundle header (including timetag) and rewrites each
    contained OSC message address. Nested bundles are handled recursively.
    Returns the original data unchanged on any parse error.
    """
    if len(data) < 16:
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
        rewritten = rewrite_osc_address(elem, sender_name)
        result += struct.pack('>I', len(rewritten)) + rewritten
    return result


def rewrite_osc_address(data: bytes, sender_name: str) -> bytes:
    """Rewrite an OSC message address from /addr to /remote/<sender_name>/addr.

    OSC bundles are handled by rewrite_bundle (timetag preserved, each
    contained message address is rewritten recursively).
    Returns the original data unchanged on any parse error.
    """
    if len(data) < 4:
        return data
    # OSC bundles: rewrite each contained message, preserving timetag
    if data[:7] == b'#bundle':
        return rewrite_bundle(data, sender_name)
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
    print(f"Connection attempt from {client_ip}")

    room = None
    name = None

    try:
        # First message must be a JSON join
        raw = await asyncio.wait_for(ws.recv(), timeout=10)

        if isinstance(raw, bytes):
            print(f"Invalid first message (binary) from {client_ip}")
            await ws.close()
            return

        data = json.loads(raw)
        if data.get("type") != "join":
            print(f"Invalid first message from {client_ip}: {data}")
            await ws.close()
            return

        name = data.get("name", "unknown")
        room = data.get("room", "default")

        if room not in rooms:
            rooms[room] = {}

        if name in rooms[room].values():
            print(f"[!] '{name}' rejected from '{room}': name already in use")
            await send_text(ws, {"type": "error", "message": f"Name '{name}' is already in use in room '{room}'"})
            await ws.close()
            return

        rooms[room][ws] = name

        member_names = list(rooms[room].values())
        print(f"[+] '{name}' joined '{room}' | members: {member_names}")

        await send_text(ws, {
            "type": "info",
            "message": f"Members in '{room}': {', '.join(member_names)}"
        })
        await broadcast_info(room, f"{name} joined", exclude=ws)

        # Relay subsequent binary OSC frames (with optional address rewriting)
        async for message in ws:
            if isinstance(message, bytes):
                targets = [c for c in rooms[room] if c != ws]
                if targets:
                    outgoing = message if args.no_rewrite else rewrite_osc_address(message, name)
                    await asyncio.gather(
                        *[send_binary(c, outgoing) for c in targets],
                        return_exceptions=True
                    )

    except asyncio.TimeoutError:
        print(f"[-] Timeout during join from {client_ip}")
    except websockets.exceptions.ConnectionClosedError:
        pass
    finally:
        if room and ws in rooms.get(room, {}):
            del rooms[room][ws]
            if not rooms[room]:
                del rooms[room]
            print(f"[-] '{name}' left '{room}'")
            await broadcast_info(room, f"{name} left")


async def main():
    print(f"Radio SCOSC hub started on ws://{args.host}:{args.port}")
    async with websockets.serve(handler, args.host, args.port):
        await asyncio.Future()


asyncio.run(main())
