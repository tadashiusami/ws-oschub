# WebSocket OSC Hub

**WebSocket OSC Hub** is a minimal system for sharing OSC messages between multiple [SuperCollider](https://supercollider.github.io/) instances over the internet via WebSocket.

Performers send OSC commands (`/d_recv`, `/s_new`, `/n_set`, `/n_free`, `sendBundle`, etc.) from their local SC environment through a hub server, where they are broadcast to all other participants in the same room. OSC data is forwarded as raw binary, so all OSC message types including Bundles with timetags are supported.

An audience client (**Radio SCOSC**) allows listeners to join a session and hear the performance without any SC coding knowledge.

---

## Architecture

```
[SC] <--OSC/UDP--> [local.py] <--wss (binary)--> [hub.py] <--wss (binary)--> [local.py] <--OSC/UDP--> [SC]
                                                      |
                                               [Radio SCOSC]
                                         (Electron app + scsynth)
```

OSC packets are forwarded as raw binary frames over WebSocket. The hub relays them without parsing. This means OSC Bundles with timetags are preserved, allowing performers to synchronise rhythm and tempo across remote locations using `sendBundle`.

---

## Repository Structure

```
websocket-osc-hub/
├── hub.py            # Hub server (run on a VPS or server)
├── local.py          # Local bridge for performers
├── requirements.txt  # Python dependencies
├── LICENSE
├── README.md
└── radio-scosc/      # Radio SCOSC listener app (Electron)
    ├── main.js
    ├── preload.js
    ├── renderer.html
    ├── renderer.js
    ├── package.json
    └── sc/
        ├── scsynth        # Place macOS/Linux binary here
        └── scsynth.exe    # Place Windows binary here
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

### Radio SCOSC listener app
- Node.js 18+ (development only)
- A copy of the `scsynth` binary for your platform (see below)

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

You will be prompted for your name and room name on startup.

#### SuperCollider usage

```supercollider
// Send OSC to local.py (port 57121)
~hub = NetAddr("127.0.0.1", 57121);

// Send a SynthDef
~hub.sendMsg("/d_recv", SynthDef(\sine, { |freq=440|
    Out.ar(0, SinOsc.ar(freq) * 0.2 * EnvGen.kr(Env.perc, doneAction:2))
}).asBytes);

// Create, modify and free a synth
~hub.sendMsg("/s_new", \sine, 2000, 0, 0, \freq, 432);
~hub.sendMsg("/n_set", 2000, \freq, 648);
~hub.sendMsg("/n_free", 2000);

// Synchronise timing with sendBundle
// All participants receive the bundle with its timetag intact,
// so scsynth executes it at the same moment on every machine
// (requires NTP-synchronised system clocks, which is standard on modern OS)
~hub.sendBundle(0.3, ["/s_new", \sine, 2000, 0, 0, \freq, 432]);
```

> **Note on node IDs:** Node IDs are not managed automatically. Performers should coordinate in advance to avoid conflicts (e.g. Alice uses 1000–1999, Bob uses 2000–2999).

---

### 3. Radio SCOSC (listener app)

#### Prerequisites

1. Place the `scsynth` binary for your platform in `radio-scosc/sc/`:
   - macOS/Linux: `radio-scosc/sc/scsynth`
   - Windows: `radio-scosc/sc/scsynth.exe`
   - The binary is included in your SuperCollider installation (`SuperCollider.app/Contents/Resources/scsynth` on macOS).

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

1. Launch the app.
2. Enter the hub server address, room name, and sample rate.
3. Click **Join** — audio will play automatically when performers send sound.

> **Important:** Set your OS audio sample rate to match the session rate before launching. On Linux, ensure JACK is running at the same rate.

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
