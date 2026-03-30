"""
local.py - Local OSC <-> WebSocket bridge for Radio SCOSC
Forwards raw OSC binary between SuperCollider and the hub server.

Usage:
    python local.py <server> [--port PORT] [--sc-port PORT] [--osc-port PORT] [--rate RATE]
                             [--name NAME] [--room ROOM]
"""

import asyncio
import websockets
import socket
import threading
import argparse
import json

# --- Arguments ---
parser = argparse.ArgumentParser(description="SC <-> WebSocket bridge for Radio SCOSC")
parser.add_argument("server", help="Hub server hostname (e.g. your-server.com)")
parser.add_argument("--port",     type=int, default=443,   help="Hub server port (default: 443)")
parser.add_argument("--sc-port",  type=int, default=57120, help="SC receive port (default: 57120)")
parser.add_argument("--osc-port", type=int, default=57121, help="Local OSC receive port (default: 57121)")
parser.add_argument("--rate", type=int, default=48000,
                    choices=[44100, 48000, 96000],
                    help="Sample rate for confirmation message (default: 48000)")
parser.add_argument("--name", default=None, help="Your name (prompted if omitted)")
parser.add_argument("--room", default=None, help="Room name (prompted if omitted)")
args = parser.parse_args()

SERVER_WS_URL   = f"wss://{args.server}:{args.port}"
SC_RECEIVE_PORT = args.sc_port
LOCAL_OSC_PORT  = args.osc_port

MY_NAME = args.name if args.name else input("Your name: ").strip()
MY_ROOM = args.room if args.room else input("Room name: ").strip()
print(f"Sample rate: {args.rate} Hz  — please boot SC server at the same rate.")

ws_connection = None
loop          = None
sc_send_sock  = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)


# --- Receive raw UDP from SC and forward as binary WebSocket frame ---
def udp_receiver():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", LOCAL_OSC_PORT))
    print(f"OSC listening on port {LOCAL_OSC_PORT}")
    while True:
        data, _ = sock.recvfrom(65536)
        if ws_connection is not None:
            asyncio.run_coroutine_threadsafe(
                ws_connection.send(data),
                loop
            )


# --- WebSocket main loop ---
async def ws_client():
    global ws_connection, loop
    loop = asyncio.get_event_loop()

    join_msg = json.dumps({
        "type": "join",
        "name": MY_NAME,
        "room": MY_ROOM
    })

    while True:
        try:
            async with websockets.connect(SERVER_WS_URL) as ws:
                ws_connection = ws
                await ws.send(join_msg)

                async for message in ws:
                    if isinstance(message, bytes):
                        # Forward binary OSC to SC via UDP
                        sc_send_sock.sendto(message, ("127.0.0.1", SC_RECEIVE_PORT))
                    else:
                        # Text frames are info messages from hub
                        data = json.loads(message)
                        if data.get("type") == "info":
                            print(f"[info] {data['message']}")

        except KeyboardInterrupt:
            print("Shutting down...")
            break
        except Exception as e:
            print(f"Disconnected: {e}. Reconnecting in 3s...")
            ws_connection = None
            await asyncio.sleep(3)


if __name__ == "__main__":
    t = threading.Thread(target=udp_receiver, daemon=True)
    t.start()
    asyncio.run(ws_client())
