# WebSocket OSC Hub

**WebSocket OSC Hub** is a minimal system for sharing OSC messages between multiple [SuperCollider](https://supercollider.github.io/) instances over the internet via WebSocket.

Performers send OSC commands (`/d_recv`, `/s_new`, `/n_set`, `/n_free`, `sendBundle`, etc.) from their local SC environment through a hub server, where they are broadcast to all other participants in the same room. OSC messages and Bundles are both supported — the hub rewrites addresses in each, while preserving timetags in Bundles for synchronised playback.

An audience client (**Radio SCOSC**) allows listeners to join a session and hear the performance without any SC coding knowledge.

---

## Architecture

```
[SC] <--OSC/UDP--> [local.py] <--wss (binary)--> [hub.py] <--wss (binary)--> [local.py] <--OSC/UDP--> [SC]
                                                      |
                                               [Radio SCOSC]
                                     (Electron app — requires SuperCollider)
```

OSC packets are forwarded as binary frames over WebSocket. The hub rewrites the OSC address of each message to `/remote/<sender_name>/addr` before broadcasting. OSC Bundles are parsed recursively — each contained message address is rewritten while the bundle timetag is preserved, allowing performers to synchronise rhythm and tempo across remote locations using `sendBundle`.

---

## Repository Structure

```
websocket-osc-hub/
├── hub.py            # Hub server (run on a VPS or server)
├── local.py          # Local bridge for performers
├── requirements.txt  # Python dependencies
├── LICENSE
├── README.md
└── radio-scosc/      # Radio SCOSC app (Electron)
    ├── main.js
    ├── preload.js
    ├── renderer.html
    ├── renderer.js
    └── package.json
```

---

## Demo

A public demo Hub is running at `live.oschub.asia`. Note that this server may not always be accessible.

```bash
python local.py live.oschub.asia
```

---

## Requirements

### Hub server
- Python 3.10+
- A server with a domain name and TLS certificate (e.g. Let's Encrypt)
- Nginx (or equivalent) as a reverse proxy for wss://

### Performer (local.py)
- Python 3.10+
- SuperCollider 3.x

### Radio SCOSC
- **SuperCollider 3.x** (required)
- Node.js 18+ (development/build only)

---

## Setup

### 1. Hub server

Install dependencies:

```bash
pip install -r requirements.txt
```

Run:

```bash
python hub.py --port 8765
```

Additional options (all optional):

| Option | Default | Description |
|--------|---------|-------------|
| `--port` | 8765 | Hub listen port |
| `--no-rewrite` | — | Disable OSC address rewriting (pass frames verbatim) |
| `--max-msg-size` | 65536 | Max OSC message size in bytes per message |
| `--rate-limit` | 200 | Max messages per second per client |
| `--log-level` | INFO | Log level: `DEBUG`, `INFO`, `WARNING`, `ERROR` |

#### Nginx configuration example (wss://)

```nginx
server {
    listen 443 ssl;
    server_name your-hub-domain.example.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

#### systemd service (optional)

```ini
[Unit]
Description=WebSocket OSC Hub
After=network.target

[Service]
User=youruser
WorkingDirectory=/path/to/websocket-osc-hub
ExecStart=/usr/bin/python hub.py --port 8765
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

---

### 2. Performer (local.py)

Install dependencies:

```bash
pip install -r requirements.txt
```

Run:

```bash
python local.py your-hub-domain.example.com
```

Options:

| Option | Default | Description |
|--------|---------|-------------|
| `server` | *(required)* | Hub server hostname |
| `--port` | 443 | Hub server port |
| `--sc-port` | 57120 | SC receive port |
| `--osc-port` | 57121 | Local OSC receive port |
| `--rate` | 48000 | Session sample rate (for confirmation only) |
| `--name` | *(prompted)* | Your name in the session |
| `--room` | *(prompted)* | Room name to join |

If `--name` or `--room` are omitted, you will be prompted for them on startup. Each participant's name must be unique within a room and must not contain `/` — if the name is already in use or invalid the hub will reject the connection.

#### SuperCollider setup for performers

Each performer must have the following OSCdef running in SC before the session starts. This receives OSC from other performers (delivered via local.py to port 57120) and forwards it to scsynth.

```supercollider
// Receive OSC from remote performers, strip the /remote/<name>/ prefix, and forward to scsynth
OSCdef(\remoteProxy, { |msg, time, addr|
    var parts = msg[0].asString.split($/).reject({ |s| s.isEmpty });
    if(parts.size >= 3 && { parts[0] == "remote" }, {
        var cmd = ("/" ++ parts[2..].join("/")).asSymbol;
        s.addr.sendMsg(cmd, *msg[1..]);
    });
}, nil);
```

A typical session setup:

```supercollider
s.waitForBoot({

    // 1. Set up the remote proxy
    OSCdef(\remoteProxy, { |msg, time, addr|
        var parts = msg[0].asString.split($/).reject({ |s| s.isEmpty });
        if(parts.size >= 3 && { parts[0] == "remote" }, {
            var cmd = ("/" ++ parts[2..].join("/")).asSymbol;
            s.addr.sendMsg(cmd, *msg[1..]);
        });
    }, nil);

    // 2. Send your SynthDef to all participants
    ~hub = NetAddr("127.0.0.1", 57121);
    ~hub.sendMsg("/d_recv", SynthDef(\sine, { |freq=440, amp=0.2|
        Out.ar(0, SinOsc.ar(freq) * amp * EnvGen.kr(Env.perc, doneAction:2))
    }).asBytes);

    // 3. Play with sendBundle for tight timing across the network
    ~hub.sendBundle(0.3, ["/s_new", \sine, 2000, 0, 0, \freq, 432]);
});
```

> **Note on node IDs:** Node IDs are not managed automatically. Performers should coordinate in advance to avoid conflicts (e.g. Alice uses 1000–1999, Bob uses 2000–2999).

---

### 3. Radio SCOSC

Radio SCOSC can be used by both listeners and performers.

#### Automatic mode detection

Radio SCOSC checks whether scsynth is already running when Join is pressed:

| Situation | Mode | Behaviour |
|-----------|------|-----------|
| scsynth **not** running | **Listener** | Launches sclang to boot scsynth, then forwards hub OSC to sclang (port 57120). sclang's `OSCdef(\remoteProxy)` strips the sender prefix and relays the original command to scsynth. |
| scsynth **already** running | **Performer** | Does NOT launch sclang. Forwards hub OSC to the existing sclang (port 57120). OSCdef must be run manually in the editor to relay OSC to scsynth. |

In both modes, Radio SCOSC also listens on UDP port 57121 for OSC from SC and forwards it to the hub.

#### For performers using Radio SCOSC

Performers can use Radio SCOSC instead of local.py. In this case:

1. **Boot the SC server first** in your editor (SCIDE, vim/scnvim, Emacs/scel, Overtone, Supriya, etc.) before launching Radio SCOSC.
2. Run the following OSCdef in your editor:

```supercollider
OSCdef(\remoteProxy, { |msg, time, addr|
    var parts = msg[0].asString.split($/).reject({ |s| s.isEmpty });
    if(parts.size >= 3 && { parts[0] == "remote" }, {
        var cmd = ("/" ++ parts[2..].join("/")).asSymbol;
        s.addr.sendMsg(cmd, *msg[1..]);
    });
}, nil);
```

> **Overtone / Supriya users:** The OSCdef approach above is specific to sclang. OSC handling varies by implementation in Overtone and Supriya. Refer to each project's documentation for the appropriate OSC receive patterns.

3. Launch Radio SCOSC and join the session.
4. Send OSC to port 57121 (Radio SCOSC) instead of local.py:

```supercollider
~hub = NetAddr("127.0.0.1", 57121);
~hub.sendMsg("/d_recv", SynthDef(\sine, { |freq=440, amp=0.2|
    Out.ar(0, SinOsc.ar(freq) * amp * EnvGen.kr(Env.perc, doneAction:2))
}).asBytes);
~hub.sendBundle(0.3, ["/s_new", \sine, 2000, 0, 0, \freq, 432]);
```

> **Important:** Always boot the SC server in your editor **before** launching Radio SCOSC. If Radio SCOSC is launched without a running scsynth, it will start its own scsynth instance (listener mode), which will conflict with your editor's server.

#### Prerequisites

- **SuperCollider must be installed** on the machine.
- Radio SCOSC detects sclang automatically at the following default paths:

| Platform | Default path |
|----------|-------------|
| macOS | `/Applications/SuperCollider.app/Contents/MacOS/sclang` |
| Windows | `C:\Program Files\SuperCollider\sclang.exe` |
| Linux | detected via `which sclang` |

#### Run (development)

```bash
cd radio-scosc
npm install
npm start
```

#### Build

```bash
npm run build:mac    # macOS DMG
npm run build:win    # Windows installer
npm run build:linux  # Linux AppImage
```

#### Usage

1. Install SuperCollider.
2. *(Performer only)* Boot the SC server and run `OSCdef(\remoteProxy, ...)` in your editor first.
3. Launch Radio SCOSC.
4. Enter the hub server address (e.g. `wss://live.example.com` or just `live.example.com`), room name, and sample rate.
5. **Name field:**
   - **Performer mode** (scsynth already running): enter your name. Must be unique in the room and must not contain `/`.
   - **Listener mode** (scsynth not running): the name field is ignored — a random `listener-XXXX` name is assigned automatically.
6. Click **Join**.

#### /who command

Any participant can query the current room membership by sending an OSC `/who` message to the hub:

```supercollider
~hub = NetAddr("127.0.0.1", 57121);
~hub.sendMsg('/who');
```

The hub replies with a `/who/reply` OSC message containing the names of all current participants as string arguments. The same `/who/reply` is also sent automatically at join time, so the `OSCdef` below will fire on connection without needing an explicit `/who`:

```supercollider
OSCdef(\whoReply, { |msg|
    var names = msg[1..];
    ("Participants: " ++ names.join(", ")).postln;
}, '/who/reply');
```

---

## Sample Rate

All participants (performers and listeners) must use the same sample rate. Mismatches will cause scsynth startup errors.

Common rates: **44100**, **48000**, **96000** Hz.

| Platform | How to set |
|----------|-----------|
| macOS | CoreAudio adjusts automatically in most cases |
| Windows | Control Panel → Sound → Properties → Advanced |
| Linux | Set in JACK (e.g. via qjackctl) before starting |

---

## License

WebSocket OSC Hub is released under the [GNU General Public License v3.0](LICENSE), in accordance with SuperCollider.
