# WebSocket OSC Hub

**WebSocket OSC Hub** adalah sistem minimal untuk berbagi pesan OSC antara beberapa instans [SuperCollider](https://supercollider.github.io/) melalui internet menggunakan WebSocket.

Para performer mengirim perintah OSC (`/d_recv`, `/s_new`, `/n_set`, `/n_free`, `sendBundle`, dll.) dari lingkungan SC lokal mereka melalui hub server, di mana pesan-pesan tersebut di-broadcast ke semua peserta lain di ruang yang sama. Pesan OSC dan Bundle keduanya didukung — hub menulis ulang alamat di setiap pesan, sambil mempertahankan timetag di Bundle untuk pemutaran yang tersinkronisasi.

Klien untuk penonton (**Radio SCOSC**) memungkinkan pendengar bergabung ke sesi dan mendengar pertunjukan tanpa pengetahuan coding SC apa pun.

---

## Arsitektur

```
[SC] <--OSC/UDP--> [local.py] <--wss (binary)--> [hub.py] <--wss (binary)--> [local.py] <--OSC/UDP--> [SC]
                                                      |
                                               [Radio SCOSC]
                                     (Aplikasi Electron — memerlukan SuperCollider)
```

Paket OSC diteruskan sebagai binary frame melalui WebSocket. Hub menulis ulang alamat OSC setiap pesan menjadi `/remote/<sender_name>/addr` sebelum melakukan broadcast. Bundle OSC diparsing secara rekursif — setiap alamat pesan yang terkandung ditulis ulang sementara timetag bundle dipertahankan, memungkinkan performer menyinkronkan ritme dan tempo di berbagai lokasi menggunakan `sendBundle`.

---

## Struktur Repository

```
websocket-osc-hub/
├── hub.py            # Hub server (jalankan di VPS atau server)
├── local.py          # Bridge lokal untuk performer
├── requirements.txt  # Dependensi Python
├── LICENSE
├── README.md
└── radio-scosc/      # Aplikasi Radio SCOSC (Electron)
    ├── main.js
    ├── preload.js
    ├── renderer.html
    ├── renderer.js
    └── package.json
```

---

## Demo

Hub demo publik berjalan di `live.oschub.asia`. Perlu diperhatikan bahwa server ini mungkin tidak selalu dapat diakses.

```bash
python local.py live.oschub.asia
```

---

## Persyaratan

### Hub server
- Python 3.10+
- Server dengan domain name dan sertifikat TLS (mis. Let's Encrypt)
- Nginx (atau setara) sebagai reverse proxy untuk wss://

### Performer (local.py)
- Python 3.10+
- SuperCollider 3.x

### Radio SCOSC
- **SuperCollider 3.x** (wajib)
- Node.js 18+ (hanya untuk development/build)

---

## Pengaturan

### 1. Hub server

Instal dependensi:

```bash
pip install -r requirements.txt
```

Jalankan:

```bash
python hub.py --port 8765
```

Opsi tambahan (semua opsional):

| Opsi | Default | Deskripsi |
|------|---------|-----------|
| `--port` | 8765 | Port yang didengarkan hub |
| `--no-rewrite` | — | Nonaktifkan penulisan ulang alamat OSC (teruskan frame apa adanya) |
| `--max-msg-size` | 65536 | Ukuran pesan OSC maksimal dalam byte per pesan |
| `--rate-limit` | 200 | Pesan maksimal per detik per klien |
| `--log-level` | INFO | Tingkat log: `DEBUG`, `INFO`, `WARNING`, `ERROR` |

#### Contoh konfigurasi Nginx (wss://)

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

#### Layanan systemd (opsional)

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

Instal dependensi:

```bash
pip install -r requirements.txt
```

Jalankan:

```bash
python local.py your-hub-domain.example.com
```

Opsi:

| Opsi | Default | Deskripsi |
|------|---------|-----------|
| `server` | *(wajib)* | Hostname hub server |
| `--port` | 443 | Port hub server |
| `--sc-port` | 57120 | Port penerima SC |
| `--osc-port` | 57121 | Port penerima OSC lokal |
| `--rate` | 48000 | Sample rate sesi (hanya untuk konfirmasi) |
| `--name` | *(ditanya)* | Nama Anda dalam sesi |
| `--room` | *(ditanya)* | Nama ruang yang akan dimasuki |

Jika `--name` atau `--room` dihilangkan, Anda akan diminta untuk mengisinya saat startup. Nama setiap peserta harus unik dalam ruang, tidak boleh kosong, dan tidak boleh mengandung `/` — jika nama sudah digunakan atau tidak valid, hub akan menolak koneksi.

#### Pengaturan SuperCollider untuk performer

Setiap performer harus memiliki OSCdef berikut yang berjalan di SC sebelum sesi dimulai. Ini menerima OSC dari performer lain (dikirim melalui local.py ke port 57120) dan meneruskannya ke scsynth.

```supercollider
// Terima OSC dari performer jarak jauh, hapus prefix /remote/<name>/, dan teruskan ke scsynth
OSCdef(\remoteProxy, { |msg, time, addr|
    var parts = msg[0].asString.split($/).reject({ |s| s.isEmpty });
    if(parts.size >= 3 && { parts[0] == "remote" }, {
        var cmd = ("/" ++ parts[2..].join("/")).asSymbol;
        s.addr.sendMsg(cmd, *msg[1..]);
    });
}, nil);
```

Pengaturan sesi yang umum:

```supercollider
s.waitForBoot({

    // 1. Siapkan remote proxy
    OSCdef(\remoteProxy, { |msg, time, addr|
        var parts = msg[0].asString.split($/).reject({ |s| s.isEmpty });
        if(parts.size >= 3 && { parts[0] == "remote" }, {
            var cmd = ("/" ++ parts[2..].join("/")).asSymbol;
            s.addr.sendMsg(cmd, *msg[1..]);
        });
    }, nil);

    // 2. Kirim SynthDef Anda ke semua peserta
    ~hub = NetAddr("127.0.0.1", 57121);
    ~hub.sendMsg("/d_recv", SynthDef(\sine, { |freq=440, amp=0.2|
        Out.ar(0, SinOsc.ar(freq) * amp * EnvGen.kr(Env.perc, doneAction:2))
    }).asBytes);

    // 3. Mainkan dengan sendBundle untuk timing yang ketat di seluruh jaringan
    ~hub.sendBundle(0.3, ["/s_new", \sine, 2000, 0, 0, \freq, 432]);
});
```

> **Catatan tentang node ID:** Node ID tidak dikelola secara otomatis. Para performer harus berkoordinasi terlebih dahulu untuk menghindari konflik (mis. Alice menggunakan 1000–1999, Bob 2000–2999).

---

### 3. Radio SCOSC

Radio SCOSC dapat digunakan oleh pendengar maupun performer.

#### Deteksi mode otomatis

Radio SCOSC memeriksa apakah scsynth sudah berjalan saat Join ditekan:

| Situasi | Mode | Perilaku |
|---------|------|----------|
| scsynth **belum** berjalan | **Pendengar** | Meluncurkan sclang untuk boot scsynth, lalu meneruskan hub OSC ke sclang (port 57120). `OSCdef(\remoteProxy)` sclang menghapus prefix pengirim dan merelay perintah asli ke scsynth. |
| scsynth **sudah** berjalan | **Performer** | TIDAK meluncurkan sclang. Meneruskan hub OSC ke sclang yang sudah ada (port 57120). OSCdef harus dijalankan secara manual di editor untuk merelay OSC ke scsynth. |

Di kedua mode, Radio SCOSC juga mendengarkan pada UDP port 57121 untuk OSC dari SC dan meneruskannya ke hub.

#### Untuk performer yang menggunakan Radio SCOSC

Performer dapat menggunakan Radio SCOSC sebagai pengganti local.py. Dalam kasus ini:

1. **Boot server SC terlebih dahulu** di editor Anda (SCIDE, vim/scnvim, Emacs/scel, Overtone, Supriya, dll.) sebelum meluncurkan Radio SCOSC.
2. Jalankan OSCdef berikut di editor Anda:

```supercollider
OSCdef(\remoteProxy, { |msg, time, addr|
    var parts = msg[0].asString.split($/).reject({ |s| s.isEmpty });
    if(parts.size >= 3 && { parts[0] == "remote" }, {
        var cmd = ("/" ++ parts[2..].join("/")).asSymbol;
        s.addr.sendMsg(cmd, *msg[1..]);
    });
}, nil);
```

> **Pengguna Overtone / Supriya:** Pendekatan OSCdef di atas khusus untuk sclang. Penanganan OSC berbeda di Overtone dan Supriya. Lihat dokumentasi masing-masing proyek untuk pola penerimaan OSC yang sesuai.

3. Luncurkan Radio SCOSC dan bergabung ke sesi.
4. Kirim OSC ke port 57121 (Radio SCOSC) bukan local.py:

```supercollider
~hub = NetAddr("127.0.0.1", 57121);
~hub.sendMsg("/d_recv", SynthDef(\sine, { |freq=440, amp=0.2|
    Out.ar(0, SinOsc.ar(freq) * amp * EnvGen.kr(Env.perc, doneAction:2))
}).asBytes);
~hub.sendBundle(0.3, ["/s_new", \sine, 2000, 0, 0, \freq, 432]);
```

> **Penting:** Selalu boot server SC di editor **sebelum** meluncurkan Radio SCOSC. Jika Radio SCOSC diluncurkan tanpa scsynth yang berjalan, ia akan memulai instans scsynth sendiri (mode listener), yang akan berkonflik dengan server editor Anda.

#### Prasyarat

- **SuperCollider harus diinstal** di mesin.
- Radio SCOSC mendeteksi sclang secara otomatis di path default berikut:

| Platform | Path default |
|----------|-------------|
| macOS | `/Applications/SuperCollider.app/Contents/MacOS/sclang` |
| Windows | `C:\Program Files\SuperCollider\sclang.exe` |
| Linux | terdeteksi via `which sclang` |

#### Jalankan (development)

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

#### Cara penggunaan

1. Instal SuperCollider.
2. *(Hanya untuk performer)* Boot server SC dan jalankan `OSCdef(\remoteProxy, ...)` di editor Anda terlebih dahulu.
3. Luncurkan Radio SCOSC.
4. Masukkan alamat hub server (mis. `wss://live.example.com` atau `live.example.com`), nama ruang, dan sample rate.
5. **Kolom nama:**
   - **Mode Performer** (scsynth sudah berjalan): masukkan nama Anda. Harus unik di ruang, tidak boleh kosong, dan tidak boleh mengandung `/`.
   - **Mode Listener** (scsynth belum berjalan): kolom nama diabaikan — nama acak berformat `listener-XXXX` ditetapkan secara otomatis.
6. Klik **Join**.

#### Perintah /who

Peserta mana pun dapat menanyakan keanggotaan ruang saat ini dengan mengirim pesan OSC `/who` ke hub:

```supercollider
~hub = NetAddr("127.0.0.1", 57121);
~hub.sendMsg('/who');
```

Hub membalas dengan pesan OSC `/who/reply` yang berisi nama semua peserta saat ini sebagai argumen string. `/who/reply` yang sama juga dikirim secara otomatis saat bergabung, sehingga `OSCdef` di bawah ini akan aktif saat koneksi tanpa perlu mengirim `/who` secara eksplisit:

```supercollider
OSCdef(\whoReply, { |msg|
    var names = msg[1..];
    ("Peserta: " ++ names.join(", ")).postln;
}, '/who/reply');
```

---

## Sample Rate

Semua peserta (performer dan pendengar) harus menggunakan sample rate yang sama. Ketidakcocokan akan menyebabkan error saat startup scsynth.

Rate yang umum: **44100**, **48000**, **96000** Hz.

| Platform | Cara mengatur |
|----------|-----------|
| macOS | CoreAudio menyesuaikan secara otomatis di sebagian besar kasus |
| Windows | Control Panel → Sound → Properties → Advanced |
| Linux | Atur di JACK (mis. melalui qjackctl) sebelum memulai |

---

## Lisensi

WebSocket OSC Hub dirilis di bawah [GNU General Public License v3.0](LICENSE), sesuai dengan SuperCollider.
