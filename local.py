"""
local.py - Local OSC <-> WebSocket bridge for Radio SCOSC
Relays OSC messages between SuperCollider and the hub server.

Usage:
    python local.py <server> [--port PORT] [--sc-port PORT] [--osc-port PORT] [--rate RATE]
"""

import asyncio
import websockets
from pythonosc import udp_client, osc_server, dispatcher
import json
import threading
import argparse
import base64

# --- Arguments ---
parser = argparse.ArgumentParser(description="SC <-> WebSocket bridge for Radio SCOSC")
parser.add_argument("server", help="Hub server hostname (e.g. your-server.com)")
parser.add_argument("--port", type=int, default=443, help="Hub server port (default: 443)")
parser.add_argument("--sc-port", type=int, default=57120, help="SC receive port (default: 57120)")
parser.add_argument("--osc-port", type=int, default=57121, help="Local OSC receive port (default: 57121)")
parser.add_argument("--rate", type=int, default=48000,
                    choices=[44100, 48000, 96000],
                    help="Sample rate for confirmation message (default: 48000)")
args = parser.parse_args()

SERVER_WS_URL   = f"wss://{args.server}:{args.port}"
SC_RECEIVE_PORT = args.sc_port
LOCAL_OSC_PORT  = args.osc_port

MY_NAME = input("Your name: ").strip()
MY_ROOM = input("Room name: ").strip()
print(f"Sample rate: {args.rate} Hz  — please boot SC server at the same rate.")

sc_client     = udp_client.SimpleUDPClient("127.0.0.1", SC_RECEIVE_PORT)
ws_connection = None
loop          = None


def osc_handler(address, *args):
    if ws_connection is None:
        return
    serializable_args = []
    for arg in args:
        if isinstance(arg, bytes):
            serializable_args.append({
                "__type__": "bytes",
                "data": base64.b64encode(arg).decode("utf-8")
            })
        else:
            serializable_args.append(arg)

    payload = json.dumps({
        "type":    "osc",
        "address": address,
        "args":    serializable_args
    })
    asyncio.run_coroutine_threadsafe(ws_connection.send(payload), loop)


def start_osc_server():
    d = dispatcher.Dispatcher()
    d.set_default_handler(osc_handler)
    server = osc_server.ThreadingOSCUDPServer(("127.0.0.1", LOCAL_OSC_PORT), d)
    print(f"OSC listening on port {LOCAL_OSC_PORT}")
    server.serve_forever()


async def ws_client():
    global ws_connection, loop
    loop = asyncio.get_event_loop()

    while True:
        try:
            async with websockets.connect(SERVER_WS_URL) as ws:
                ws_connection = ws

                await ws.send(json.dumps({
                    "type": "join",
                    "name": MY_NAME,
                    "room": MY_ROOM
                }))

                async for message in ws:
                    data = json.loads(message)

                    if data["type"] == "info":
                        print(f"[info] {data['message']}")

                    elif data["type"] == "osc":
                        restored_args = []
                        for arg in data["args"]:
                            if isinstance(arg, dict) and arg.get("__type__") == "bytes":
                                restored_args.append(base64.b64decode(arg["data"]))
                            else:
                                restored_args.append(arg)
                        # Forward as /remote with sender name and original address prepended
                        sc_client.send_message("/remote",
                            [data["from"], data["address"]] + restored_args)

        except KeyboardInterrupt:
            print("Shutting down...")
            break
        except Exception as e:
            print(f"Disconnected: {e}. Reconnecting in 3s...")
            ws_connection = None
            await asyncio.sleep(3)


if __name__ == "__main__":
    t = threading.Thread(target=start_osc_server, daemon=True)
    t.start()
    asyncio.run(ws_client())
