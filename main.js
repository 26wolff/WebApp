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
        //this.loadLocalData();
        this.loadLocalSliderData();
        this.connectWebSocket();
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
        this.renderApps();
    }

    updateSteamData(packet) {
        this.steamData = packet;
        console.log("[UPDATE] Steam Games:", this.steamData);
        this.renderGames();
    }

    updateSliderData(packet) {
        this.sliderData = packet;
        console.log("[UPDATE] Sliders:", this.sliderData);
        this.renderSliders();
    }

    renderSliders() {
        const container = document.getElementById('dp-sliders');
        if (!container) return;

        container.innerHTML = '';
        this.sliders = []; // clear previous slider instances

        this.sliderData.forEach(sliderInfo => {
            const slider = new Slider(sliderInfo, container, this.ws);
            this.sliders.push(slider);
        });
    }

    renderApps() {
        const panel = document.querySelector('.dp-apps-panel-apps');
        if (!panel) return;

        panel.innerHTML = '';

        const container = document.createElement('div');
        container.className = 'dp-apps-list';
        panel.appendChild(container);

        const appList = Array.isArray(this.appData) ? this.appData : [];
        appList.forEach(appInfo => {
            new AppTile(appInfo, container);
        });
    }

    renderGames() {
        const panel = document.querySelector('.dp-apps-panel-games');
        if (!panel) return;

        panel.innerHTML = '';

        const container = document.createElement('div');
        container.className = 'dp-games-list';
        panel.appendChild(container);

        const gameList = Array.isArray(this.steamData) ? this.steamData : [];
        gameList.forEach(gameInfo => {
            new GameTile(gameInfo, container);
        });
    }

    updateTrayIconsConnection() {
        const iconContainers = document.querySelectorAll('.dp-nav-item');
        iconContainers.forEach(container => {
            if (!this.connected) {
                container.classList.add('dp-disconnected');
            } else {
                container.classList.remove('dp-disconnected');
            }
        });
    }

    reloadLocalData() {
        this.loadLocalData();
        this.loadLocalSliderData();
    }

    getSliderByCode(code) {
        return this.sliders.find(slider => slider.code === code);
    }

    handleMusicCommand(name) {
        const message = `2=music=${name}`;
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.sendPacket(message);
            console.log("[WS SEND]", message);
        } else {
            console.log("[MUSIC CMD]", name);
        }
    }

    updateMusicMuteButton(isMuted) {
        if (this.musicControls) {
            this.musicControls.setMuteState(isMuted);
        }
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

        this.prevVolume = this.volume;   // store previous non-zero volume for mute/unmute
        this.manualZero = false;         // true if user slid to 0 manually
        const saved = this.getSavedState();
        if (saved) {
            if (typeof saved.volume === 'number') {
                this.volume = Math.min(100, Math.max(0, saved.volume));
            }
            if (typeof saved.isMuted === 'boolean') {
                this.isMuted = saved.isMuted;
            }
            this.prevVolume = this.volume;
        }
        this.createElement(parentContainer);
    }

    createElement(parent) {
        const iconFile = this.isMuted && this.muteIcon ? this.muteIcon : this.getIconFile();

        this.container = document.createElement('div');
        this.container.className = 'dp-slider';
        if (this.isMuted) {
            this.container.classList.add('dp-muted');
        }
        this.container.innerHTML = `
            <div class="dp-slider-meta">
                <div class="dp-slider-icon"><img src="${iconFile}" class="dp-icon" /></div>
                <span class="dp-slider-label">${this.name}</span>
            </div>
            <div class="dp-slider-control">
                <input type="range" min="0" max="100" value="${this.volume}" class="dp-slider-input">
                <span class="dp-slider-value">${this.isMuted || this.volume === 0 ? 'OFF' : this.volume}</span>
            </div>
        `;
        parent.appendChild(this.container);

        this.input = this.container.querySelector('.dp-slider-input');
        this.valueSpan = this.container.querySelector('.dp-slider-value');
        this.iconWrap = this.container.querySelector('.dp-slider-icon');
        this.iconImg = this.container.querySelector('.dp-slider-icon img');

        this.input.style.transition = 'all 0.2s ease';

        this.updateValueDisplay();
        this.updateIcon();

        this.input.addEventListener('input', () => this.onSliderChange());
        this.iconWrap.addEventListener('click', () => this.toggleMute());
    }

    getIconFile() {
        let type = this.isMuted? this.muteIcon : this.iconType;
        return `Content/${type}.png`;
    }

    updateValueDisplay() {
        this.valueSpan.textContent = (this.isMuted || parseInt(this.input.value) === 0) ? 'OFF' : parseInt(this.input.value);
        const isZero = parseInt(this.input.value) === 0 && !this.isMuted;
        if (isZero) {
            this.container.classList.add('dp-zero');
        } else {
            this.container.classList.remove('dp-zero');
        }
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
        this.saveState();
        this.sendMessage();
    }

    toggleMute() {
        if (!this.isMuted) {
            // Mute pressed ??? store prevVolume, set slider to 0
            if (!this.manualZero) this.prevVolume = parseInt(this.input.value);
            this.isMuted = true;
            this.input.value = 0;
        } else {
            // Unmute pressed ??? ONLY restore if slider was NOT manually set to 0
            if (!this.manualZero && this.prevVolume > 0) {
                this.isMuted = false;
                this.input.value = this.prevVolume;
            }
            // else do nothing: slider stays at 0 if manually 0
        }

        this.updateIcon();
        this.updateValueDisplay();
        this.saveState();
        this.sendMessage();
    }

    updateIcon() {
        this.iconImg.src = this.getIconFile();
        
        // Update muted class on container
        if (this.isMuted) {
            this.container.classList.add('dp-muted');
            this.container.classList.remove('dp-zero');
        } else {
            this.container.classList.remove('dp-muted');
        }

        if (this.code === '1=music') {
            Manager.updateMusicMuteButton(this.isMuted);
        }
    }

    setMutedState(isMuted) {
        this.isMuted = isMuted;
        if (isMuted) {
            this.input.value = 0;
        } else if (this.prevVolume > 0) {
            this.input.value = this.prevVolume;
        }
        this.updateIcon();
        this.updateValueDisplay();
        this.sendMessage();
    }

    sendMessage() {
        if (Manager.ws && Manager.ws.readyState === WebSocket.OPEN) {
            let val = parseInt(this.input.value);
            if (this.isMuted) val = "0"; // ensure value is 0 if muted
            const message = `${this.code}=${val}`;
            Manager.sendPacket(message);
            console.log("[WS SEND]", message);
        }
    }

    getSavedState() {
        try {
            const key = `dp-slider-${this.code}`;
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    saveState() {
        try {
            const key = `dp-slider-${this.code}`;
            const data = {
                volume: parseInt(this.input.value),
                isMuted: this.isMuted
            };
            localStorage.setItem(key, JSON.stringify(data));
        } catch { }
    }
}

class AppTile {
    constructor(data, parentContainer) {
        this.id = data.id;
        this.name = data.name;
        this.icon = data.icon;
        this.createElement(parentContainer);
    }

    createElement(parent) {
        this.container = document.createElement('button');
        this.container.className = 'dp-app-item';
        this.container.type = 'button';

        const iconSrc = this.icon?.startsWith('data:')
            ? this.icon
            : `data:image/png;base64,${this.icon}`;

        this.container.innerHTML = `
            <img class="dp-app-item-icon" src="${iconSrc}" alt="${this.name}" />
            <span class="dp-app-item-title">${this.name}</span>
        `;

        parent.appendChild(this.container);

        this.container.addEventListener('click', () => this.handleClick());
    }

    handleClick() {
        this.sendMessage();
    }
    sendMessage() {
        if (Manager.ws && Manager.ws.readyState === WebSocket.OPEN) {
            const message = `11=${this.id}=run`;
            Manager.sendPacket(message);
            console.log("[WS SEND]", message);
        }
    }
}

class GameTile {
    constructor(data, parentContainer) {
        this.id = data.id;
        this.name = data.name;
        this.icon = data.icon;
        this.createElement(parentContainer);
    }

    getDataUrl() {
        if (!this.icon) return '';
        if (this.icon.startsWith('data:')) return this.icon;
        if (this.icon.startsWith('/9j/')) return `data:image/jpeg;base64,${this.icon}`;
        if (this.icon.startsWith('iVBOR')) return `data:image/png;base64,${this.icon}`;
        return `data:image/png;base64,${this.icon}`;
    }

    createElement(parent) {
        this.container = document.createElement('button');
        this.container.className = 'dp-game-item';
        this.container.type = 'button';

        const bannerSrc = this.getDataUrl();

        this.container.innerHTML = `
            <div class="dp-game-banner-wrap">
                ${bannerSrc ? `<img class="dp-game-banner" src="${bannerSrc}" alt="${this.name}" />` : `<div class="dp-game-banner dp-game-banner-fallback"></div>`}
            </div>
            <span class="dp-game-title">${this.name}</span>
        `;

        parent.appendChild(this.container);

        this.container.addEventListener('click', () => this.handleClick());
    }

    handleClick() {
        this.sendMessage();
    }
    sendMessage() {
        if (Manager.ws && Manager.ws.readyState === WebSocket.OPEN) {
            const message = `12=${this.id}=run`;
            Manager.sendPacket(message);
            console.log("[WS SEND]", message);
        }
    }
}

class MusicControls {
    constructor() {
        this.isPlaying = false;
        this.isMuted = false;
        this.playPauseBtn = document.getElementById('dp-music-playpause');
        this.playPauseIcon = document.getElementById('dp-music-playpause-icon');
        this.muteBtn = document.getElementById('dp-music-mute');
        this.muteIcon = document.getElementById('dp-music-mute-icon');
        this.actionButtons = document.querySelectorAll('.dp-music-btn[data-action]');

        if (this.playPauseBtn && this.playPauseIcon) {
            this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        }
        if (this.muteBtn && this.muteIcon) {
            this.muteBtn.addEventListener('click', () => this.toggleMute());
        }
        this.actionButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                this.triggerCommand(action);
            });
        });
    }

    triggerCommand(name) {
        if (name === 'run') {
            Manager.sendPacket('11=1675214580=run');
            return;
        }
        Manager.handleMusicCommand(name);
    }

    togglePlayPause() {
        if (this.isPlaying) {
            this.isPlaying = false;
            if (this.playPauseIcon) this.playPauseIcon.src = 'Content/CurrIcon.png';
            this.triggerCommand('pause');
        } else {
            this.isPlaying = true;
            if (this.playPauseIcon) this.playPauseIcon.src = 'Content/PauseIcon.png';
            this.triggerCommand('play');
        }
    }

    toggleMute() {
        const musicSlider = Manager.getSliderByCode('1=music');
        if (musicSlider) {
            musicSlider.toggleMute();
            this.setMuteState(musicSlider.isMuted);
        } else {
            this.setMuteState(!this.isMuted);
        }
        // Mute is handled by the music slider; no command sent here
    }

    setMuteState(isMuted) {
        this.isMuted = isMuted;
        if (this.muteIcon) {
            this.muteIcon.src = isMuted ? 'Content/MusicOffIcon.png' : 'Content/MusicIcon.png';
        }
        if (this.muteBtn) {
            this.muteBtn.classList.toggle('dp-muted', isMuted);
        }
    }
}

window.addEventListener('load', () => {
    const reloadPageBtn = document.getElementById('dp-setting-reload-page');
    if (reloadPageBtn) {
        reloadPageBtn.addEventListener('click', () => window.location.reload());
    }

    const themeButtons = document.querySelectorAll('.dp-theme-option');
    const applyTheme = (theme) => {
        const normalized = theme && theme !== 'default' ? theme : '';
        if (normalized) {
            document.body.setAttribute('data-theme', normalized);
        } else {
            document.body.removeAttribute('data-theme');
        }
        localStorage.setItem('dp-theme', theme || 'default');
        themeButtons.forEach(btn => btn.classList.remove('dp-selected'));
        const active = Array.from(themeButtons).find(btn => btn.dataset.theme === (theme || 'default'));
        if (active) active.classList.add('dp-selected');
    };

    const savedTheme = localStorage.getItem('dp-theme') || 'default';
    applyTheme(savedTheme);

    themeButtons.forEach(btn => {
        btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
    });

    Manager.musicControls = new MusicControls();
    const musicSlider = Manager.getSliderByCode('1=music');
    if (musicSlider) {
        Manager.updateMusicMuteButton(musicSlider.isMuted);
    }

    const clockEl = document.getElementById('dp-home-clock');
    const dateEl = document.getElementById('dp-home-date');
    if (clockEl && dateEl) {
        const updateClock = () => {
            const now = new Date();
            const rawHours = now.getHours();
            const hours = rawHours % 12 || 12;
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const ampm = rawHours >= 12 ? 'PM' : 'AM';
            const time = `${hours}:${minutes} <span class="dp-home-ampm">${ampm}</span>`;
            const date = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: '2-digit' });
            clockEl.innerHTML = time;
            dateEl.textContent = date;
        };
        updateClock();
        setInterval(updateClock, 1000);
    }
});
