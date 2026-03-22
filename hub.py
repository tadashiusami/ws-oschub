"""
hub.py - WebSocket hub server for Radio SCOSC
Relays OSC messages between performers via WebSocket.

Usage:
    python hub.py [--host HOST] [--port PORT]
"""

import asyncio
import websockets
import json
import argparse

# --- Arguments ---
parser = argparse.ArgumentParser(description="OSC WebSocket hub for Radio SCOSC")
parser.add_argument("--host", default="0.0.0.0", help="Bind address (default: 0.0.0.0)")
parser.add_argument("--port", type=int, default=8765, help="Port (default: 8765)")
args = parser.parse_args()

# room name -> {ws: name}
rooms: dict[str, dict] = {}


async def send(ws, data: dict):
    try:
        await ws.send(json.dumps(data))
    except Exception:
        pass


async def broadcast_info(room, message, exclude=None):
    for ws in list(rooms.get(room, {}).keys()):
        if ws != exclude:
            await send(ws, {"type": "info", "message": message})


async def handler(ws):
    client_ip = ws.remote_address[0]
    print(f"Connection attempt from {client_ip}")

    room = None
    name = None

    try:
        raw = await asyncio.wait_for(ws.recv(), timeout=10)
        data = json.loads(raw)

        if data.get("type") != "join":
            print(f"Invalid first message from {client_ip}: {data}")
            await ws.close()
            return

        name = data.get("name", "unknown")
        room = data.get("room", "default")

        if room not in rooms:
            rooms[room] = {}
        rooms[room][ws] = name

        member_names = list(rooms[room].values())
        print(f"[+] '{name}' joined '{room}' | members: {member_names}")

        await send(ws, {
            "type": "info",
            "message": f"Members in '{room}': {', '.join(member_names)}"
        })
        await broadcast_info(room, f"{name} joined", exclude=ws)

        async for message in ws:
            data = json.loads(message)

            if data["type"] == "osc":
                payload = json.dumps({
                    "type": "osc",
                    "from": name,
                    "address": data["address"],
                    "args": data["args"]
                })
                targets = [c for c in rooms[room] if c != ws]
                if targets:
                    await asyncio.gather(
                        *[c.send(payload) for c in targets],
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
