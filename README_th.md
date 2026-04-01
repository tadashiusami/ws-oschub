# WebSocket OSC Hub

**WebSocket OSC Hub** คือระบบขนาดเล็กสำหรับแชร์ข้อความ OSC ระหว่าง [SuperCollider](https://supercollider.github.io/) หลายอินสแตนซ์ผ่านอินเทอร์เน็ตด้วย WebSocket

ผู้แสดง (performer) ส่งคำสั่ง OSC (`/d_recv`, `/s_new`, `/n_set`, `/n_free`, `sendBundle` ฯลฯ) จากสภาพแวดล้อม SC ในเครื่องผ่านฮับเซิร์ฟเวอร์ ซึ่งจะบรอดแคสต์ไปยังผู้เข้าร่วมคนอื่นทุกคนในห้องเดียวกัน รองรับทั้งข้อความ OSC และ Bundle — ฮับจะเขียนที่อยู่ใหม่ในแต่ละข้อความ ขณะเดียวกันยังคง timetag ใน Bundle ไว้เพื่อการเล่นที่ซิงโครไนซ์

แอปสำหรับผู้ฟัง (**Radio SCOSC**) ช่วยให้ผู้ฟังสามารถเข้าร่วมเซสชันและฟังการแสดงโดยไม่ต้องมีความรู้ด้านการเขียนโค้ด SC

---

## สถาปัตยกรรม

```
[SC] <--OSC/UDP--> [local.py] <--wss (binary)--> [hub.py] <--wss (binary)--> [local.py] <--OSC/UDP--> [SC]
                                                      |
                                               [Radio SCOSC]
                                     (แอป Electron — ต้องการ SuperCollider)
```

แพ็กเก็ต OSC จะถูกส่งต่อเป็น binary frame ผ่าน WebSocket ฮับจะเขียนที่อยู่ OSC ของแต่ละข้อความใหม่เป็น `/remote/<sender_name>/addr` ก่อนบรอดแคสต์ Bundle OSC จะถูกแยกวิเคราะห์แบบ recursive — ที่อยู่ของแต่ละข้อความที่บรรจุอยู่จะถูกเขียนใหม่ขณะที่ timetag ของ Bundle ยังคงอยู่ ช่วยให้ผู้แสดงสามารถซิงโครไนซ์จังหวะและเทมโปจากสถานที่ต่างๆ โดยใช้ `sendBundle`

---

## โครงสร้าง Repository

```
websocket-osc-hub/
├── hub.py            # ฮับเซิร์ฟเวอร์ (รันบน VPS หรือเซิร์ฟเวอร์)
├── local.py          # บริดจ์ในเครื่องสำหรับผู้แสดง
├── requirements.txt  # การพึ่งพา Python
├── LICENSE
├── README.md
└── radio-scosc/      # แอป Radio SCOSC (Electron)
    ├── main.js
    ├── preload.js
    ├── renderer.html
    ├── renderer.js
    └── package.json
```

---

## เดโม

Hub เดโมสาธารณะกำลังทำงานที่ `live.oschub.asia` โปรดทราบว่าเซิร์ฟเวอร์นี้อาจไม่พร้อมใช้งานตลอดเวลา

```bash
python local.py live.oschub.asia
```

---

## ข้อกำหนด

### ฮับเซิร์ฟเวอร์
- Python 3.10+
- เซิร์ฟเวอร์ที่มีชื่อโดเมนและใบรับรอง TLS (เช่น Let's Encrypt)
- Nginx (หรือเทียบเท่า) เป็น reverse proxy สำหรับ wss://

### ผู้แสดง (local.py)
- Python 3.10+
- SuperCollider 3.x

### Radio SCOSC
- **SuperCollider 3.x** (จำเป็น)
- Node.js 18+ (สำหรับ development/build เท่านั้น)

---

## การตั้งค่า

### 1. ฮับเซิร์ฟเวอร์

ติดตั้ง dependency:

```bash
pip install -r requirements.txt
```

รัน:

```bash
python hub.py --port 8765
```

ตัวเลือกเพิ่มเติม (ทั้งหมดเป็นทางเลือก):

| ตัวเลือก | ค่าเริ่มต้น | คำอธิบาย |
|---------|------------|---------|
| `--port` | 8765 | พอร์ตที่ฮับรับฟัง |
| `--no-rewrite` | — | ปิดการเขียนที่อยู่ OSC ใหม่ (ส่งต่อ frame ตามเดิม) |
| `--max-msg-size` | 65536 | ขนาดข้อความ OSC สูงสุดเป็นไบต์ต่อข้อความ |
| `--rate-limit` | 200 | จำนวนข้อความสูงสุดต่อวินาทีต่อไคลเอนต์ |
| `--log-level` | INFO | ระดับ log: `DEBUG`, `INFO`, `WARNING`, `ERROR` |

#### ตัวอย่างการตั้งค่า Nginx (wss://)

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

#### บริการ systemd (ทางเลือก)

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

### 2. ผู้แสดง (local.py)

ติดตั้ง dependency:

```bash
pip install -r requirements.txt
```

รัน:

```bash
python local.py your-hub-domain.example.com
```

ตัวเลือก:

| ตัวเลือก | ค่าเริ่มต้น | คำอธิบาย |
|---------|------------|---------|
| `server` | *(จำเป็น)* | ชื่อโฮสต์ของฮับเซิร์ฟเวอร์ |
| `--port` | 443 | พอร์ตของฮับเซิร์ฟเวอร์ |
| `--sc-port` | 57120 | พอร์ตรับของ SC |
| `--osc-port` | 57121 | พอร์ตรับ OSC ในเครื่อง |
| `--rate` | 48000 | Sample rate ของเซสชัน (สำหรับยืนยันเท่านั้น) |
| `--name` | *(ถูกถาม)* | ชื่อของคุณในเซสชัน |
| `--room` | *(ถูกถาม)* | ชื่อห้องที่ต้องการเข้าร่วม |

หากละเว้น `--name` หรือ `--room` โปรแกรมจะถามเมื่อเริ่มต้น ชื่อของผู้เข้าร่วมแต่ละคนต้องไม่ซ้ำกันภายในห้อง ต้องไม่ว่างเปล่า ต้องไม่เกิน 64 ตัวอักษร และต้องไม่มี `/` — หากชื่อถูกใช้แล้วหรือไม่ถูกต้อง ฮับจะปฏิเสธการเชื่อมต่อ ชื่อห้องก็ต้องไม่ว่างเปล่าและต้องไม่เกิน 64 ตัวอักษรเช่นกัน

#### การตั้งค่า SuperCollider สำหรับผู้แสดง

ผู้แสดงแต่ละคนต้องมี OSCdef ต่อไปนี้ทำงานใน SC ก่อนเซสชันจะเริ่ม โดยรับ OSC จากผู้แสดงคนอื่น (ส่งมาจาก local.py ไปยังพอร์ต 57120) และส่งต่อไปยัง scsynth

```supercollider
// รับ OSC จากผู้แสดงระยะไกล ลบ prefix /remote/<name>/ และส่งต่อไปยัง scsynth
OSCdef(\remoteProxy, { |msg, time, addr|
    var parts = msg[0].asString.split($/).reject({ |s| s.isEmpty });
    if(parts.size >= 3 && { parts[0] == "remote" }, {
        var cmd = ("/" ++ parts[2..].join("/")).asSymbol;
        s.addr.sendMsg(cmd, *msg[1..]);
    });
}, nil);
```

การตั้งค่าเซสชันทั่วไป:

```supercollider
s.waitForBoot({

    // 1. ตั้งค่า remote proxy
    OSCdef(\remoteProxy, { |msg, time, addr|
        var parts = msg[0].asString.split($/).reject({ |s| s.isEmpty });
        if(parts.size >= 3 && { parts[0] == "remote" }, {
            var cmd = ("/" ++ parts[2..].join("/")).asSymbol;
            s.addr.sendMsg(cmd, *msg[1..]);
        });
    }, nil);

    // 2. ส่ง SynthDef ของคุณไปยังผู้เข้าร่วมทุกคน
    ~hub = NetAddr("127.0.0.1", 57121);
    ~hub.sendMsg("/d_recv", SynthDef(\sine, { |freq=440, amp=0.2|
        Out.ar(0, SinOsc.ar(freq) * amp * EnvGen.kr(Env.perc, doneAction:2))
    }).asBytes);

    // 3. เล่นด้วย sendBundle เพื่อจังหวะที่แม่นยำผ่านเครือข่าย
    ~hub.sendBundle(0.3, ["/s_new", \sine, 2000, 0, 0, \freq, 432]);
});
```

> **หมายเหตุเกี่ยวกับ node ID:** Node ID ไม่ได้รับการจัดการโดยอัตโนมัติ ผู้แสดงควรประสานงานล่วงหน้าเพื่อหลีกเลี่ยงความขัดแย้ง (เช่น Alice ใช้ 1000–1999, Bob ใช้ 2000–2999)

---

### 3. Radio SCOSC

Radio SCOSC สามารถใช้ได้ทั้งโดยผู้ฟังและผู้แสดง

#### การตรวจจับโหมดอัตโนมัติ

Radio SCOSC ตรวจสอบว่า scsynth กำลังทำงานอยู่หรือไม่เมื่อกด Join:

| สถานการณ์ | โหมด | พฤติกรรม |
|---------|------|---------|
| scsynth **ไม่ได้** ทำงาน | **ผู้ฟัง** | เปิด sclang เพื่อบูต scsynth จากนั้นส่งต่อ hub OSC ไปยัง sclang (พอร์ต 57120) `OSCdef(\remoteProxy)` ของ sclang จะลบ prefix ผู้ส่งและรีเลย์คำสั่งต้นฉบับไปยัง scsynth |
| scsynth **กำลัง** ทำงานอยู่ | **ผู้แสดง** | ไม่เปิด sclang ส่งต่อ hub OSC ไปยัง sclang ที่มีอยู่ (พอร์ต 57120) ต้องรัน OSCdef ด้วยตนเองในตัวแก้ไขเพื่อรีเลย์ OSC ไปยัง scsynth |

ในทั้งสองโหมด Radio SCOSC ยังรับฟังบน UDP พอร์ต 57121 สำหรับ OSC จาก SC และส่งต่อไปยังฮับ

#### สำหรับผู้แสดงที่ใช้ Radio SCOSC

ผู้แสดงสามารถใช้ Radio SCOSC แทน local.py ในกรณีนี้:

1. **บูตเซิร์ฟเวอร์ SC ก่อน** ในตัวแก้ไขของคุณ (SCIDE, vim/scnvim, Emacs/scel, Overtone, Supriya ฯลฯ) ก่อนเปิด Radio SCOSC
2. รัน OSCdef ต่อไปนี้ในตัวแก้ไขของคุณ:

```supercollider
OSCdef(\remoteProxy, { |msg, time, addr|
    var parts = msg[0].asString.split($/).reject({ |s| s.isEmpty });
    if(parts.size >= 3 && { parts[0] == "remote" }, {
        var cmd = ("/" ++ parts[2..].join("/")).asSymbol;
        s.addr.sendMsg(cmd, *msg[1..]);
    });
}, nil);
```

> **ผู้ใช้ Overtone / Supriya:** วิธี OSCdef ข้างต้นใช้เฉพาะกับ sclang การจัดการ OSC แตกต่างกันใน Overtone และ Supriya โปรดดูเอกสารของแต่ละโปรเจกต์สำหรับรูปแบบการรับ OSC ที่เหมาะสม

3. เปิด Radio SCOSC และเข้าร่วมเซสชัน
4. ส่ง OSC ไปยังพอร์ต 57121 (Radio SCOSC) แทน local.py:

```supercollider
~hub = NetAddr("127.0.0.1", 57121);
~hub.sendMsg("/d_recv", SynthDef(\sine, { |freq=440, amp=0.2|
    Out.ar(0, SinOsc.ar(freq) * amp * EnvGen.kr(Env.perc, doneAction:2))
}).asBytes);
~hub.sendBundle(0.3, ["/s_new", \sine, 2000, 0, 0, \freq, 432]);
```

> **สำคัญ:** บูตเซิร์ฟเวอร์ SC ในตัวแก้ไข **ก่อน** เปิด Radio SCOSC เสมอ หาก Radio SCOSC ถูกเปิดโดยไม่มี scsynth ทำงานอยู่ มันจะเริ่มต้น scsynth อินสแตนซ์ของตัวเอง (โหมด listener) ซึ่งจะขัดแย้งกับเซิร์ฟเวอร์ของตัวแก้ไข

#### ข้อกำหนดเบื้องต้น

- ต้องติดตั้ง **SuperCollider** บนเครื่อง
- Radio SCOSC ตรวจจับ sclang โดยอัตโนมัติที่เส้นทางเริ่มต้นต่อไปนี้:

| แพลตฟอร์ม | เส้นทางเริ่มต้น |
|---------|-------------|
| macOS | `/Applications/SuperCollider.app/Contents/MacOS/sclang` |
| Windows | `C:\Program Files\SuperCollider\sclang.exe` |
| Linux | ตรวจจับผ่าน `which sclang` |

#### รัน (development)

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

#### วิธีใช้

1. ติดตั้ง SuperCollider
2. *(สำหรับผู้แสดงเท่านั้น)* บูตเซิร์ฟเวอร์ SC และรัน `OSCdef(\remoteProxy, ...)` ในตัวแก้ไขก่อน
3. เปิด Radio SCOSC
4. ป้อนที่อยู่ฮับเซิร์ฟเวอร์ (เช่น `wss://live.example.com` หรือ `live.example.com`) ชื่อห้อง และ sample rate
5. **ช่องชื่อ:**
   - **โหมดผู้แสดง** (scsynth ทำงานอยู่แล้ว): ป้อนชื่อของคุณ ต้องไม่ซ้ำในห้อง ต้องไม่ว่างเปล่า ต้องไม่เกิน 64 ตัวอักษร และต้องไม่มี `/`
   - **โหมดผู้ฟัง** (scsynth ไม่ได้ทำงาน): ช่องชื่อจะถูกละเว้น — ชื่อสุ่มในรูปแบบ `listener-XXXX` จะถูกกำหนดโดยอัตโนมัติ
6. คลิก **Join**

#### คำสั่ง /who

ผู้เข้าร่วมคนใดก็ได้สามารถสอบถามสมาชิกปัจจุบันของห้องโดยส่งข้อความ OSC `/who` ไปยังฮับ:

```supercollider
~hub = NetAddr("127.0.0.1", 57121);
~hub.sendMsg('/who');
```

ฮับตอบกลับด้วยข้อความ OSC `/who/reply` ที่มีชื่อของผู้เข้าร่วมปัจจุบันทั้งหมดเป็นอาร์กิวเมนต์ string `/who/reply` เดียวกันนี้จะถูกส่งโดยอัตโนมัติเมื่อเข้าร่วมด้วย ดังนั้นหากตั้งค่า `OSCdef` ด้านล่างไว้ก็จะได้รับรายชื่อผู้เข้าร่วมเมื่อเชื่อมต่อโดยไม่ต้องส่ง `/who` อย่างชัดเจน:

```supercollider
OSCdef(\whoReply, { |msg|
    var names = msg[1..];
    ("ผู้เข้าร่วม: " ++ names.join(", ")).postln;
}, '/who/reply');
```

---

## Sample Rate

ผู้เข้าร่วมทุกคน (ผู้แสดงและผู้ฟัง) ต้องใช้ sample rate เดียวกัน ความไม่ตรงกันจะทำให้เกิดข้อผิดพลาดในการเริ่มต้น scsynth

อัตราทั่วไป: **44100**, **48000**, **96000** Hz

| แพลตฟอร์ม | วิธีตั้งค่า |
|---------|-----------|
| macOS | CoreAudio ปรับอัตโนมัติในกรณีส่วนใหญ่ |
| Windows | Control Panel → Sound → Properties → Advanced |
| Linux | ตั้งค่าใน JACK (เช่น qjackctl) ก่อนเริ่ม |

---

## ใบอนุญาต

WebSocket OSC Hub เผยแพร่ภายใต้ [GNU General Public License v3.0](LICENSE) ตามแนวทางของ SuperCollider
