# WebSocket OSC Hub

**WebSocket OSC Hub** は、複数の [SuperCollider](https://supercollider.github.io/) 環境間で OSC メッセージをインターネット経由で共有するための最小構成のシステムです。

演奏者はローカルの SC 環境から OSC コマンド（`/d_recv`、`/s_new`、`/n_set`、`/n_free`、`sendBundle` など）をハブサーバーへ送信し、同じルームの他の参加者全員にブロードキャストされます。OSC メッセージと Bundle の両方に対応しており、ハブは各メッセージのアドレスを書き換えつつ、Bundle の timetag はそのまま保持するため、`sendBundle` を使ったリズム・テンポの同期が可能です。

オーディエンス向けクライアント（**Radio SCOSC**）を使えば、SC のコードを書かずにセッションを聴取できます。

---

## アーキテクチャ

```
[SC] <--OSC/UDP--> [local.py] <--wss (binary)--> [hub.py] <--wss (binary)--> [local.py] <--OSC/UDP--> [SC]
                                                      |
                                               [Radio SCOSC]
                                     (Electron アプリ — SuperCollider が必要)
```

OSC パケットは WebSocket 上でバイナリフレームとして転送されます。ハブは各メッセージの OSC アドレスを `/remote/<送信者名>/addr` に書き換えてブロードキャストします。OSC Bundle はネストを含めて再帰的に解析され、含まれる各メッセージのアドレスが書き換えられる一方、timetag は保持されます。これにより、`sendBundle` を使ったリモート間でのリズム・テンポ同期が実現できます。

---

## リポジトリ構成

```
websocket-osc-hub/
├── hub.py            # ハブサーバー（VPS やサーバーで実行）
├── local.py          # 演奏者向けローカルブリッジ
├── requirements.txt  # Python 依存関係
├── LICENSE
├── README.md
└── radio-scosc/      # Radio SCOSC アプリ（Electron）
    ├── main.js
    ├── preload.js
    ├── renderer.html
    ├── renderer.js
    └── package.json
```

---

## デモ

公開デモ Hub が `live.oschub.asia` で稼働しています。このサーバーは常時利用できるとは限りません。

```bash
python local.py live.oschub.asia
```

---

## 要件

### ハブサーバー
- Python 3.10+
- ドメイン名と TLS 証明書を持つサーバー（例：Let's Encrypt）
- wss:// 用のリバースプロキシとして Nginx（または同等のもの）

### 演奏者（local.py）
- Python 3.10+
- SuperCollider 3.x

### Radio SCOSC
- **SuperCollider 3.x**（必須）
- Node.js 18+（開発・ビルド時のみ）

---

## セットアップ

### 1. ハブサーバー

依存関係のインストール:

```bash
pip install -r requirements.txt
```

起動:

```bash
python hub.py --port 8765
```

追加オプション（すべて省略可能）:

| オプション | デフォルト | 説明 |
|-----------|-----------|------|
| `--port` | 8765 | ハブの待ち受けポート |
| `--no-rewrite` | — | OSC アドレス書き換えを無効化（フレームをそのまま転送） |
| `--max-msg-size` | 65536 | メッセージ1件あたりの最大サイズ（バイト） |
| `--rate-limit` | 200 | クライアントあたりの最大メッセージ数／秒 |
| `--log-level` | INFO | ログレベル: `DEBUG`、`INFO`、`WARNING`、`ERROR` |

#### Nginx 設定例（wss://）

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

#### systemd サービス（任意）

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

依存関係のインストール:

```bash
pip install -r requirements.txt
```

起動:

```bash
python local.py your-hub-domain.example.com
```

オプション:

| オプション | デフォルト | 説明 |
|-----------|-----------|------|
| `server` | （必須） | ハブサーバーのホスト名 |
| `--port` | 443 | ハブサーバーのポート |
| `--sc-port` | 57120 | SC の受信ポート |
| `--osc-port` | 57121 | ローカル OSC 受信ポート |
| `--rate` | 48000 | セッションのサンプルレート（確認表示用） |
| `--name` | （プロンプト） | セッション内での名前 |
| `--room` | （プロンプト） | 参加するルーム名 |

`--name` または `--room` を省略した場合は、起動時に入力を求められます。ルーム内で名前が重複している場合、または名前に `/` が含まれている場合はハブから接続を拒否されます。

#### 演奏者向け SuperCollider セットアップ

セッション開始前に、以下の OSCdef を SC で実行しておく必要があります。他の演奏者からの OSC（local.py 経由でポート 57120 に届く）を受信し、scsynth へ転送します。

```supercollider
// リモート演奏者からの OSC を受信し、/remote/<名前>/ プレフィックスを除去して scsynth へ転送する
OSCdef(\remoteProxy, { |msg, time, addr|
    var parts = msg[0].asString.split($/).reject({ |s| s.isEmpty });
    if(parts.size >= 3 && { parts[0] == "remote" }, {
        var cmd = ("/" ++ parts[2..].join("/")).asSymbol;
        s.addr.sendMsg(cmd, *msg[1..]);
    });
}, nil);
```

典型的なセッションセットアップ:

```supercollider
s.waitForBoot({

    // 1. リモートプロキシを設定する
    OSCdef(\remoteProxy, { |msg, time, addr|
        var parts = msg[0].asString.split($/).reject({ |s| s.isEmpty });
        if(parts.size >= 3 && { parts[0] == "remote" }, {
            var cmd = ("/" ++ parts[2..].join("/")).asSymbol;
            s.addr.sendMsg(cmd, *msg[1..]);
        });
    }, nil);

    // 2. SynthDef を全参加者へ送信する
    ~hub = NetAddr("127.0.0.1", 57121);
    ~hub.sendMsg("/d_recv", SynthDef(\sine, { |freq=440, amp=0.2|
        Out.ar(0, SinOsc.ar(freq) * amp * EnvGen.kr(Env.perc, doneAction:2))
    }).asBytes);

    // 3. sendBundle でネットワーク越しにタイミングを合わせて演奏する
    ~hub.sendBundle(0.3, ["/s_new", \sine, 2000, 0, 0, \freq, 432]);
});
```

> **ノード ID について:** ノード ID は自動管理されません。参加者間で事前に範囲を決めて衝突を避けてください（例：Alice は 1000〜1999、Bob は 2000〜2999）。

---

### 3. Radio SCOSC

Radio SCOSC はリスナーと演奏者のどちらにも使用できます。

#### 自動モード判定

Join を押したとき、Radio SCOSC は scsynth が既に起動しているかどうかを確認します:

| 状況 | モード | 動作 |
|------|--------|------|
| scsynth が**起動していない** | **リスナー** | sclang を起動して scsynth をブートし、ハブからの OSC を sclang（ポート 57120）へ転送します。sclang の `OSCdef(\remoteProxy)` が送信者プレフィックスを除去して scsynth へリレーします。 |
| scsynth が**既に起動している** | **演奏者** | sclang を起動しません。ハブからの OSC を既存の sclang（ポート 57120）へ転送します。エディタで OSCdef を手動で実行し、OSC を scsynth へリレーする必要があります。 |

どちらのモードでも、Radio SCOSC はポート 57121 で SC からの OSC を受信してハブへ転送します。

#### Radio SCOSC を使用する演奏者向け

演奏者は local.py の代わりに Radio SCOSC を使用できます。その場合:

1. Radio SCOSC を起動する**前に**、エディタ（SCIDE、vim/scnvim、Emacs/scel、Overtone、Supriya など）で SC サーバーを先にブートしてください。
2. エディタで以下の OSCdef を実行します:

```supercollider
OSCdef(\remoteProxy, { |msg, time, addr|
    var parts = msg[0].asString.split($/).reject({ |s| s.isEmpty });
    if(parts.size >= 3 && { parts[0] == "remote" }, {
        var cmd = ("/" ++ parts[2..].join("/")).asSymbol;
        s.addr.sendMsg(cmd, *msg[1..]);
    });
}, nil);
```

> **Overtone / Supriya ユーザーへ:** 上記の OSCdef は sclang 向けです。Overtone や Supriya では OSC 受信の実装が異なります。各プロジェクトのドキュメントを参照してください。

3. Radio SCOSC を起動してセッションに参加します。
4. OSC の送信先は local.py と同じくポート 57121（Radio SCOSC）です:

```supercollider
~hub = NetAddr("127.0.0.1", 57121);
~hub.sendMsg("/d_recv", SynthDef(\sine, { |freq=440, amp=0.2|
    Out.ar(0, SinOsc.ar(freq) * amp * EnvGen.kr(Env.perc, doneAction:2))
}).asBytes);
~hub.sendBundle(0.3, ["/s_new", \sine, 2000, 0, 0, \freq, 432]);
```

> **重要:** Radio SCOSC を起動する**前に**、必ずエディタで SC サーバーをブートしてください。scsynth が起動していない状態で Radio SCOSC を起動すると、リスナーモードで独自の scsynth インスタンスが起動され、エディタのサーバーと競合します。

#### 前提条件

- **SuperCollider がインストールされている**必要があります。
- Radio SCOSC は以下のデフォルトパスで sclang を自動検出します:

| プラットフォーム | デフォルトパス |
|----------------|--------------|
| macOS | `/Applications/SuperCollider.app/Contents/MacOS/sclang` |
| Windows | `C:\Program Files\SuperCollider\sclang.exe` |
| Linux | `which sclang` で検出 |

#### 実行（開発環境）

```bash
cd radio-scosc
npm install
npm start
```

#### ビルド

```bash
npm run build:mac    # macOS DMG
npm run build:win    # Windows インストーラー
npm run build:linux  # Linux AppImage
```

#### 使い方

1. SuperCollider をインストールする。
2. *（演奏者のみ）* エディタで SC サーバーをブートし、`OSCdef(\remoteProxy, ...)` を実行してから Radio SCOSC を起動する。
3. Radio SCOSC を起動する。
4. ハブサーバーのアドレス（例：`wss://live.example.com` または `live.example.com`）、ルーム名、サンプルレートを入力する。
5. **名前フィールド:**
   - **演奏者モード**（scsynth 起動済み）: 名前を入力する。ルーム内で一意であり、`/` を含まない必要がある。
   - **リスナーモード**（scsynth 未起動）: 名前フィールドは無視され、`listener-XXXX` 形式のランダムな名前が自動で割り当てられる。
6. **Join** をクリックする。

#### /who コマンド

ハブへ OSC `/who` メッセージを送信することで、現在のルームの参加者一覧を取得できます:

```supercollider
~hub = NetAddr("127.0.0.1", 57121);
~hub.sendMsg('/who');
```

ハブは `/who/reply` OSC メッセージで返信し、現在の参加者名が文字列引数として含まれます。同じ `/who/reply` は参加時にも自動的に送信されるため、以下の `OSCdef` を設定しておけば `/who` を明示的に送らなくても接続時に参加者一覧を受け取ることができます:

```supercollider
OSCdef(\whoReply, { |msg|
    var names = msg[1..];
    ("参加者: " ++ names.join(", ")).postln;
}, '/who/reply');
```

---

## サンプルレート

すべての参加者（演奏者・リスナー）は同じサンプルレートを使用する必要があります。不一致があると scsynth の起動エラーが発生します。

一般的なレート: **44100**、**48000**、**96000** Hz

| プラットフォーム | 設定方法 |
|----------------|---------|
| macOS | ほとんどの場合 CoreAudio が自動調整 |
| Windows | コントロールパネル → サウンド → プロパティ → 詳細 |
| Linux | 起動前に JACK で設定（例：qjackctl） |

---

## ライセンス

WebSocket OSC Hub は SuperCollider に準じ、[GNU General Public License v3.0](LICENSE) のもとで公開されています。
