const appsDiv = document.getElementById('apps');
const mainVolume = document.getElementById('mainVolume');
const micVolume = document.getElementById('micVolume');
const micMuteBtn = document.getElementById('micMuteBtn');
const pcIPInput = document.getElementById('pcIP');
const connectBtn = document.getElementById('connectBtn');
const statusDiv = document.getElementById('status');

let micTimeout;
let micMuted = false;
let ws;
let pcIP = pcIPInput.value;

function updateStatus(message) {
    statusDiv.textContent = message;
    console.log(message);
}

function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }

    const PC_WS_URL = `ws://${pcIP}:9000/ws/`;
    updateStatus(`Attempting to connect to ${PC_WS_URL}`);
    ws = new WebSocket(PC_WS_URL);

    ws.onopen = () => {
        updateStatus('Connected to PC!');
        console.log('Requesting applications...');
        ws.send('10=applications=get');
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (Array.isArray(data)) {
                updateApps(data);
            }
        } catch (err) {
            console.log('Non-JSON message received:', event.data);
        }
    };

    ws.onclose = (event) => {
        updateStatus(`Connection lost. Code: ${event.code}, Reason: ${event.reason}. Click Connect to retry.`);
    };

    ws.onerror = (err) => {
        updateStatus('WebSocket error. Check IP and network.');
        console.error('WebSocket error:', err);
        console.log('WebSocket readyState:', ws.readyState);
        if (ws.readyState !== WebSocket.OPEN) ws.close();
    };
}

connectBtn.addEventListener('click', () => {
    pcIP = pcIPInput.value;
    connect();
});

// Auto-connect on load if IP is set
if (pcIP) {
    connect();
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

// Utility to convert base64 to Blob
function b64toBlob(b64Data, contentType = '', sliceSize = 512) {
    const byteCharacters = atob(b64Data);
    const byteArrays = [];

    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
        const slice = byteCharacters.slice(offset, offset + sliceSize);

        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
            byteNumbers[i] = slice.charCodeAt(i);
        }

        const byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
    }

    return new Blob(byteArrays, { type: contentType });
}

// Send commands when volume sliders change
mainVolume.addEventListener('input', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(`0=main=${mainVolume.value}`);
    } else {
        updateStatus('Not connected. Please connect first.');
    }
});


micVolume.addEventListener('input', () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        updateStatus('Not connected. Please connect first.');
        return;
    }

    clearTimeout(micTimeout); // cancel previous scheduled send
    micTimeout = setTimeout(() => {
        ws.send(`0=mic=${micVolume.value}`);
    }, 50); // send 50ms after last input
});

micMuteBtn.addEventListener('click', () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        updateStatus('Not connected. Please connect first.');
        return;
    }

    micMuted = !micMuted;
    ws.send(`0=micMute=${micMuted}`); // send true/false to mute/unmute
    console.log('Mic mute state:', micMuted);
});