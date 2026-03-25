/**
 * main.js - Electron main process for Radio SCOSC
 *
 * Launches scsynth locally and connects to the hub server via WebSocket.
 * Received OSC binary frames are forwarded to scsynth via UDP as-is.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const dgram = require('dgram');

// --- Configuration ---
const SC_PORT = 57110;
const RECONNECT_MS = 3000;
const SCSYNTH_BOOT_WAIT_MS = 2000;

// Listener name is auto-generated
const MY_NAME = 'Listener-' + Math.floor(Math.random() * 1000);
let HUB_URL    = '';
let roomName   = null;
let sampleRate = 48000;

let mainWindow;
let scsynthProcess;
let wsClient;
const udpClient = dgram.createSocket('udp4');

// =========================================
// scsynth path (platform-aware)
// =========================================
function getScsynthPath() {
    const base = app.isPackaged
        ? path.join(process.resourcesPath, 'sc')
        : path.join(__dirname, 'sc');

    return process.platform === 'win32'
        ? path.join(base, 'scsynth.exe')
        : path.join(base, 'scsynth');
}

// =========================================
// Window
// =========================================
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 480,
        height: 360,
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
    startScsynth();
    setTimeout(connectToHub, SCSYNTH_BOOT_WAIT_MS);
});

// =========================================
// scsynth
// =========================================
function startScsynth() {
    const scsynthPath = getScsynthPath();
    console.log(`Starting scsynth: ${scsynthPath}`);

    scsynthProcess = spawn(scsynthPath, [
        '-u', String(SC_PORT),
        '-a', '1024',
        '-i', '2',
        '-o', '2',
        '-S', String(sampleRate)
    ]);

    scsynthProcess.stdout.on('data', (d) => {
        const msg = d.toString().trim();
        console.log(`[scsynth] ${msg}`);
        sendToUI('log', msg);
    });

    scsynthProcess.stderr.on('data', (d) => {
        const msg = d.toString().trim();
        console.error(`[scsynth err] ${msg}`);
        if (msg.includes('cannot set sample rate') || msg.includes('could not initialize audio')) {
            sendToUI('log', '⚠ Audio init failed. Check that OS audio sample rate matches the session rate.');
        }
    });

    scsynthProcess.on('close', (code) => {
        console.log(`scsynth exited: ${code}`);
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
            // Binary OSC frame — forward directly to scsynth via UDP
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
    if (scsynthProcess) scsynthProcess.kill();
    udpClient.close();
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
