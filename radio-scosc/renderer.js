const dot        = document.getElementById('dot');
const statusText = document.getElementById('status-text');
const logEl      = document.getElementById('log');
const roomInput  = document.getElementById('room-input');
const rateSelect = document.getElementById('rate-select');
const joinBtn    = document.getElementById('join-btn');

const STATUS_LABELS = {
    connecting:   'Connecting...',
    connected:    'Receiving performance',
    disconnected: 'Disconnected — reconnecting...',
    error:        'Error: scsynth stopped'
};

joinBtn.addEventListener('click', () => {
    const room = roomInput.value.trim();
    if (!room) return;
    const rate = parseInt(rateSelect.value);
    joinBtn.disabled    = true;
    roomInput.disabled  = true;
    rateSelect.disabled = true;
    dot.className       = 'connecting';
    statusText.textContent = 'Connecting...';
    window.api.joinRoom(room, rate);
});

roomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinBtn.click();
});

window.api.onStatus((state) => {
    dot.className          = state;
    statusText.textContent = STATUS_LABELS[state] ?? state;
});

window.api.onLog((msg) => {
    const div = document.createElement('div');
    div.textContent = msg;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
});
