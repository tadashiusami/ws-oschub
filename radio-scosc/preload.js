const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    onStatus: (cb) => ipcRenderer.on('status', (_, v) => cb(v)),
    onLog:    (cb) => ipcRenderer.on('log',    (_, v) => cb(v)),
    joinRoom: (hub, room, rate) => ipcRenderer.send('join-room', { hub, room, rate }),
});
