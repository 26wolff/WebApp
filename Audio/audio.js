const mainVolume = document.getElementById('mainVolume');
const micVolume = document.getElementById('micVolume');
const micMuteBtn = document.getElementById('micMuteBtn');

mainVolume.addEventListener("input", () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(`0=main=${mainVolume.value}`);
    }
});

micVolume.addEventListener("input", () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    clearTimeout(micTimeout);
    micTimeout = setTimeout(() => {
        ws.send(`0=mic=${micVolume.value}`);
    }, 50);
});

micMuteBtn.addEventListener("click", () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    micMuted = !micMuted;
    ws.send(`0=micmute=${micMuted}`);
});
