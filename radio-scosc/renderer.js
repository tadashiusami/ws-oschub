const dot        = document.getElementById('dot');
const statusText = document.getElementById('status-text');
const logEl      = document.getElementById('log');
const hubInput   = document.getElementById('hub-input');
const roomInput  = document.getElementById('room-input');
const nameInput  = document.getElementById('name-input');
const rateSelect = document.getElementById('rate-select');
const joinBtn    = document.getElementById('join-btn');

const STATUS_LABELS = {
    connecting:   'Connecting...',
    connected:    'Receiving performance',
    disconnected: 'Disconnected — reconnecting...',
    error:        'Error: sclang stopped'
};

joinBtn.addEventListener('click', () => {
    const hub  = hubInput.value.trim();
    const room = roomInput.value.trim();
    const name = nameInput.value.trim();
    if (!hub || !room) return;
    const rate = parseInt(rateSelect.value);
    joinBtn.disabled    = true;
    hubInput.disabled   = true;
    roomInput.disabled  = true;
    nameInput.disabled  = true;
    rateSelect.disabled = true;
    dot.className       = 'connecting';
    statusText.textContent = 'Connecting...';
    window.api.joinRoom(hub, room, rate, name);
});

roomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinBtn.click();
});

nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinBtn.click();
});

window.api.onStatus((state) => {
    dot.className          = state;
    statusText.textContent = STATUS_LABELS[state] ?? state;

    // Re-enable UI on unrecoverable error so the user can correct and retry
    if (state === 'error') {
        joinBtn.disabled    = false;
        hubInput.disabled   = false;
        roomInput.disabled  = false;
        nameInput.disabled  = false;
        rateSelect.disabled = false;
    }
});

window.api.onLog((msg) => {
    const div = document.createElement('div');
    div.textContent = msg;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
});
