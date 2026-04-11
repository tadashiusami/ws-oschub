# WebSocket OSC Hub

**WebSocket OSC Hub** là một hệ thống tối giản để chia sẻ các tin nhắn OSC giữa nhiều phiên bản [SuperCollider](https://supercollider.github.io/) qua internet thông qua WebSocket.

Các performer gửi lệnh OSC (`/d_recv`, `/s_new`, `/n_set`, `/n_free`, `sendBundle`, v.v.) từ môi trường SC cục bộ của họ thông qua hub server, nơi chúng được broadcast đến tất cả người tham gia khác trong cùng phòng. Cả tin nhắn OSC và Bundle đều được hỗ trợ — hub viết lại địa chỉ trong mỗi tin nhắn, đồng thời giữ nguyên timetag trong Bundle để phát lại đồng bộ.

Ứng dụng dành cho khán giả (**Radio SCOSC**) cho phép người nghe tham gia phiên và nghe buổi biểu diễn mà không cần kiến thức lập trình SC.

---

## Kiến trúc

```
[SC] <--OSC/UDP--> [local.py] <--wss (binary)--> [hub.py] <--wss (binary)--> [local.py] <--OSC/UDP--> [SC]
                                                      |
                                               [Radio SCOSC]
                                     (Ứng dụng Electron — yêu cầu SuperCollider)
```

Các gói OSC được chuyển tiếp dưới dạng binary frame qua WebSocket. Hub viết lại địa chỉ OSC của mỗi tin nhắn thành `/remote/<sender_name>/addr` trước khi broadcast. Các OSC Bundle được phân tích đệ quy — địa chỉ của mỗi tin nhắn chứa trong bundle được viết lại trong khi timetag được giữ nguyên, cho phép performer đồng bộ nhịp điệu và tempo ở các địa điểm khác nhau bằng `sendBundle`.

---

## Cấu trúc Repository

```
websocket-osc-hub/
├── hub.py            # Hub server (chạy trên VPS hoặc server)
├── local.py          # Bridge cục bộ cho performer
├── requirements.txt  # Các dependency Python
├── LICENSE
├── README.md
└── radio-scosc/      # Ứng dụng Radio SCOSC (Electron)
    ├── main.js
    ├── preload.js
    ├── renderer.html
    ├── renderer.js
    └── package.json
```

---

## Demo

Một Hub demo công cộng đang chạy tại `live.oschub.asia`. Lưu ý rằng server này có thể không phải lúc nào cũng có thể truy cập được.

```bash
python local.py live.oschub.asia
```

---

## Yêu cầu

### Hub server
- Python 3.10+
- Server có domain name và chứng chỉ TLS (ví dụ: Let's Encrypt)
- Nginx (hoặc tương đương) làm reverse proxy cho wss://

### Performer (local.py)
- Python 3.10+
- SuperCollider 3.x

### Radio SCOSC
- **SuperCollider 3.x** (bắt buộc)
- Node.js 18+ (chỉ dành cho development/build)

---

## Cài đặt

### 1. Hub server

Cài đặt các dependency:

```bash
pip install -r requirements.txt
```

Chạy:

```bash
python hub.py --port 8765
```

Các tùy chọn bổ sung (tất cả đều tùy chọn):

| Tùy chọn | Mặc định | Mô tả |
|----------|----------|-------|
| `--port` | 8765 | Cổng lắng nghe của hub |
| `--no-rewrite` | — | Tắt tính năng viết lại địa chỉ OSC (chuyển tiếp frame nguyên vẹn) |
| `--max-msg-size` | 65536 | Kích thước tin nhắn OSC tối đa tính bằng byte |
| `--rate-limit` | 200 | Số tin nhắn tối đa mỗi giây mỗi client |
| `--log-level` | INFO | Mức độ log: `DEBUG`, `INFO`, `WARNING`, `ERROR` |

#### Ví dụ cấu hình Nginx (wss://)

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

#### Dịch vụ systemd (tùy chọn)

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

Cài đặt các dependency:

```bash
pip install -r requirements.txt
```

Chạy:

```bash
python local.py your-hub-domain.example.com
```

Các tùy chọn:

| Tùy chọn | Mặc định | Mô tả |
|----------|----------|-------|
| `server` | *(bắt buộc)* | Hostname của hub server |
| `--port` | 443 | Cổng của hub server |
| `--sc-port` | 57120 | Cổng nhận của SC |
| `--osc-port` | 57121 | Cổng nhận OSC cục bộ |
| `--rate` | 48000 | Sample rate của phiên (chỉ để xác nhận) |
| `--name` | *(được hỏi)* | Tên của bạn trong phiên |
| `--room` | *(được hỏi)* | Tên phòng muốn tham gia |

Nếu bỏ qua `--name` hoặc `--room`, bạn sẽ được nhắc nhập khi khởi động. Tên của mỗi người tham gia phải là duy nhất trong phòng, không được để trống, không được vượt quá 64 ký tự, và không được chứa `/` — nếu tên đã được sử dụng hoặc không hợp lệ, hub sẽ từ chối kết nối. Tên phòng cũng không được để trống và không được vượt quá 64 ký tự.

#### Cài đặt SuperCollider cho performer

Mỗi performer phải có hàm nhận sau đây đang chạy trong SC trước khi phiên bắt đầu. Nó nhận OSC từ performer khác (được giao bởi local.py đến port 57120), loại bỏ tiền tố `/remote/<n>/` được hub thêm vào, và chuyển tiếp đến scsynth với timetag được giữ nguyên để timing của `sendBundle` được tôn trọng.

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
            s.sendMsg(cmd, *msg[1..]);
        });
    };
};
thisProcess.addOSCRecvFunc(~remoteProxy);

// To remove:
// thisProcess.removeOSCRecvFunc(~remoteProxy);
```

Cài đặt phiên thông thường:

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
                s.sendMsg(cmd, *msg[1..]);
            });
        };
    };
    thisProcess.addOSCRecvFunc(~remoteProxy);

    // 2. Gửi SynthDef của bạn đến tất cả người tham gia
    ~hub = NetAddr("127.0.0.1", 57121);
    ~hub.sendMsg("/d_recv", SynthDef(\sine, { |freq=440, amp=0.2|
        Out.ar(0, SinOsc.ar(freq) * amp * EnvGen.kr(Env.perc, doneAction:2))
    }).asBytes);

    // 3. Chơi với sendBundle để đồng bộ nhịp điệu qua mạng
    ~hub.sendBundle(0.3, ["/s_new", \sine, 2000, 0, 0, \freq, 432]);
});
```

> **Lưu ý về node ID:** Node ID không được quản lý tự động. Các performer nên phối hợp trước để tránh xung đột (ví dụ: Alice dùng 1000–1999, Bob dùng 2000–2999).

---

### 3. Radio SCOSC

Radio SCOSC có thể được sử dụng bởi cả người nghe và performer.

#### Tự động phát hiện chế độ

Radio SCOSC kiểm tra xem scsynth đã chạy chưa khi nhấn Join:

| Tình huống | Chế độ | Hành vi |
|-----------|--------|---------|
| scsynth **chưa** chạy | **Người nghe** | Khởi chạy sclang để boot scsynth, sau đó chuyển tiếp hub OSC đến sclang (port 57120). Hàm nhận được cài đặt tự động loại bỏ tiền tố `/remote/<n>/` và relay lệnh đến scsynth với timetag được giữ nguyên. |
| scsynth **đã** chạy | **Performer** | KHÔNG khởi chạy sclang. Chuyển tiếp hub OSC đến sclang hiện có (port 57120). OSCdef phải được chạy thủ công trong editor để relay OSC đến scsynth. |

Ở cả hai chế độ, Radio SCOSC cũng lắng nghe trên UDP port 57121 để nhận OSC từ SC và chuyển tiếp đến hub.

#### Dành cho performer sử dụng Radio SCOSC

Performer có thể sử dụng Radio SCOSC thay vì local.py. Trong trường hợp này:

1. **Boot SC server trước** trong editor của bạn (SCIDE, vim/scnvim, Emacs/scel, Overtone, Supriya, v.v.) trước khi khởi chạy Radio SCOSC.
2. Chạy hàm sau trong editor:

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
            s.sendMsg(cmd, *msg[1..]);
        });
    };
};
thisProcess.addOSCRecvFunc(~remoteProxy);

// To remove:
// thisProcess.removeOSCRecvFunc(~remoteProxy);
```

> **Người dùng Overtone / Supriya:** Cách tiếp cận `thisProcess.addOSCRecvFunc` trên đây dành riêng cho sclang. Xử lý OSC khác nhau giữa Overtone và Supriya. Tham khảo tài liệu của từng dự án để biết pattern nhận OSC phù hợp.

3. Khởi chạy Radio SCOSC và tham gia phiên.
4. Gửi OSC đến port 57121 (Radio SCOSC) thay vì local.py:

```supercollider
~hub = NetAddr("127.0.0.1", 57121);
~hub.sendMsg("/d_recv", SynthDef(\sine, { |freq=440, amp=0.2|
    Out.ar(0, SinOsc.ar(freq) * amp * EnvGen.kr(Env.perc, doneAction:2))
}).asBytes);
~hub.sendBundle(0.3, ["/s_new", \sine, 2000, 0, 0, \freq, 432]);
```

> **Quan trọng:** Luôn boot SC server trong editor **trước** khi khởi chạy Radio SCOSC. Nếu Radio SCOSC được khởi chạy mà không có scsynth đang chạy, nó sẽ tự khởi động scsynth instance của riêng mình (chế độ listener), điều này sẽ xung đột với server của editor.

#### Điều kiện tiên quyết

- **SuperCollider phải được cài đặt** trên máy.
- Radio SCOSC tự động phát hiện sclang tại các đường dẫn mặc định sau:

| Nền tảng | Đường dẫn mặc định |
|----------|-------------|
| macOS | `/Applications/SuperCollider.app/Contents/MacOS/sclang` |
| Windows | `C:\Program Files\SuperCollider\sclang.exe` |
| Linux | phát hiện qua `which sclang` |

#### Chạy (development)

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

#### Cách sử dụng

1. Cài đặt SuperCollider.
2. *(Chỉ dành cho performer)* Boot SC server và cài đặt hàm nhận remote proxy trong editor của bạn trước.
3. Khởi chạy Radio SCOSC.
4. Nhập địa chỉ hub server (ví dụ: `wss://live.example.com` hoặc `live.example.com`), tên phòng và sample rate.
5. **Trường tên:**
   - **Chế độ Performer** (scsynth đã chạy): nhập tên của bạn. Phải là duy nhất trong phòng, không được để trống, không được vượt quá 64 ký tự, và không được chứa `/`.
   - **Chế độ Listener** (scsynth chưa chạy): trường tên bị bỏ qua — tên ngẫu nhiên dạng `listener-XXXX` được tự động gán.
6. Nhấp **Join**.

#### Lệnh /ping

Bất kỳ người tham gia nào cũng có thể đo độ trễ mạng bằng cách gửi tin nhắn `/ping` kèm timestamp. Hub sẽ phản hồi lại dưới dạng `/ping/reply` với tất cả argument được giữ nguyên:

```supercollider
// Đo độ trễ liên tục và cập nhật ~latency mỗi 2 giây
~pingTimes = Array.newClear(10);
~pingIndex = 0;

OSCdef(\pingReply, { |msg|
    var rtt = Date.getDate.rawSeconds - msg[1].asFloat;
    var latency = rtt / 2;
    ~pingTimes[~pingIndex % 10] = latency;
    ~pingIndex = ~pingIndex + 1;
    if(~pingIndex >= 10) {
        var valid = ~pingTimes.select({ |v| v.notNil });
        ~latency = valid.maxItem * 1.5;  // trường hợp tệ nhất × 1.5 biên an toàn
        ("latency updated: " ++ ~latency.round(0.001) ++ "s").postln;
    };
}, '/ping/reply');

~pingRoutine = Routine({
    loop {
        ~hub.sendMsg('/ping', Date.getDate.rawSeconds);
        2.wait;
    };
}).play(SystemClock);

// Dừng ping:
// ~pingRoutine.stop;
```

#### Lệnh /who

Bất kỳ người tham gia nào cũng có thể truy vấn danh sách thành viên phòng hiện tại bằng cách gửi tin nhắn OSC `/who` đến hub:

```supercollider
~hub = NetAddr("127.0.0.1", 57121);
~hub.sendMsg('/who');
```

Hub trả lời bằng tin nhắn OSC `/who/reply` chứa tên của tất cả người tham gia hiện tại dưới dạng string argument. `/who/reply` tương tự cũng được gửi tự động lúc tham gia, vì vậy `OSCdef` dưới đây sẽ kích hoạt khi kết nối mà không cần gửi `/who` tường minh:

```supercollider
OSCdef(\whoReply, { |msg|
    var names = msg[1..];
    ("Người tham gia: " ++ names.join(", ")).postln;
}, '/who/reply');
```

---

## Sample Rate

Tất cả người tham gia (performer và người nghe) phải sử dụng cùng sample rate. Không khớp sẽ gây ra lỗi khởi động scsynth.

Tốc độ thông dụng: **44100**, **48000**, **96000** Hz.

| Nền tảng | Cách cài đặt |
|----------|-----------|
| macOS | CoreAudio tự động điều chỉnh trong hầu hết trường hợp |
| Windows | Control Panel → Sound → Properties → Advanced |
| Linux | Đặt trong JACK (ví dụ: qua qjackctl) trước khi khởi động |

---

## Giấy phép

WebSocket OSC Hub được phát hành theo [GNU General Public License v3.0](LICENSE), phù hợp với SuperCollider.
