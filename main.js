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
        this.connected = false;
        this.reconnectTimer = null;

        this.sliderData = [];
        this.sliders = []; // list of Slider instances
        this.appData = {};
        this.steamData = {};
        this.startup();
    }

    startup() {
        this.loadLocalData();
        this.loadLocalSliderData();
        //this.connectWebSocket();
        this.updateTrayIconsConnection();
        
    }

    loadLocalSliderData() {
        fetch('sliders.json')
            .then(res => res.json())
            .then(data => {
                this.updateSliderData(data.sliders || []);
            })
            .catch(err => console.error('Failed to load sliders.json:', err));
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
            this.connected = true;
            this.updateTrayIconsConnection();
            this.sendPacket("10=applications=get");
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                console.log("[WS MSG]", msg);
                for (const key in msg) {
                    if (!msg.hasOwnProperty(key)) continue;
                    const value = msg[key];
                    switch (key) {
                        case "sliders": this.updateSliderData(value); break;
                        case "apps": this.updateAppData(value); break;
                        case "steamGames": this.updateSteamData(value); break;
                        default: this[key] = value; console.log(`[UPDATE] ${key} updated`, value); break;
                    }
                }
            } catch (err) {
                console.warn("[WS] Failed to parse message:", err);
            }
        };

        this.ws.onclose = () => {
            console.log("[WS] Disconnected, reconnecting in 2s...");
            this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 2000);
            this.connected = false;
            this.updateTrayIconsConnection();
        };

        this.ws.onerror = (err) => console.error("[WS ERROR]", err);
    }

    sendPacket(value) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(value);
        }
    }

    updateAppData(packet) {
        this.appData = packet;
        console.log("[UPDATE] Applications:", this.appData);
    }

    updateSteamData(packet) {
        this.steamData = packet;
        console.log("[UPDATE] Steam Games:", this.steamData);
    }

    updateSliderData(packet) {
        this.sliderData = packet;
        console.log("[UPDATE] Sliders:", this.sliderData);
        this.renderSliders();
    }

    renderSliders() {
        const container = document.getElementById('sliderContainer');
        if (!container) return;

        container.innerHTML = '';
        this.sliders = []; // clear previous slider instances

        this.sliderData.forEach(sliderInfo => {
            const slider = new Slider(sliderInfo, container, this.ws);
            this.sliders.push(slider);
        });
    }

    updateTrayIconsConnection() {
        const iconContainers = document.querySelectorAll('.icon-container');
        iconContainers.forEach(container => {
            if (!this.connected) {
                container.classList.add('disconnected');
            } else {
                container.classList.remove('disconnected');
            }
        });
    }
};


class Slider {
    constructor(data, parentContainer, ws) {
        this.id = data.id;
        this.name = data.name;
        this.code = data.code;
        this.iconType = data.icon;
        this.muteIcon = data.muteIcon || '';
        this.volume = data.volume;
        this.isMuted = data.is_muted;
        this.ws = ws;

        this.prevVolume = this.volume;   // store previous non-zero volume for mute/unmute
        this.manualZero = false;         // true if user slid to 0 manually
        this.createElement(parentContainer);
    }

    createElement(parent) {
        const iconFile = this.isMuted && this.muteIcon ? this.muteIcon : this.getIconFile();

        this.container = document.createElement('div');
        this.container.className = 'slider-item';
        if (this.isMuted) {
            this.container.classList.add('muted');
        }
        this.container.innerHTML = `
            <div class="slider-icon-text">
                <div class="slider-icon"><img src="${iconFile}" class="icon" /></div>
                <span class="slider-label">${this.name}</span>
            </div>
            <div class="slider-wrapper">
                <input type="range" min="0" max="100" value="${this.volume}" class="slider">
                <span class="slider-value">${this.isMuted || this.volume === 0 ? 'OFF' : this.volume}</span>
            </div>
        `;
        parent.appendChild(this.container);

        this.input = this.container.querySelector('.slider');
        this.valueSpan = this.container.querySelector('.slider-value');
        this.iconImg = this.container.querySelector('.icon');

        this.input.style.transition = 'all 0.2s ease';

        this.updateValueDisplay();
        this.updateIcon();

        this.input.addEventListener('input', () => this.onSliderChange());
        this.iconImg.addEventListener('click', () => this.toggleMute());
    }

    getIconFile() {
        let type = this.isMuted? this.muteIcon : this.iconType;
        return `Content/${type}.png`;
    }

    updateValueDisplay() {
        this.valueSpan.textContent = (this.isMuted || parseInt(this.input.value) === 0) ? 'OFF' : parseInt(this.input.value);
    }

    onSliderChange() {
        const val = parseInt(this.input.value);

        // Track if user manually set slider to 0
        this.manualZero = val === 0;

        // auto-unmute if value > 0
        if (val > 0 && this.isMuted) this.isMuted = false;

        // only store prevVolume if value > 0
        if (val > 0) this.prevVolume = val;

        if (val === 0) this.isMuted = true;

        this.updateIcon();
        this.updateValueDisplay();
        this.sendMessage();
    }

    toggleMute() {
        if (!this.isMuted) {
            // Mute pressed → store prevVolume, set slider to 0
            if (!this.manualZero) this.prevVolume = parseInt(this.input.value);
            this.isMuted = true;
            this.input.value = 0;
        } else {
            // Unmute pressed → ONLY restore if slider was NOT manually set to 0
            if (!this.manualZero && this.prevVolume > 0) {
                this.isMuted = false;
                this.input.value = this.prevVolume;
            }
            // else do nothing: slider stays at 0 if manually 0
        }

        this.updateIcon();
        this.updateValueDisplay();
        this.sendMessage();
    }

    updateIcon() {
        this.iconImg.src = this.getIconFile();
        
        // Update muted class on container
        if (this.isMuted) {
            this.container.classList.add('muted');
        } else {
            this.container.classList.remove('muted');
        }
    }

    sendMessage() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            let val = parseInt(this.input.value);
            if (this.isMuted) val = "0"; // ensure value is 0 if muted
            const message = `${this.code}=${val}`;
            Manager.sendPacket(message);
            console.log("[WS SEND]", message);
        }
    }
}