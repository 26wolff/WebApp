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
    if (ws && ws.readyState === WebSocket.OPEN) return;

    const url = `ws://${SERVER_IP}:${SERVER_PORT}/ws`;
    ws = new WebSocket(url);

    ws.onopen = () => {
        console.log("Connected to server");
        clearTimeout(reconnectTimer);
        ws.send("10=applications=get"); // request apps
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log("Server packet:", data);
            if (data.apps || data.steamGames) updateApps(data);
        } catch (err) {
            console.error("JSON parse error:", err);
        }
    };

    ws.onclose = () => {
        console.log("Disconnected. Reconnecting...");
        reconnectTimer = setTimeout(connect, 2000);
    };

    ws.onerror = (err) => {
        console.error("WebSocket error:", err);
    };
}

function updateApps(packet) {
    appsDiv.innerHTML = "";
    appsDiv.classList.add("app-grid");

    const allApps = [
        ...(packet.apps || []),
        ...(packet.steamGames || [])
    ];

    allApps.forEach(app => {
        const btn = document.createElement("button");
        btn.classList.add("app-button");

        const img = document.createElement("img");

        // Desktop app (base64)
        if (app.icon && !app.icon.startsWith("http")) {
            img.src = `data:image/png;base64,${app.icon}`;
        }
        // Steam icon (URL)
        else if (app.icon) {
            img.src = app.icon;
        }

        // Preserve aspect ratio, fit into square 64x64
        img.style.width = "64px";
        img.style.height = "64px";
        img.style.objectFit = "contain"; // preserve aspect ratio
        img.style.background = "#222";   // optional padding background

        const span = document.createElement("span");
        span.textContent = app.name;

        btn.appendChild(img);
        btn.appendChild(span);

        btn.onclick = () => {
            if (!ws || ws.readyState !== WebSocket.OPEN) return;

            // Steam game if it's in steamGames list
            if (packet.steamGames && packet.steamGames.find(g => g.id === app.id)) {
                ws.send(`12=${app.id}=run`);
            } else {
                ws.send(`11=${app.id}=run`);
            }
        };

        appsDiv.appendChild(btn);
    });
}

mainVolume.addEventListener("input", () => {
    if (ws && ws.readyState === WebSocket.OPEN)
        ws.send(`0=main=${mainVolume.value}`);
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

window.addEventListener("load", () => {
    connect();
});