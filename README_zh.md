# WebSocket OSC Hub

**WebSocket OSC Hub** 是一个最小化配置的系统，用于在多个 [SuperCollider](https://supercollider.github.io/) 环境之间通过互联网共享 OSC 消息。

演奏者从本地 SC 环境向 Hub 服务器发送 OSC 命令（`/d_recv`、`/s_new`、`/n_set`、`/n_free`、`sendBundle` 等），这些命令将广播给同一房间中的所有其他参与者。系统同时支持 OSC 消息和 Bundle，Hub 会改写每条消息的地址，同时保留 Bundle 的 timetag，因此可以使用 `sendBundle` 实现节奏与速度的同步。

通过面向听众的客户端（**Radio SCOSC**），无需编写 SC 代码即可收听会话。

---

## 架构

```
[SC] <--OSC/UDP--> [local.py] <--wss (binary)--> [hub.py] <--wss (binary)--> [local.py] <--OSC/UDP--> [SC]
                                                      |
                                               [Radio SCOSC]
                                     (Electron 应用 — 需要 SuperCollider)
```

OSC 数据包以二进制帧的形式通过 WebSocket 传输。Hub 将每条消息的 OSC 地址改写为 `/remote/<发送者名称>/addr` 后进行广播。OSC Bundle 包括嵌套结构在内会被递归解析，其中各条消息的地址会被改写，而 timetag 则保持不变。这使得通过 `sendBundle` 在远程参与者之间实现节奏与速度同步成为可能。

---

## 仓库结构

```
websocket-osc-hub/
├── hub.py            # Hub 服务器（在 VPS 或服务器上运行）
├── local.py          # 演奏者用本地桥接程序
├── requirements.txt  # Python 依赖项
├── LICENSE
├── README.md
└── radio-scosc/      # Radio SCOSC 应用（Electron）
    ├── main.js
    ├── preload.js
    ├── renderer.html
    ├── renderer.js
    └── package.json
```

---

## 演示

公开演示 Hub 正在 `live.oschub.asia` 上运行。请注意，该服务器可能并非始终可用。

```bash
python local.py live.oschub.asia
```

---

## 要求

### Hub 服务器
- Python 3.10+
- 拥有域名和 TLS 证书的服务器（例如：Let's Encrypt）
- 用于 wss:// 的反向代理 Nginx（或同等软件）

### 演奏者（local.py）
- Python 3.10+
- SuperCollider 3.x

### Radio SCOSC
- **SuperCollider 3.x**（必须）
- Node.js 18+（仅开发和构建时需要）

---

## 设置

### 1. Hub 服务器

安装依赖项：

```bash
pip install -r requirements.txt
```

启动：

```bash
python hub.py --port 8765
```

附加选项（均可省略）：

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `--port` | 8765 | Hub 监听端口 |
| `--no-rewrite` | — | 禁用 OSC 地址改写（直接转发帧） |
| `--max-msg-size` | 65536 | 每条消息的最大大小（字节） |
| `--rate-limit` | 200 | 每个客户端每秒最大消息数 |
| `--log-level` | INFO | 日志级别：`DEBUG`、`INFO`、`WARNING`、`ERROR` |

#### Nginx 配置示例（wss://）

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

#### systemd 服务（可选）

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

### 2. 演奏者（local.py）

安装依赖项：

```bash
pip install -r requirements.txt
```

启动：

```bash
python local.py your-hub-domain.example.com
```

选项：

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `server` | （必须） | Hub 服务器主机名 |
| `--port` | 443 | Hub 服务器端口 |
| `--sc-port` | 57120 | SC 接收端口 |
| `--osc-port` | 57121 | 本地 OSC 接收端口 |
| `--rate` | 48000 | 会话采样率（仅用于显示确认） |
| `--name` | （提示输入） | 会话中使用的名称 |
| `--room` | （提示输入） | 要加入的房间名 |

省略 `--name` 或 `--room` 时，启动时会提示输入。如果房间内存在重名、名称为空、名称超过 64 个字符或包含 `/`，或房间名为空或超过 64 个字符，Hub 将拒绝连接。

#### 演奏者用 SuperCollider 设置

在开始会话前，需要在 SC 中运行以下接收函数。它将接收来自其他演奏者的 OSC（通过 local.py 到达端口 57120），去除 Hub 添加的 `/remote/<n>/` 前缀，并在保留 timetag 的情况下转发给 scsynth，以便正确体现 `sendBundle` 的时序。

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

典型的会话设置：

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

    // 2. 向所有参与者发送 SynthDef
    ~hub = NetAddr("127.0.0.1", 57121);
    ~hub.sendMsg("/d_recv", SynthDef(\sine, { |freq=440, amp=0.2|
        Out.ar(0, SinOsc.ar(freq) * amp * EnvGen.kr(Env.perc, doneAction:2))
    }).asBytes);

    // 3. 使用 sendBundle 跨网络同步时序进行演奏
    ~hub.sendBundle(0.3, ["/s_new", \sine, 2000, 0, 0, \freq, 432]);
});
```

> **关于节点 ID：** 节点 ID 不会自动管理。请参与者事先约定各自的 ID 范围以避免冲突（例如：Alice 使用 1000〜1999，Bob 使用 2000〜2999）。

---

### 3. Radio SCOSC

Radio SCOSC 既可供听众使用，也可供演奏者使用。

#### 自动模式判断

点击 Join 时，Radio SCOSC 会检查 scsynth 是否已经在运行：

| 情况 | 模式 | 行为 |
|------|------|------|
| scsynth **未运行** | **听众** | 启动 sclang 并启动 scsynth，将来自 Hub 的 OSC 转发给 sclang（端口 57120）。自动设置的接收函数去除 `/remote/<n>/` 前缀，并在保留 timetag 的情况下将消息中继给 scsynth。 |
| scsynth **已运行** | **演奏者** | 不启动 sclang。将来自 Hub 的 OSC 转发给现有的 sclang（端口 57120）。需要在编辑器中手动执行 OSCdef 以将 OSC 中继给 scsynth。 |

在两种模式下，Radio SCOSC 都会在端口 57121 接收来自 SC 的 OSC 并转发给 Hub。

#### 使用 Radio SCOSC 的演奏者

演奏者可以使用 Radio SCOSC 代替 local.py。此时：

1. 在启动 Radio SCOSC **之前**，请先在编辑器（SCIDE、vim/scnvim、Emacs/scel、Overtone、Supriya 等）中启动 SC 服务器。
2. 在编辑器中执行以下函数：

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

> **致 Overtone / Supriya 用户：** 上述 OSCdef 适用于 sclang。Overtone 和 Supriya 的 OSC 接收实现方式不同，请参阅各项目的文档。

3. 启动 Radio SCOSC 并加入会话。
4. OSC 的发送目标与 local.py 相同，均为端口 57121（Radio SCOSC）：

```supercollider
~hub = NetAddr("127.0.0.1", 57121);
~hub.sendMsg("/d_recv", SynthDef(\sine, { |freq=440, amp=0.2|
    Out.ar(0, SinOsc.ar(freq) * amp * EnvGen.kr(Env.perc, doneAction:2))
}).asBytes);
~hub.sendBundle(0.3, ["/s_new", \sine, 2000, 0, 0, \freq, 432]);
```

> **重要：** 请务必在启动 Radio SCOSC **之前**，先在编辑器中启动 SC 服务器。若在 scsynth 未运行的状态下启动 Radio SCOSC，将以听众模式启动独立的 scsynth 实例，与编辑器的服务器产生冲突。

#### 前提条件

- 必须**已安装 SuperCollider**。
- Radio SCOSC 会按以下默认路径自动检测 sclang：

| 平台 | 默认路径 |
|------|---------|
| macOS | `/Applications/SuperCollider.app/Contents/MacOS/sclang` |
| Windows | `C:\Program Files\SuperCollider\sclang.exe` |
| Linux | 通过 `which sclang` 检测 |

#### 运行（开发环境）

```bash
cd radio-scosc
npm install
npm start
```

#### 构建

```bash
npm run build:mac    # macOS DMG
npm run build:win    # Windows 安装程序
npm run build:linux  # Linux AppImage
```

#### 使用方法

1. 安装 SuperCollider。
2. *（仅演奏者）* 在编辑器中启动 SC 服务器，并设置好远程代理接收函数后，再启动 Radio SCOSC。
3. 启动 Radio SCOSC。
4. 输入 Hub 服务器地址（例如：`wss://live.example.com` 或 `live.example.com`）、房间名和采样率。
5. **名称字段：**
   - **演奏者模式**（scsynth 已运行）：输入名称。名称在房间内必须唯一，不能为空，不能超过 64 个字符，且不能包含 `/`。
   - **听众模式**（scsynth 未运行）：名称字段将被忽略，系统自动分配 `listener-XXXX` 格式的随机名称。
6. 点击 **Join**。

#### /who 命令

向 Hub 发送 OSC `/who` 消息，可获取当前房间的参与者列表：

```supercollider
~hub = NetAddr("127.0.0.1", 57121);
~hub.sendMsg('/who');
```

Hub 将以 `/who/reply` OSC 消息回复，其中包含当前参与者名称作为字符串参数。同一个 `/who/reply` 也会在加入时自动发送，因此设置好下方的 `OSCdef` 后，无需显式发送 `/who` 即可在连接时收到参与者列表：

```supercollider
OSCdef(\whoReply, { |msg|
    var names = msg[1..];
    ("参与者: " ++ names.join(", ")).postln;
}, '/who/reply');
```

---

## 采样率

所有参与者（演奏者和听众）必须使用相同的采样率。不一致将导致 scsynth 启动错误。

常用采样率：**44100**、**48000**、**96000** Hz

| 平台 | 设置方法 |
|------|---------|
| macOS | 大多数情况下 CoreAudio 会自动调整 |
| Windows | 控制面板 → 声音 → 属性 → 高级 |
| Linux | 启动前通过 JACK 设置（例如：qjackctl） |

---

## 许可证

WebSocket OSC Hub 遵循 SuperCollider 的许可方式，以 [GNU General Public License v3.0](LICENSE) 发布。
