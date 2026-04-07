# WebSocket OSC Hub

**WebSocket OSC Hub**는 여러 [SuperCollider](https://supercollider.github.io/) 환경 간에 OSC 메시지를 인터넷을 통해 공유하기 위한 최소 구성의 시스템입니다.

연주자는 로컬 SC 환경에서 OSC 커맨드(`/d_recv`, `/s_new`, `/n_set`, `/n_free`, `sendBundle` 등)를 허브 서버로 전송하면, 같은 룸의 다른 참가자 전원에게 브로드캐스트됩니다. OSC 메시지와 Bundle 모두 지원하며, 허브는 각 메시지의 주소를 재작성하면서 Bundle의 timetag는 그대로 유지하기 때문에 `sendBundle`을 사용한 리듬·템포 동기화가 가능합니다.

오디언스용 클라이언트(**Radio SCOSC**)를 사용하면 SC 코드를 작성하지 않고도 세션을 청취할 수 있습니다.

---

## 아키텍처

```
[SC] <--OSC/UDP--> [local.py] <--wss (binary)--> [hub.py] <--wss (binary)--> [local.py] <--OSC/UDP--> [SC]
                                                      |
                                               [Radio SCOSC]
                                     (Electron 앱 — SuperCollider 필요)
```

OSC 패킷은 WebSocket 상에서 바이너리 프레임으로 전송됩니다. 허브는 각 메시지의 OSC 주소를 `/remote/<송신자명>/addr`로 재작성하여 브로드캐스트합니다. OSC Bundle은 중첩을 포함하여 재귀적으로 파싱되며, 포함된 각 메시지의 주소가 재작성되는 반면 timetag는 유지됩니다. 이를 통해 `sendBundle`을 사용한 원격 간 리듬·템포 동기화가 실현됩니다.

---

## 리포지토리 구성

```
websocket-osc-hub/
├── hub.py            # 허브 서버（VPS나 서버에서 실행）
├── local.py          # 연주자용 로컬 브리지
├── requirements.txt  # Python 의존관계
├── LICENSE
├── README.md
└── radio-scosc/      # Radio SCOSC 앱（Electron）
    ├── main.js
    ├── preload.js
    ├── renderer.html
    ├── renderer.js
    └── package.json
```

---

## 데모

공개 데모 Hub가 `live.oschub.asia`에서 운영 중입니다. 이 서버는 항상 접속 가능하지 않을 수 있습니다.

```bash
python local.py live.oschub.asia
```

---

## 요건

### 허브 서버
- Python 3.10+
- 도메인명과 TLS 인증서를 가진 서버（예: Let's Encrypt）
- wss:// 용 리버스 프록시로 Nginx（또는 동등한 것）

### 연주자（local.py）
- Python 3.10+
- SuperCollider 3.x

### Radio SCOSC
- **SuperCollider 3.x**（필수）
- Node.js 18+（개발·빌드 시에만）

---

## 설정

### 1. 허브 서버

의존관계 설치:

```bash
pip install -r requirements.txt
```

시작:

```bash
python hub.py --port 8765
```

추가 옵션（모두 생략 가능）:

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--port` | 8765 | 허브의 수신 포트 |
| `--no-rewrite` | — | OSC 주소 재작성 비활성화（프레임을 그대로 전송） |
| `--max-msg-size` | 65536 | 메시지 1건당 최대 크기（바이트） |
| `--rate-limit` | 200 | 클라이언트당 최대 메시지 수／초 |
| `--log-level` | INFO | 로그 레벨: `DEBUG`, `INFO`, `WARNING`, `ERROR` |

#### Nginx 설정 예시（wss://）

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

#### systemd 서비스（선택사항）

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

### 2. 연주자（local.py）

의존관계 설치:

```bash
pip install -r requirements.txt
```

시작:

```bash
python local.py your-hub-domain.example.com
```

옵션:

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `server` | （필수） | 허브 서버의 호스트명 |
| `--port` | 443 | 허브 서버의 포트 |
| `--sc-port` | 57120 | SC의 수신 포트 |
| `--osc-port` | 57121 | 로컬 OSC 수신 포트 |
| `--rate` | 48000 | 세션의 샘플레이트（확인 표시용） |
| `--name` | （프롬프트） | 세션 내에서의 이름 |
| `--room` | （프롬프트） | 참가할 룸 이름 |

`--name` 또는 `--room`을 생략한 경우 시작 시 입력을 요청합니다. 룸 내에서 이름이 중복되거나 이름이 비어 있거나 64자를 초과하거나 `/`가 포함된 경우, 또는 룸 이름이 비어 있거나 64자를 초과하는 경우 허브에서 연결이 거부됩니다.

#### 연주자용 SuperCollider 설정

세션 시작 전에 다음 수신 함수를 SC에서 실행해두어야 합니다. 다른 연주자로부터의 OSC（local.py 경유로 포트 57120에 도달）를 수신하여 허브가 추가한 `/remote/<n>/` 프리픽스를 제거하고, timetag를 보존하여 scsynth로 전달하기 때문에 `sendBundle`의 타이밍이 올바르게 반영됩니다.

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

일반적인 세션 설정:

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

    // 2. SynthDef를 모든 참가자에게 전송
    ~hub = NetAddr("127.0.0.1", 57121);
    ~hub.sendMsg("/d_recv", SynthDef(\sine, { |freq=440, amp=0.2|
        Out.ar(0, SinOsc.ar(freq) * amp * EnvGen.kr(Env.perc, doneAction:2))
    }).asBytes);

    // 3. sendBundle으로 네트워크를 통해 타이밍을 맞춰 연주
    ~hub.sendBundle(0.3, ["/s_new", \sine, 2000, 0, 0, \freq, 432]);
});
```

> **노드 ID에 대해:** 노드 ID는 자동으로 관리되지 않습니다. 참가자 간에 미리 범위를 정하여 충돌을 방지하세요（예: Alice는 1000〜1999, Bob은 2000〜2999）.

---

### 3. Radio SCOSC

Radio SCOSC는 리스너와 연주자 모두 사용할 수 있습니다.

#### 자동 모드 판정

Join을 누를 때, Radio SCOSC는 scsynth가 이미 실행 중인지 확인합니다:

| 상황 | 모드 | 동작 |
|------|------|------|
| scsynth가 **실행 중이 아닌** 경우 | **리스너** | sclang을 시작하여 scsynth를 부팅하고, 허브로부터의 OSC를 sclang（포트 57120）으로 전달합니다. 자동으로 설정되는 수신 함수가 `/remote/<n>/` 프리픽스를 제거하고, timetag를 보존하여 scsynth로 릴레이합니다. |
| scsynth가 **이미 실행 중인** 경우 | **연주자** | sclang을 시작하지 않습니다. 허브로부터의 OSC를 기존 sclang（포트 57120）으로 전달합니다. 에디터에서 OSCdef를 수동으로 실행하여 OSC를 scsynth로 릴레이해야 합니다. |

어느 모드에서도 Radio SCOSC는 포트 57121에서 SC로부터의 OSC를 수신하여 허브로 전달합니다.

#### Radio SCOSC를 사용하는 연주자용

연주자는 local.py 대신 Radio SCOSC를 사용할 수 있습니다. 그 경우:

1. Radio SCOSC를 시작하기 **전에**, 에디터（SCIDE, vim/scnvim, Emacs/scel, Overtone, Supriya 등）에서 SC 서버를 먼저 부팅하세요.
2. 에디터에서 다음 함수를 실행합니다:

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

> **Overtone / Supriya 사용자에게:** 위의 `thisProcess.addOSCRecvFunc`는 sclang용입니다. Overtone이나 Supriya에서는 OSC 수신 구현이 다릅니다. 각 프로젝트의 문서를 참조하세요.

3. Radio SCOSC를 시작하여 세션에 참가합니다.
4. OSC의 송신처는 local.py와 동일하게 포트 57121（Radio SCOSC）입니다:

```supercollider
~hub = NetAddr("127.0.0.1", 57121);
~hub.sendMsg("/d_recv", SynthDef(\sine, { |freq=440, amp=0.2|
    Out.ar(0, SinOsc.ar(freq) * amp * EnvGen.kr(Env.perc, doneAction:2))
}).asBytes);
~hub.sendBundle(0.3, ["/s_new", \sine, 2000, 0, 0, \freq, 432]);
```

> **중요:** Radio SCOSC를 시작하기 **전에**, 반드시 에디터에서 SC 서버를 부팅하세요. scsynth가 실행되지 않은 상태에서 Radio SCOSC를 시작하면 리스너 모드로 자체 scsynth 인스턴스가 시작되어 에디터의 서버와 충돌합니다.

#### 전제조건

- **SuperCollider가 설치되어 있어야** 합니다.
- Radio SCOSC는 다음 기본 경로에서 sclang을 자동 감지합니다:

| 플랫폼 | 기본 경로 |
|--------|----------|
| macOS | `/Applications/SuperCollider.app/Contents/MacOS/sclang` |
| Windows | `C:\Program Files\SuperCollider\sclang.exe` |
| Linux | `which sclang`으로 감지 |

#### 실행（개발 환경）

```bash
cd radio-scosc
npm install
npm start
```

#### 빌드

```bash
npm run build:mac    # macOS DMG
npm run build:win    # Windows 인스톨러
npm run build:linux  # Linux AppImage
```

#### 사용법

1. SuperCollider를 설치합니다.
2. *（연주자만）* 에디터에서 SC 서버를 부팅하고 리모트 프록시 수신 함수를 설정한 후 Radio SCOSC를 시작합니다.
3. Radio SCOSC를 시작합니다.
4. 허브 서버 주소（예: `wss://live.example.com` 또는 `live.example.com`）, 룸 이름, 샘플레이트를 입력합니다.
5. **이름 필드:**
   - **연주자 모드**（scsynth 실행 중）: 이름을 입력합니다. 룸 내에서 고유해야 하며, 비어 있지 않아야 하며, 64자를 초과하지 않아야 하며, `/`를 포함하지 않아야 합니다.
   - **리스너 모드**（scsynth 미실행）: 이름 필드는 무시되며 `listener-XXXX` 형식의 랜덤 이름이 자동으로 할당됩니다.
6. **Join**을 클릭합니다.

#### /who 커맨드

허브에 OSC `/who` 메시지를 전송하여 현재 룸의 참가자 목록을 얻을 수 있습니다:

```supercollider
~hub = NetAddr("127.0.0.1", 57121);
~hub.sendMsg('/who');
```

허브는 `/who/reply` OSC 메시지로 응답하며, 현재 참가자 이름이 문자열 인수로 포함됩니다. 동일한 `/who/reply`는 참가 시에도 자동으로 전송되므로, 아래의 `OSCdef`를 설정해두면 `/who`를 명시적으로 보내지 않아도 연결 시 참가자 목록을 받을 수 있습니다:

```supercollider
OSCdef(\whoReply, { |msg|
    var names = msg[1..];
    ("참가자: " ++ names.join(", ")).postln;
}, '/who/reply');
```

---

## 샘플레이트

모든 참가자（연주자·리스너）는 동일한 샘플레이트를 사용해야 합니다. 불일치가 있으면 scsynth 시작 오류가 발생합니다.

일반적인 레이트: **44100**, **48000**, **96000** Hz

| 플랫폼 | 설정 방법 |
|--------|----------|
| macOS | 대부분의 경우 CoreAudio가 자동 조정 |
| Windows | 제어판 → 사운드 → 속성 → 고급 |
| Linux | 시작 전에 JACK으로 설정（예: qjackctl） |

---

## 라이선스

WebSocket OSC Hub는 SuperCollider에 준하여 [GNU General Public License v3.0](LICENSE) 하에 공개되어 있습니다.
