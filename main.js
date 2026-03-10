
// manager.js
export const Manager = new class {
    constructor() {
        // ===== CONFIGURATION =====
        this.SERVER_IP = "192.168.2.175";
        this.SERVER_PORT = "3000";
        // ==========================

        this.micTimeout;
        this.micMuted = false;
        this.ws = null;
        this.reconnectTimer = null;

        this.sliderData = {};
        this.appData = {};
        this.steamData = {};

        this.startup();
    }

    startup() {
        // Load local JSON first
        this.loadLocalData();

        // Uncomment the next line when server is ready
        this.loadLocalSliderData();
        //this.connectWebSocket();
    }

    loadLocalSliderData() {
        fetch('Audio/sliders.json')
            .then(res => res.json())
            .then(data => {
                this.updateSliderData(data.sliders || []);
            })
            .catch(err => console.error('Failed to load data.json:', err));
    }
    loadLocalData() {
        fetch('data.json')
            .then(res => res.json())
            .then(data => {
                this.updateAppData(data.apps || []);
                this.updateSteamData(data.steamGames || []);
            })
            .catch(err => console.error('Failed to load data.json:', err));
    }

    connectWebSocket() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

        const url = `ws://${this.SERVER_IP}:${this.SERVER_PORT}/ws`;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            console.log("[WS] Connected to server");
            clearTimeout(this.reconnectTimer);

            // Request initial packets
            this.sendPacket(10, "applications", "get");
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                console.log("[WS MSG]", msg);

                // Dynamically update data based on keys
                for (const key in msg) {
                    if (!msg.hasOwnProperty(key)) continue;

                    const value = msg[key];

                    switch (key) {
                        case "sliders":
                            this.updateSliderData(value);
                            break;
                        case "apps":
                            this.updateAppData(value);
                            break;
                        case "steamGames":
                            this.updateSteamData(value);
                            break;
                        default:
                            // If you have other keys in the future, just store them dynamically
                            this[key] = value;
                            console.log(`[UPDATE] ${key} updated dynamically`, value);
                            break;
                    }
                }
            } catch (err) {
                console.warn("[WS] Failed to parse JSON message:", err);
            }
        };

        this.ws.onclose = () => {
            console.log("[WS] Disconnected, reconnecting in 2s...");
            this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 2000);
        };

        this.ws.onerror = (err) => console.error("[WS ERROR]", err);
    }

    sendPacket(type, name, value) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(`${type}=${name}=${value}`);
        }
    }

    updateAppData(packet) {
        this.appData = packet;
        console.log("[UPDATE] Applications:", this.appData);
    }

    updateSliderData(packet) {
        this.sliderData = packet;
        console.log("[UPDATE] Sliders:", this.sliderData);
    }

    updateSteamData(packet) {
        this.steamData = packet;
        console.log("[UPDATE] Steam Games:", this.steamData);
    }
};
