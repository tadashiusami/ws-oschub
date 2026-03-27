/**
 * main.js - Electron main process for Radio SCOSC
 *
 * Behaviour depends on whether scsynth is already running when Join is pressed:
 *
 * Listener mode (scsynth NOT running):
 *   - Launches sclang + scsynth automatically.
 *   - Sets up OSCdef(\remoteProxy) automatically.
 *   - Forwards hub OSC to port 57110 (scsynth directly).
 *   - Quits scsynth on app exit.
 *
 * Performer mode (scsynth already running):
 *   - Does NOT launch sclang.
 *   - Forwards hub OSC to port 57120 (existing sclang).
 *   - The performer must run OSCdef(\remoteProxy) manually in their editor.
 *   - Does NOT quit scsynth on app exit.
 *
 * In both modes, listens on UDP port 57121 for OSC from SC and forwards
 * it to the hub, so performers can use Radio SCOSC instead of local.py.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const WebSocket = require('ws');
const dgram = require('dgram');

// --- Configuration ---
const SCSYNTH_PORT = 57110;  // scsynth OSC port
const SCLANG_PORT  = 57120;  // sclang OSC port
const OSC_IN_PORT  = 57121;  // listens for OSC from SC (SC → hub)
const RECONNECT_MS = 3000;

const MY_NAME = 'User-' + Math.floor(Math.random() * 1000);
let HUB_URL       = '';
let roomName      = null;
let sampleRate    = 48000;
let scReceivePort = SCLANG_PORT;   // updated based on mode
let launchedScsynth = false;       // true only if Radio SCOSC started scsynth

let mainWindow;
let sclangProcess;
let wsClient;
const udpClient = dgram.createSocket('udp4');
const udpServer = dgram.createSocket('udp4');

// =========================================
// sclang path detection
// =========================================
function getSclangPath() {
    const candidates = {
        darwin: [
            '/Applications/SuperCollider.app/Contents/MacOS/sclang',
            `${os.homedir()}/Applications/SuperCollider.app/Contents/MacOS/sclang`
        ],
        win32: [
            'C:\\Program Files\\SuperCollider\\sclang.exe',
            'C:\\Program Files (x86)\\SuperCollider\\sclang.exe'
        ]
    };

    if (process.platform === 'linux') {
        try {
            const found = execSync('which sclang').toString().trim();
            if (found) return found;
        } catch {}
        const linuxPaths = [
            '/usr/bin/sclang',
            '/usr/local/bin/sclang',
            '/opt/SuperCollider/sclang'
        ];
        for (const p of linuxPaths) {
            if (fs.existsSync(p)) return p;
        }
        return null;
    }

    const paths = candidates[process.platform] || [];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

// =========================================
// Check if scsynth is already running
// =========================================
function checkScsynth() {
    return new Promise((resolve) => {
        const checker = dgram.createSocket('udp4');
        let responded = false;

        // Minimal OSC /status message
        const status = Buffer.from([
            0x2f, 0x73, 0x74, 0x61, 0x74, 0x75, 0x73, 0x00,  // '/status\0'
            0x2c, 0x00, 0x00, 0x00                              // ',\0\0\0'
        ]);

        checker.on('message', () => {
            responded = true;
            try { checker.close(); } catch {}
            resolve(true);
        });

        checker.on('error', () => {
            try { checker.close(); } catch {}
            resolve(false);
        });

        checker.bind(() => {
            checker.send(status, SCSYNTH_PORT, '127.0.0.1');
            setTimeout(() => {
                if (!responded) {
                    try { checker.close(); } catch {}
                    resolve(false);
                }
            }, 500);
        });
    });
}

// =========================================
// Quit scsynth via OSC /quit
// =========================================
function quitScsynth() {
    return new Promise((resolve) => {
        const quit = Buffer.from([
            0x2f, 0x71, 0x75, 0x69, 0x74, 0x00, 0x00, 0x00,  // '/quit\0\0\0'
            0x2c, 0x00, 0x00, 0x00                              // ',\0\0\0'
        ]);
        udpClient.send(quit, SCSYNTH_PORT, '127.0.0.1', () => resolve());
    });
}

// =========================================
// Window
// =========================================
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 480,
        height: 400,
        resizable: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true
        }
    });
    mainWindow.loadFile('renderer.html');
}

// =========================================
// IPC
// =========================================
ipcMain.on('join-room', async (event, { hub, room, rate }) => {
    HUB_URL    = hub.startsWith('ws') ? hub : 'wss://' + hub;
    roomName   = room;
    sampleRate = rate;

    const scsynthRunning = await checkScsynth();

    if (scsynthRunning) {
        // Performer mode: scsynth already running
        launchedScsynth = false;
        scReceivePort   = SCLANG_PORT;  // forward hub OSC to sclang (57120)
        sendToUI('log', 'scsynth already running — performer mode.');
        sendToUI('log', 'Please run OSCdef(\\remoteProxy, ...) in your SC editor.');
        connectToHub();
        startUdpServer();
    } else {
        // Listener mode: launch sclang + scsynth
        launchedScsynth = true;
        scReceivePort   = SCSYNTH_PORT;  // forward hub OSC directly to scsynth (57110)
        sendToUI('log', 'scsynth not found — launching sclang (listener mode).');
        startSclang(rate, () => {
            connectToHub();
            startUdpServer();
        });
    }
});

// =========================================
// sclang: full boot (listener mode only)
// =========================================
function startSclang(rate, onReady) {
    const sclangPath = getSclangPath();
    if (!sclangPath) {
        sendToUI('log', '⚠ sclang not found. Please install SuperCollider.');
        sendToUI('status', 'error');
        return;
    }

    console.log(`Starting sclang: ${sclangPath}`);
    sendToUI('log', `Starting sclang: ${sclangPath}`);

    const initCode = [
        `s.options.sampleRate = ${rate};`,
        `s.waitForBoot({`,
        `    OSCdef(\\remoteProxy, { |msg, time, addr|`,
        `        s.addr.sendMsg(*msg);`,
        `    }, '/remote');`,
        `    "Radio SCOSC ready".postln;`,
        `});`
    ].join('\n');

    const tmpFile = path.join(os.tmpdir(), 'radio-scosc-init.scd');
    fs.writeFileSync(tmpFile, initCode);

    sclangProcess = spawn(sclangPath, [tmpFile]);

    let ready = false;

    const timeout = setTimeout(() => {
        if (!ready) {
            console.log('sclang boot timeout — connecting anyway');
            ready = true;
            onReady();
        }
    }, 5000);

    sclangProcess.stdout.on('data', (d) => {
        const msg = d.toString().trim();
        console.log(`[sclang] ${msg}`);
        sendToUI('log', msg);
        if (!ready && msg.includes('Radio SCOSC ready')) {
            clearTimeout(timeout);
            ready = true;
            onReady();
        }
    });

    sclangProcess.stderr.on('data', (d) => {
        const msg = d.toString().trim();
        console.error(`[sclang err] ${msg}`);
        if (msg.includes('cannot set sample rate') || msg.includes('could not initialize audio')) {
            sendToUI('log', '⚠ Audio init failed. Check that OS audio sample rate matches the session rate.');
        }
    });

    sclangProcess.on('close', (code) => {
        console.log(`sclang exited: ${code}`);
        sendToUI('status', 'error');
    });
}

// =========================================
// UDP server (SC → Radio SCOSC → hub)
// =========================================
function startUdpServer() {
    udpServer.bind(OSC_IN_PORT, '127.0.0.1', () => {
        console.log(`UDP server listening on port ${OSC_IN_PORT} (SC → hub)`);
    });

    udpServer.on('message', (msg) => {
        if (wsClient && wsClient.readyState === WebSocket.OPEN) {
            wsClient.send(msg);
        }
    });

    udpServer.on('error', (err) => {
        console.error('UDP server error:', err.message);
        sendToUI('log', `⚠ UDP server error: ${err.message}`);
    });
}

// =========================================
// WebSocket connection
// =========================================
function connectToHub() {
    sendToUI('status', 'connecting');
    wsClient = new WebSocket(HUB_URL);

    wsClient.on('open', () => {
        console.log('Connected to hub');
        wsClient.send(JSON.stringify({
            type: 'join',
            name: MY_NAME,
            room: roomName
        }));
    });

    wsClient.on('message', (raw, isBinary) => {
        if (!isBinary) {
            // Text frame — info message from hub
            let data;
            try { data = JSON.parse(raw.toString()); }
            catch { return; }
            if (data.type === 'info') {
                sendToUI('status', 'connected');
                sendToUI('log', data.message);
            }
        } else {
            // Binary frame — raw OSC data
            // Forward to scsynth (listener) or sclang (performer)
            udpClient.send(raw, scReceivePort, '127.0.0.1', (err) => {
                if (err) console.error('UDP send error:', err);
            });
        }
    });

    wsClient.on('close', () => {
        sendToUI('status', 'disconnected');
        console.log(`Disconnected. Reconnecting in ${RECONNECT_MS}ms...`);
        setTimeout(connectToHub, RECONNECT_MS);
    });

    wsClient.on('error', (err) => {
        console.error('WS error:', err.message);
    });
}

// =========================================
// Send to renderer
// =========================================
function sendToUI(channel, message) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, message);
    }
}

// =========================================
// App lifecycle
// =========================================
app.whenReady().then(() => {
    createWindow();
});

app.on('window-all-closed', async () => {
    if (sclangProcess) sclangProcess.kill();

    // Only quit scsynth if Radio SCOSC started it (listener mode)
    if (launchedScsynth) {
        await quitScsynth();
    }

    udpClient.close();
    udpServer.close();
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
