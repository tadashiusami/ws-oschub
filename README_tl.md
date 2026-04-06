# WebSocket OSC Hub

Ang **WebSocket OSC Hub** ay isang minimal na sistema para sa pagbabahagi ng mga OSC mensahe sa pagitan ng maraming [SuperCollider](https://supercollider.github.io/) instance sa pamamagitan ng internet gamit ang WebSocket.

Ang mga performer ay nagpapadala ng mga OSC command (`/d_recv`, `/s_new`, `/n_set`, `/n_free`, `sendBundle`, atbp.) mula sa kanilang lokal na SC environment papunta sa hub server, kung saan ito ay ibino-broadcast sa lahat ng ibang kalahok sa parehong silid. Sinusuportahan ang parehong OSC message at Bundle — ang hub ay nirewrite ang mga address sa bawat isa, habang pinapanatili ang mga timetag sa Bundle para sa naka-synchronize na playback.

Ang audience client (**Radio SCOSC**) ay nagpapahintulot sa mga tagapakinig na sumali sa isang session at marinig ang performance nang hindi nangangailangan ng kaalaman sa SC coding.

---

## Arkitektura

```
[SC] <--OSC/UDP--> [local.py] <--wss (binary)--> [hub.py] <--wss (binary)--> [local.py] <--OSC/UDP--> [SC]
                                                      |
                                               [Radio SCOSC]
                                     (Electron app — nangangailangan ng SuperCollider)
```

Ang mga OSC packet ay ipinoproseso bilang binary frame sa WebSocket. Ang hub ay nirewrite ang OSC address ng bawat mensahe sa `/remote/<sender_name>/addr` bago mag-broadcast. Ang mga OSC Bundle ay na-parse nang recursive — ang address ng bawat nakalamang mensahe ay nirerewrite habang pinapanatili ang bundle timetag, na nagpapahintulot sa mga performer na mag-synchronize ng ritmo at tempo sa magkaibang lokasyon gamit ang `sendBundle`.

---

## Istraktura ng Repository

```
websocket-osc-hub/
├── hub.py            # Hub server (patakbuhin sa VPS o server)
├── local.py          # Lokal na bridge para sa mga performer
├── requirements.txt  # Mga Python dependency
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

Ang pampublikong demo Hub ay tumatakbo sa `live.oschub.asia`. Tandaan na ang server na ito ay maaaring hindi laging accessible.

```bash
python local.py live.oschub.asia
```

---

## Mga Kinakailangan

### Hub server
- Python 3.10+
- Server na may domain name at TLS certificate (hal. Let's Encrypt)
- Nginx (o katumbas) bilang reverse proxy para sa wss://

### Performer (local.py)
- Python 3.10+
- SuperCollider 3.x

### Radio SCOSC
- **SuperCollider 3.x** (kinakailangan)
- Node.js 18+ (para sa development/build lamang)

---

## Setup

### 1. Hub server

I-install ang mga dependency:

```bash
pip install -r requirements.txt
```

Patakbuhin:

```bash
python hub.py --port 8765
```

Karagdagang mga opsyon (lahat ay opsyonal):

| Opsyon | Default | Paglalarawan |
|--------|---------|-------------|
| `--port` | 8765 | Port na pinakikinggan ng hub |
| `--no-rewrite` | — | I-disable ang OSC address rewriting (ipasa nang verbatim ang mga frame) |
| `--max-msg-size` | 65536 | Max na laki ng OSC mensahe sa bytes |
| `--rate-limit` | 200 | Max na mensahe bawat segundo bawat kliyente |
| `--log-level` | INFO | Log level: `DEBUG`, `INFO`, `WARNING`, `ERROR` |

#### Halimbawa ng Nginx configuration (wss://)

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

#### systemd service (opsyonal)

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

I-install ang mga dependency:

```bash
pip install -r requirements.txt
```

Patakbuhin:

```bash
python local.py your-hub-domain.example.com
```

Mga opsyon:

| Opsyon | Default | Paglalarawan |
|--------|---------|-------------|
| `server` | *(kinakailangan)* | Hostname ng hub server |
| `--port` | 443 | Port ng hub server |
| `--sc-port` | 57120 | Port na tinatanggap ng SC |
| `--osc-port` | 57121 | Lokal na port na tinatanggap ng OSC |
| `--rate` | 48000 | Sample rate ng session (para sa kumpirmasyon lamang) |
| `--name` | *(tinanong)* | Iyong pangalan sa session |
| `--room` | *(tinanong)* | Pangalan ng silid na sasalihan |

Kung aalisin ang `--name` o `--room`, tatanungin ka ng programa sa startup. Ang pangalan ng bawat kalahok ay dapat natatangi sa loob ng silid, hindi dapat walang laman, hindi dapat lumampas sa 64 na karakter, at hindi dapat naglalaman ng `/` — kung ang pangalan ay ginagamit na o hindi wasto, ang hub ay tatanggihan ang koneksyon. Ang pangalan ng silid ay hindi rin dapat walang laman at hindi dapat lumampas sa 64 na karakter.

#### SuperCollider setup para sa mga performer

Ang bawat performer ay dapat may sumusunod na receive function na tumatakbo sa SC bago magsimula ang session. Ito ay tumatanggap ng OSC mula sa ibang performer (inihatid ng local.py sa port 57120), tinatanggal ang `/remote/<n>/` prefix na idinagdag ng hub, at ipinapasa sa scsynth na may timetag na pinapanatili upang mapanatili ang timing ng `sendBundle`.

```supercollider
// Receive OSC from remote performers, strip the /remote/<n>/ prefix, and forward to scsynth
// timetag is preserved so sendBundle timing is honoured
~remoteProxy = { |msg, time, addr, recvPort|
    var address = msg[0].asString;
    if(address.beginsWith("/remote/")) {
        var parts = address.split($/).reject({ |s| s.isEmpty });
        var cmd = ("/" ++ parts[2..].join("/")).asSymbol;
        var delta = time - thisThread.seconds;
        if(delta > 0, {
            s.sendBundle(delta, [cmd] ++ msg[1..]);
        }, {
            s.addr.sendMsg(cmd, *msg[1..]);
        });
    };
};
thisProcess.addOSCRecvFunc(~remoteProxy);

// To remove:
// thisProcess.removeOSCRecvFunc(~remoteProxy);
```

Karaniwang setup ng session:

```supercollider
s.waitForBoot({

    // 1. Set up the remote proxy
    ~remoteProxy = { |msg, time, addr, recvPort|
        var address = msg[0].asString;
        if(address.beginsWith("/remote/")) {
            var parts = address.split($/).reject({ |s| s.isEmpty });
            var cmd = ("/" ++ parts[2..].join("/")).asSymbol;
            var delta = time - thisThread.seconds;
            if(delta > 0, {
                s.sendBundle(delta, [cmd] ++ msg[1..]);
            }, {
                s.addr.sendMsg(cmd, *msg[1..]);
            });
        };
    };
    thisProcess.addOSCRecvFunc(~remoteProxy);

    // 2. Ipadala ang iyong SynthDef sa lahat ng kalahok
    ~hub = NetAddr("127.0.0.1", 57121);
    ~hub.sendMsg("/d_recv", SynthDef(\sine, { |freq=440, amp=0.2|
        Out.ar(0, SinOsc.ar(freq) * amp * EnvGen.kr(Env.perc, doneAction:2))
    }).asBytes);

    // 3. Mag-play gamit ang sendBundle para sa mahigpit na timing sa network
    ~hub.sendBundle(0.3, ["/s_new", \sine, 2000, 0, 0, \freq, 432]);
});
```

> **Tandaan tungkol sa node ID:** Ang mga node ID ay hindi awtomatikong pinamamahalaan. Ang mga performer ay dapat mag-coordinate nang maaga upang maiwasan ang mga conflict (hal. si Alice ay gumagamit ng 1000–1999, si Bob ay 2000–2999).

---

### 3. Radio SCOSC

Maaaring gamitin ang Radio SCOSC ng parehong mga tagapakinig at performer.

#### Awtomatikong pagtukoy ng mode

Sinusuri ng Radio SCOSC kung tumatakbo na ang scsynth kapag pinindot ang Join:

| Sitwasyon | Mode | Gawi |
|-----------|------|------|
| scsynth ay **hindi** tumatakbo | **Tagapakinig** | Inilulunsad ang sclang para i-boot ang scsynth, pagkatapos ay ipinapadala ang hub OSC sa sclang (port 57120). Ang receive function na awtomatikong naka-setup ay tinatanggal ang `/remote/<n>/` prefix at inirelay ang orihinal na command sa scsynth na may timetag na pinapanatili. |
| scsynth ay **tumatakbo na** | **Performer** | Hindi inilulunsad ang sclang. Ipinapadala ang hub OSC sa umiiral na sclang (port 57120). Ang OSCdef ay dapat patakbuhin nang manu-mano sa editor para i-relay ang OSC sa scsynth. |

Sa parehong mode, ang Radio SCOSC ay nakikinig din sa UDP port 57121 para sa OSC mula sa SC at ipinapasa ito sa hub.

#### Para sa mga performer na gumagamit ng Radio SCOSC

Maaaring gamitin ng mga performer ang Radio SCOSC sa halip na local.py. Sa ganitong kaso:

1. **I-boot muna ang SC server** sa iyong editor (SCIDE, vim/scnvim, Emacs/scel, Overtone, Supriya, atbp.) bago ilunsad ang Radio SCOSC.
2. Patakbuhin ang sumusunod na function sa iyong editor:

```supercollider
~remoteProxy = { |msg, time, addr, recvPort|
    var address = msg[0].asString;
    if(address.beginsWith("/remote/")) {
        var parts = address.split($/).reject({ |s| s.isEmpty });
        var cmd = ("/" ++ parts[2..].join("/")).asSymbol;
        var delta = time - thisThread.seconds;
        if(delta > 0, {
            s.sendBundle(delta, [cmd] ++ msg[1..]);
        }, {
            s.addr.sendMsg(cmd, *msg[1..]);
        });
    };
};
thisProcess.addOSCRecvFunc(~remoteProxy);

// To remove:
// thisProcess.removeOSCRecvFunc(~remoteProxy);
```

> **Para sa mga gumagamit ng Overtone / Supriya:** Ang OSCdef approach sa itaas ay para sa sclang. Ang OSC handling ay nag-iiba-iba sa Overtone at Supriya. Sumangguni sa dokumentasyon ng bawat proyekto para sa angkop na OSC receive pattern.

3. Ilunsad ang Radio SCOSC at sumali sa session.
4. Magpadala ng OSC sa port 57121 (Radio SCOSC) sa halip na local.py:

```supercollider
~hub = NetAddr("127.0.0.1", 57121);
~hub.sendMsg("/d_recv", SynthDef(\sine, { |freq=440, amp=0.2|
    Out.ar(0, SinOsc.ar(freq) * amp * EnvGen.kr(Env.perc, doneAction:2))
}).asBytes);
~hub.sendBundle(0.3, ["/s_new", \sine, 2000, 0, 0, \freq, 432]);
```

> **Mahalaga:** Laging i-boot ang SC server sa iyong editor **bago** ilunsad ang Radio SCOSC. Kung ang Radio SCOSC ay inilunsad nang walang tumatakbong scsynth, magsisimula ito ng sariling scsynth instance (listener mode), na makikipag-conflict sa server ng iyong editor.

#### Mga Kinakailangan

- Dapat naka-install ang **SuperCollider** sa makina.
- Awtomatikong nakita ng Radio SCOSC ang sclang sa mga sumusunod na default path:

| Platform | Default path |
|----------|-------------|
| macOS | `/Applications/SuperCollider.app/Contents/MacOS/sclang` |
| Windows | `C:\Program Files\SuperCollider\sclang.exe` |
| Linux | detected via `which sclang` |

#### Patakbuhin (development)

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

#### Paggamit

1. I-install ang SuperCollider.
2. *(Para sa mga performer lamang)* I-boot ang SC server at i-setup ang remote proxy receive function sa iyong editor muna.
3. Ilunsad ang Radio SCOSC.
4. Ilagay ang hub server address (hal. `wss://live.example.com` o `live.example.com`), pangalan ng silid, at sample rate.
5. **Field ng pangalan:**
   - **Performer mode** (tumatakbo na ang scsynth): ilagay ang iyong pangalan. Dapat natatangi sa silid, hindi dapat walang laman, hindi dapat lumampas sa 64 na karakter, at hindi naglalaman ng `/`.
   - **Listener mode** (hindi tumatakbo ang scsynth): ang field ng pangalan ay binabalewala — isang random na pangalang `listener-XXXX` ang awtomatikong itinalaga.
6. I-click ang **Join**.

#### /who command

Ang sinumang kalahok ay maaaring mag-query ng kasalukuyang membership ng silid sa pamamagitan ng pagpapadala ng OSC `/who` mensahe sa hub:

```supercollider
~hub = NetAddr("127.0.0.1", 57121);
~hub.sendMsg('/who');
```

Ang hub ay sumasagot gamit ang isang `/who/reply` na OSC mensahe na naglalaman ng mga pangalan ng lahat ng kasalukuyang kalahok bilang string argument. Ang parehong `/who/reply` ay awtomatikong ipinapadala rin sa oras ng pagsali, kaya ang `OSCdef` sa ibaba ay magpapalabas sa koneksyon nang hindi kailangang magpadala ng malinaw na `/who`:

```supercollider
OSCdef(\whoReply, { |msg|
    var names = msg[1..];
    ("Mga Kalahok: " ++ names.join(", ")).postln;
}, '/who/reply');
```

---

## Sample Rate

Ang lahat ng kalahok (performer at tagapakinig) ay dapat gumamit ng parehong sample rate. Ang pagkakaiba-iba ay magdudulot ng mga error sa pagsisimula ng scsynth.

Karaniwang rate: **44100**, **48000**, **96000** Hz.

| Platform | Paano i-set |
|----------|-----------|
| macOS | Awtomatikong ina-adjust ng CoreAudio sa karamihang kaso |
| Windows | Control Panel → Sound → Properties → Advanced |
| Linux | I-set sa JACK (hal. sa pamamagitan ng qjackctl) bago magsimula |

---

## Lisensya

Ang WebSocket OSC Hub ay inilabas sa ilalim ng [GNU General Public License v3.0](LICENSE), alinsunod sa SuperCollider.
