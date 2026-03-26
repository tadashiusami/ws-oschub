/**
 * main.js - Electron main process for Radio SCOSC
 *
 * Launches sclang (SuperCollider must be installed) and connects to the
 * hub server via WebSocket. Received OSC binary frames are forwarded to
 * sclang via UDP, which relays them to scsynth via OSCdef.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const WebSocket = require('ws');
const dgram = require('dgram');

// --- Configuration ---
const SC_PORT      = 57120;   // sclang receive port
const RECONNECT_MS = 3000;

// Listener name is auto-generated
const MY_NAME = 'Listener-' + Math.floor(Math.random() * 1000);
let HUB_URL    = '';
let roomName   = null;
let sampleRate = 48000;

let mainWindow;
let sclangProcess;
let wsClient;
const udpClient = dgram.createSocket('udp4');

// =========================================
// sclang path detection
// =========================================
function getSclangPath() {
    // Platform-specific candidate paths
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
        // Search PATH dynamically on Linux
        try {
            const found = execSync('which sclang').toString().trim();
            if (found) return found;
        } catch {}
        // Common fallback paths
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
ipcMain.on('join-room', (event, { hub, room, rate }) => {
    HUB_URL    = hub;
    roomName   = room;
    sampleRate = rate;
    startSclang(rate, () => {
        connectToHub();
    });
});

// =========================================
// sclang
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

    // Write init code to a temp file
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

    // Timeout fallback (5 seconds)
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

        // Detect boot completion
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
            room: roomName,
            role: 'audience'
        }));
    });

    wsClient.on('message', (raw) => {
        if (raw instanceof Buffer) {
            // Binary OSC frame — forward to sclang via UDP
            udpClient.send(raw, SC_PORT, '127.0.0.1', (err) => {
                if (err) console.error('UDP send error:', err);
            });
        } else {
            // Text frame — info message from hub
            let data;
            try { data = JSON.parse(raw); }
            catch { return; }
            if (data.type === 'info') {
                sendToUI('status', 'connected');
                sendToUI('log', data.message);
            }
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

app.on('window-all-closed', () => {
    if (sclangProcess) sclangProcess.kill();
    udpClient.close();
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
