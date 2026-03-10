// ===== CONFIGURATION =====
const SERVER_IP = "192.168.2.175";
const SERVER_PORT = "3000";
// ==========================

const appsDiv = document.getElementById('apps');
const mainVolume = document.getElementById('mainVolume');
const micVolume = document.getElementById('micVolume');
const micMuteBtn = document.getElementById('micMuteBtn');

let micTimeout;
let micMuted = false;
let ws = null;
let reconnectTimer = null;

function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        return;
    }

    const url = `ws://${SERVER_IP}:${SERVER_PORT}/ws`;
    ws = new WebSocket(url);

    ws.onopen = () => {
        console.log('Connected');
        clearTimeout(reconnectTimer);
        ws.send('10=applications=get');
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (Array.isArray(data)) {
                updateApps(data);
            }
        } catch (err) {
            console.error('Parse error:', err);
        }
    };

    ws.onclose = () => {
        console.log('Disconnected');
        reconnectTimer = setTimeout(connect, 2000);
    };

    ws.onerror = (err) => {
        console.error('Error:', err);
    };
}

function updateApps(apps) {
    console.log('Received applications:', apps);
    appsDiv.innerHTML = '';

    apps.forEach(app => {
        const div = document.createElement('div');
        div.classList.add('app-item');

        // Save the base64 image locally
        if (app.IconBase64 && app.Name) {
            const fileName = app.Name.replace(/[^a-z0-9]/gi, '_') + '.png'; // safe filename
            const imgPath = `images/${fileName}`;

            // Convert base64 to binary and save using fetch + blob
            const blob = b64toBlob(app.IconBase64, 'image/png');
            const url = URL.createObjectURL(blob);

            const img = document.createElement('img');
            img.src = url;
            img.alt = app.Name;
            img.width = 32;
            img.height = 32;
            div.appendChild(img);

            // Optionally, you can download/save to local storage / file system if using Node.js on Pi
            // For browsers, direct saving to folder is restricted, so you’d need a Node.js server
        }

        const span = document.createElement('span');
        span.textContent = app.Name;
        div.appendChild(span);

        appsDiv.appendChild(div);
    });
}

function b64toBlob(b64Data, contentType = '', sliceSize = 512) {
    const byteCharacters = atob(b64Data);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
        const slice = byteCharacters.slice(offset, offset + sliceSize);
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
            byteNumbers[i] = slice.charCodeAt(i);
        }
        byteArrays.push(new Uint8Array(byteNumbers));
    }
    return new Blob(byteArrays, { type: contentType });
}

mainVolume.addEventListener('input', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(`0=main=${mainVolume.value}`);
    }
});

micVolume.addEventListener('input', () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    clearTimeout(micTimeout);
    micTimeout = setTimeout(() => {
        ws.send(`0=mic=${micVolume.value}`);
    }, 50);
});

micMuteBtn.addEventListener('click', () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    micMuted = !micMuted;
    ws.send(`0=micMute=${micMuted}`);
});

// Auto-connect on page load
window.addEventListener('load', () => {
    connect();
});