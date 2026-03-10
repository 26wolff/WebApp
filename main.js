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

    if (ws && ws.readyState === WebSocket.OPEN)
        return;

    const url = `ws://${SERVER_IP}:${SERVER_PORT}/ws`;

    ws = new WebSocket(url);

    ws.onopen = () => {

        console.log("Connected to server");

        clearTimeout(reconnectTimer);

        // Request applications
        ws.send("10=applications=get");

    };

    ws.onmessage = (event) => {

        try {

            const data = JSON.parse(event.data);

            console.log("Server packet:", data);

            if (data.apps || data.steamGames)
                updateApps(data);

        }
        catch (err) {

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

    console.log("Rendering applications...");

    appsDiv.innerHTML = "";

    const allApps = [
        ...(packet.apps || []),
        ...(packet.steamGames || [])
    ];

    allApps.forEach(app => {

        const div = document.createElement("div");
        div.classList.add("app-item");

        const img = document.createElement("img");

        // Desktop app (base64)
        if (app.icon && !app.icon.startsWith("http")) {

            img.src = `data:image/png;base64,${app.icon}`;

        }
        // Steam icon (URL)
        else if (app.icon) {

            img.src = app.icon;

        }

        img.width = 32;
        img.height = 32;

        div.appendChild(img);

        const span = document.createElement("span");

        span.textContent = app.name;

        div.appendChild(span);

        div.onclick = () => {

            if (!ws || ws.readyState !== WebSocket.OPEN)
                return;

            // Steam game
            if (packet.steamGames && packet.steamGames.includes(app)) {

                ws.send(`12=${app.id}=run`);

            }
            // Desktop app
            else {

                ws.send(`11=${app.id}=run`);

            }

        };

        appsDiv.appendChild(div);

    });

}

mainVolume.addEventListener("input", () => {

    if (ws && ws.readyState === WebSocket.OPEN)
        ws.send(`0=main=${mainVolume.value}`);

});

micVolume.addEventListener("input", () => {

    if (!ws || ws.readyState !== WebSocket.OPEN)
        return;

    clearTimeout(micTimeout);

    micTimeout = setTimeout(() => {

        ws.send(`0=mic=${micVolume.value}`);

    }, 50);

});

micMuteBtn.addEventListener("click", () => {

    if (!ws || ws.readyState !== WebSocket.OPEN)
        return;

    micMuted = !micMuted;

    ws.send(`0=micmute=${micMuted}`);

});

window.addEventListener("load", () => {

    connect();

});