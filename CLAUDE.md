# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WebSocket OSC Hub: a distributed relay system for live networked SuperCollider performances. OSC messages are forwarded as raw binary WebSocket frames between performers, preserving timetags in OSC Bundles for synchronized timing.

## Components

- **`hub.py`** — Central WebSocket relay server. Manages rooms; broadcasts binary OSC frames to all members of a room.
- **`local.py`** — CLI performer bridge. Bidirectional UDP↔WebSocket relay between local SuperCollider (port 57120/57121) and the hub.
- **`radio-scosc/`** — Electron desktop app. Serves both listener and performer roles; auto-detects running scsynth to choose mode.

## Running

```bash
# Hub server
pip install -r requirements.txt
python hub.py [--host 0.0.0.0] [--port 8765] [--no-rewrite]

# Performer bridge
python local.py <hub-hostname> [--port 443] [--sc-port 57120] [--osc-port 57121]

# Electron app (development)
cd radio-scosc && npm install && npm start

# Electron app (distribution builds)
npm run build:linux   # AppImage
npm run build:mac     # DMG
npm run build:win     # NSIS installer
```

## Architecture

**Protocol:**
1. Client connects and sends JSON join: `{"type": "join", "name": "...", "room": "..."}`
2. Subsequent binary frames are OSC packets — hub rewrites the address before broadcasting:
   - OSC messages: `/original/addr` → `/remote/<sender_name>/original/addr`
   - OSC bundles (`#bundle`): each contained message address is rewritten recursively; timetag is preserved
3. Text frames from hub are info messages: `{"type": "info", "message": "..."}`

**OSC address rewriting** (`hub.py`): the hub prefixes every outgoing OSC message address with `/remote/<sender_name>` so receivers can identify the sender without additional metadata. Disable with `--no-rewrite` for verbatim pass-through.

SuperCollider performers can match incoming messages by sender using the exact rewritten path:
```supercollider
OSCdef(\aliceNote, { |msg| msg.postln }, '/remote/alice/note');
// or match all remote messages with nil (match-all) and filter manually:
OSCdef(\anyRemote, { |msg|
    var parts = msg[0].asString.split($/).reject({ |s| s.isEmpty });
    if(parts.size >= 3 && { parts[0] == "remote" }, { msg.postln });
}, nil);
```

**Port conventions:**
- `57110` — scsynth
- `57120` — sclang (Radio SCOSC sends here in both modes; local.py default SC port)
- `57121` — local UDP listener for OSC from SC → hub

**Radio SCOSC mode detection** (`main.js`): sends an OSC `/status` ping to port 57110.
- No response → **listener mode**: launches sclang, boots server, installs `OSCdef(\remoteProxy)` (strips `/remote/<name>/` prefix and forwards to scsynth), routes hub OSC to sclang (57120), quits scsynth on exit
- Response → **performer mode**: no sclang launch, routes hub OSC to sclang (57120), does not quit scsynth on exit

**IPC flow** (Electron): `renderer.js` → `preload.js` context bridge → `main.js` IPC handler `join-room` → WebSocket + UDP I/O

## Key Implementation Notes

- OSC messages are rewritten by hub.py before broadcast: `/addr` → `/remote/<name>/addr`
- OSC bundles are rewritten recursively by hub.py — each contained message address is prefixed; timetag is preserved
- `hub.py` uses `asyncio` + `websockets`; `local.py` uses a daemon thread for UDP + async WebSocket
- Reconnection delay is fixed at 3 seconds in both `local.py` and `main.js`
- All participants in a session must use the same sample rate (44100, 48000, or 96000 Hz)
- sclang init code is written to `/tmp/radio-scosc-init.scd` at runtime
- `radio-scosc/sc/` is an empty directory reserved for bundled SuperCollider binaries
