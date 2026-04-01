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
        this.connectionState = 'disconnected';
        this.reconnectTimer = null;

        this.sliderData = [];
        this.sliders = []; // list of Slider instances
        this.sliderGroups = new Map();
        this.appData = {};
        this.gameData = {};
        this.musicPrivacyEnabled = false;
        this.lastMusicInfo = null;
        this.commandHistory = [];
        this.domReady = false;
        this.DEFAULT_SLIDERS = [
            { id: "a1", name: "Main Volume", icon: "SoundIcon", muteIcon: "SoundOffIcon", code: "0=main", volume: 80, is_muted: false },
            { id: "a2", name: "Current", icon: "CurrIcon", muteIcon: "CurrOffIcon", code: "1=current_app", volume: 80, is_muted: false },
            { id: "a3", name: "Music", icon: "MusicIcon", muteIcon: "MusicOffIcon", code: "1=music", volume: 50, is_muted: false },
            { id: "a4", name: "Calls", icon: "CallIcon", muteIcon: "CallOffIcon", code: "1=calls", volume: 50, is_muted: false },
            { id: "a5", name: "Microphone", icon: "MicIcon", muteIcon: "MicOffIcon", code: "0=mic", volume: 50, is_muted: false },
        ];
        this.startup();
    }

    startup() {
        this.loadLocalSliderData();
        document.addEventListener("DOMContentLoaded", () => {
            this.domReady = true;
            this.renderAll();
            this.connectWebSocket();
        });
        
        this.updateTrayIconsConnection();

    }

    loadLocalSliderData() {
        const applySliderPayload = (data) => {
            const list = (data && Array.isArray(data.sliders)) ? data.sliders : this.DEFAULT_SLIDERS;
            this.updateSliderData(list);
            this.renderAll();
        };

        const loadViaXhr = () => {
            try {
                const req = new XMLHttpRequest();
                req.open('GET', 'sliders.json', true);
                req.onreadystatechange = () => {
                    if (req.readyState !== 4) return;
                    if (req.status >= 200 && req.status < 300 || req.status === 0) {
                        try {
                            applySliderPayload(JSON.parse(req.responseText));
                        } catch (err) {
                            console.error('Failed to parse sliders.json, using defaults:', err);
                            applySliderPayload({ sliders: this.DEFAULT_SLIDERS });
                        }
                        return;
                    }
                    console.error('Failed to load sliders.json, using defaults:', req.status);
                    applySliderPayload({ sliders: this.DEFAULT_SLIDERS });
                };
                req.send();
            } catch (err) {
                console.error('Failed to load sliders.json, using defaults:', err);
                applySliderPayload({ sliders: this.DEFAULT_SLIDERS });
            }
        };

        if (typeof fetch === 'function') {
            fetch('sliders.json')
                .then(res => res.json())
                .then(applySliderPayload)
                .catch(() => loadViaXhr());
            return;
        }

        loadViaXhr();
    }

    connectWebSocket() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

        this.setConnectionState('reconnecting');
        const url = `ws://${this.SERVER_IP}:${this.SERVER_PORT}/ws`;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            console.log("[WS] Connected to server");
            clearTimeout(this.reconnectTimer);
            this.connected = true;
            this.reconnectTimer = null;
            this.setConnectionState('connected');
            this.requestInitialData();
        };

        this.ws.onmessage = (event) => {
            // Reset idle timeout on every message
            clearTimeout(this.messageTimeout);
            
            // Handle raw heartbeat string first
            if (event.data === "PING") {
                console.log("[WS] Heartbeat received");
                this.setupIdleTimeout();
                return;
            }
            
            try {
                const msg = JSON.parse(event.data);
                console.log("[WS MSG]", msg);
                
                for (const key in msg) {
                    if (!msg.hasOwnProperty(key)) continue;
                    const value = msg[key];
                    const k = key.toLowerCase();
                    switch (k) {
                        case "sliders": this.updateSliderData(value); break;
                        case "apps": this.updateAppData(value); break;
                        case "applications": this.updateAppData(value); break; // backend variant
                        case "games": this.updateGameData(value); break;
                        case "music": this.updateMusicNowPlaying(value); break;
                        default: this[key] = value; console.log(`[UPDATE] ${key} updated`, value); break;
                    }
                }
            } catch (err) {
                console.warn("[WS] Failed to parse message:", err);
            }
            
            // Setup timeout for next expected message
            this.setupIdleTimeout();
        };

        this.ws.onclose = () => {
            console.log("[WS] Disconnected, reconnecting in 2s...");
            this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 2000);
            this.connected = false;
            this.setConnectionState('reconnecting');
        };

        this.ws.onerror = (err) => {
            console.error("[WS ERROR]", err);
            if (!this.connected) {
                this.setConnectionState('disconnected');
            }
        };
        
        // Setup initial idle timeout
        this.setupIdleTimeout();
    }

    setupIdleTimeout() {
        clearTimeout(this.messageTimeout);
        // If no message received for 40s (heartbeat every 20s + buffer), reconnect
        this.messageTimeout = setTimeout(() => {
            console.warn("[WS] No message received for 40s (idle timeout), reconnecting...");
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.reconnectNow();
            }
        }, 40000);
    }

    requestInitialData() {
        // ask server for current state so UI is hydrated after fresh connect/reconnect
        const packets = [
            "10=applications=get",
            "10=music=get"
        ];
        packets.forEach(p => this.sendPacket(p));
    }

    sendPacket(value) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(value);
            this.recordCommand(value);
        }
    }

    recordCommand(command) {
        if (typeof command !== 'string' || !command.trim()) return;
        if (!this.isTrackedCommand(command)) return;

        this.commandHistory.unshift({
            command,
            timestamp: new Date()
        });
        this.commandHistory = this.commandHistory.slice(0, 3);
        this.renderCommandHistory();
    }

    isTrackedCommand(command) {
        const parts = command.split('=');
        if (parts.length !== 3) return false;
        if (!/^\d+$/.test(parts[0])) return false;
        if (!parts[1] || !parts[2]) return false;
        if (parts[0] === '0' || parts[0] === '1') return false;
        return true;
    }

    renderCommandHistory() {
        if (!this.domReady) return;

        const host = document.getElementById('dp-command-log');
        if (!host) return;

        host.innerHTML = '';

        if (!this.commandHistory.length) {
            host.innerHTML = '<div class="dp-command-log-empty">No commands sent yet</div>';
            return;
        }

        this.commandHistory.forEach((entry) => {
            const row = document.createElement('div');
            row.className = 'dp-command-row';

            const time = document.createElement('span');
            time.className = 'dp-command-time';
            time.textContent = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/Chicago',
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            }).format(entry.timestamp);

            const text = document.createElement('code');
            text.className = 'dp-command-text';
            text.textContent = entry.command;

            row.appendChild(time);
            row.appendChild(text);
            host.appendChild(row);
        });
    }

    normalizeAppItem(item) {
        const id = firstDefined(item && item.id, item && item.Id, item && item.appId, null);
        const name = firstDefined(
            item && item.name,
            item && item.Name,
            item && item.AppName,
            item && item.appName,
            item && item.displayName,
            ''
        );
        const icon = firstDefined(item && item.icon, item && item.Icon, '');
        return { id, name, icon };
    }

    updateAppData(packet) {
        const list = Array.isArray(packet) ? packet
            : (packet && Array.isArray(packet.apps)) ? packet.apps
            : [];
        this.appData = list
            .map(item => this.normalizeAppItem(item))
            .filter(a => a && a.name);
        console.log("[UPDATE] Applications:", this.appData);
        this.renderApps();
    }

    updateGameData(packet) {
        const list = Array.isArray(packet) ? packet
            : (packet && Array.isArray(packet.games)) ? packet.games
            : [];
        this.gameData = list
            .map(item => this.normalizeAppItem(item))
            .filter(a => a && a.name);
        console.log("[UPDATE] Games:", this.gameData);
        this.renderGames();
    }

    updateSliderData(packet) {
        const list = Array.isArray(packet) ? packet
            : (packet && Array.isArray(packet.sliders)) ? packet.sliders
            : this.sliderData;
        if (!Array.isArray(list)) return;
        this.sliderData = list;
        console.log("[UPDATE] Sliders:", this.sliderData);
        this.sliderGroups = new Map();
        this.renderSliders();
        this.renderMusicSlider();
    }

    renderMusicSlider() {
        const host = document.getElementById('dp-music-slider');
        if (!host) return;
        host.innerHTML = '';

        const musicSlider = findByCode(this.sliderData, '1=music');
        if (!musicSlider) return;

        new Slider(musicSlider, host, this.ws);
        this.renderedMusicSlider = true;
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

        const emptyState = panel.querySelector('.dp-empty-state');
        let container = panel.querySelector('.dp-apps-list');
        if (!container) {
            container = document.createElement('div');
            container.className = 'dp-apps-list';
            panel.appendChild(container);
        }
        installSwipeScroll(container);
        container.innerHTML = '';

        const appList = Array.isArray(this.appData) ? this.appData : [];
        if (emptyState) emptyState.style.display = appList.length ? 'none' : 'flex';
        if (!appList.length) return;
        appList.forEach(appInfo => {
            new AppTile(appInfo, container, 'Content/AppsIcon.png');
        });
    }

    renderGames() {
        const panel = document.querySelector('.dp-apps-panel-games');
        if (!panel) return;

        const emptyState = panel.querySelector('.dp-empty-state');
        let container = panel.querySelector('.dp-apps-list');
        if (!container) {
            container = document.createElement('div');
            container.className = 'dp-apps-list';
            panel.appendChild(container);
        }
        installSwipeScroll(container);
        container.innerHTML = '';

        const gameList = Array.isArray(this.gameData) ? this.gameData : [];
        if (emptyState) emptyState.style.display = gameList.length ? 'none' : 'flex';
        if (!gameList.length) return;
        gameList.forEach(gameInfo => {
            new GameTile(gameInfo, container, 'Content/GamesIcon.png');
        });
    }

    setConnectionState(state) {
        this.connectionState = state;
        this.updateTrayIconsConnection();
    }

    updateTrayIconsConnection() {
        const iconContainers = document.querySelectorAll('.dp-nav-item');
        iconContainers.forEach(container => {
            container.classList.toggle('dp-disconnected', this.connectionState === 'disconnected');
            container.classList.toggle('dp-connection-reconnecting', this.connectionState === 'reconnecting');
        });

        const badge = document.getElementById('dp-home-status');
        const badgeText = document.getElementById('dp-home-status-text');
        if (badge) {
            badge.dataset.status = this.connectionState;
        }
        if (badgeText) {
            badgeText.textContent = this.connectionState === 'connected'
                ? 'Connected'
                : this.connectionState === 'reconnecting'
                    ? 'Reconnecting'
                    : 'Disconnected';
        }
    }

    reloadLocalData() {
        this.loadLocalSliderData();
        this.requestInitialData();
    }

    reconnectNow() {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.connected = false;
        this.setConnectionState('reconnecting');

        if (this.ws) {
            try {
                this.ws.onclose = null;
                this.ws.close();
            } catch (err) {
                console.warn('[WS] Failed to close existing socket before reconnect:', err);
            }
            this.ws = null;
        }

        this.connectWebSocket();
    }

    getMusicLauncherId() {
        const preferredNames = [
            'youtube music',
            'google music',
            'yt music',
            'music'
        ];

        const items = Array.isArray(this.appData) ? this.appData : [];
        for (let i = 0; i < preferredNames.length; i++) {
            const target = preferredNames[i];
            for (let j = 0; j < items.length; j++) {
                const item = items[j];
                const name = String(item && item.name || '').toLowerCase();
                if (name && name.indexOf(target) !== -1) return item.id;
            }
        }

        return null;
    }

    getSliderByCode(code) {
        const slider = findByCode(this.sliders, code);
        if (slider) return slider;
        const group = this.sliderGroups.get(code);
        return group && group.length ? group[0] : undefined;
    }

    registerSlider(slider) {
        const list = this.sliderGroups.get(slider.code);
        if (list) {
            list.push(slider);
        } else {
            this.sliderGroups.set(slider.code, [slider]);
        }
    }

    syncSliderState(source) {
        const list = this.sliderGroups.get(source.code);
        if (!list || list.length < 2) return;
        for (const slider of list) {
            if (slider === source) continue;
            slider.updateFromPeer(source);
        }
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

    updateMusicNowPlaying(info) {
        this.lastMusicInfo = info;

        if (!this.domReady) return; // defer until DOM exists

        const titleEl = document.getElementById('dp-music-title');
        const artistEl = document.getElementById('dp-music-artist');
        const thumbEl = document.getElementById('dp-music-thumb');

        const status = String(info && info.status || '').toLowerCase();
        const isPlaying = status === 'playing';
        const hasMedia = status === 'playing' || status === 'paused';

        // PRIVACY MODE
        if (this.musicPrivacyEnabled) {

            // if nothing playing show normal message
            if (!info || !hasMedia){
                if (titleEl) titleEl.textContent = 'Nothing playing';
                if (artistEl) artistEl.textContent = '—';
                if (thumbEl) thumbEl.src = 'Content/NoSongIcon.png';
                if (this.musicControls) this.musicControls.setPlayingState(false);
                return;
            }

            // something playing but hidden
            if (titleEl) titleEl.textContent = 'Now playing';
            if (artistEl) artistEl.textContent = 'Audio';
            if (thumbEl) thumbEl.src = 'Content/MusicRunIcon.png';
            if (this.musicControls) this.musicControls.setPlayingState(true);
            return;
        }

        // NORMAL MODE
        if (!info) {
            if (titleEl) titleEl.textContent = 'Nothing playing';
            if (artistEl) artistEl.textContent = '—';
            if (thumbEl) thumbEl.src = 'Content/NoSongIcon.png';
            if (this.musicControls) this.musicControls.setPlayingState(false);
            return;
        }

        if (titleEl) titleEl.textContent = info.title || 'Unknown';
        if (artistEl) artistEl.textContent = info.artist || '—';

        if (thumbEl) {
            const thumb = info && info.thumbnail ? info.thumbnail : '';
            const validThumb = typeof thumb === 'string' && thumb.length > 0 && thumb !== 'undefined' && thumb !== 'null';
            if (validThumb) {
                thumbEl.src = startsWith(thumb, 'data:')
                    ? thumb
                    : `data:image/png;base64,${thumb}`;
            } else {
                thumbEl.src = 'Content/NoSongIcon.png';
            }
        }

        if (this.musicControls) {
            this.musicControls.setPlayingState(isPlaying);
        }
    }
    setMusicPrivacy(enabled) {
        this.musicPrivacyEnabled = !!enabled;
        this.updateMusicNowPlaying(this.lastMusicInfo);
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
        Manager.registerSlider(this);
    }

    createElement(parent) {
        const iconFile = this.isMuted && this.muteIcon ? this.muteIcon : this.getIconFile();
        const vol = Number.isFinite(this.volume) ? this.volume : 0;
        const name = this.name || '';

        this.container = document.createElement('div');
        this.container.className = 'dp-slider';
        if (this.isMuted) {
            this.container.classList.add('dp-muted');
        }
        this.container.innerHTML = `
            <div class="dp-slider-meta">
                <div class="dp-slider-icon"><img src="${iconFile}" class="dp-icon" /></div>
                <span class="dp-slider-label">${name}</span>
            </div>
            <div class="dp-slider-control">
                <input type="range" min="0" max="100" value="${vol}" class="dp-slider-input">
                <span class="dp-slider-value">${this.isMuted || vol === 0 ? 'OFF' : vol}</span>
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
        let type = this.isMuted ? this.muteIcon : this.iconType;
        if (!type) type = 'SoundIcon';
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
        Manager.syncSliderState(this);
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
        Manager.syncSliderState(this);
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
        Manager.syncSliderState(this);
    }

    updateFromPeer(source) {
        const value = parseInt(source.input.value);
        this.isMuted = source.isMuted;
        this.manualZero = value === 0;
        if (value > 0) this.prevVolume = value;
        this.input.value = value;
        this.updateIcon();
        this.updateValueDisplay();
        this.saveState();
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
    constructor(data, parentContainer, fallbackIcon) {
        this.id = data.id;
        this.name = data.name;
        this.icon = data.icon;
        this.fallbackIcon = fallbackIcon;
        this.createElement(parentContainer);
    }

    createElement(parent) {
        this.container = document.createElement('button');
        this.container.className = 'dp-app-item';
        this.container.type = 'button';
        this.container.draggable = false;

        this.container.innerHTML = `
            <img class="dp-app-item-icon" alt="${this.name}" />
            <span class="dp-app-item-title">${this.name}</span>
        `;

        const img = this.container.querySelector('img');
        img.draggable = false;
        setIconImage(img, this.icon, this.fallbackIcon);

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
    constructor(data, parentContainer, fallbackIcon) {
        this.id = data.id;
        this.name = data.name;
        this.icon = data.icon;
        this.fallbackIcon = fallbackIcon;
        this.createElement(parentContainer);
    }

    createElement(parent) {
        this.container = document.createElement('button');
        this.container.className = 'dp-app-item';
        this.container.type = 'button';
        this.container.draggable = false;

        this.container.innerHTML = `
            <img class="dp-app-item-icon" alt="${this.name}" />
            <span class="dp-app-item-title">${this.name}</span>
        `;

        const img = this.container.querySelector('img');
        img.draggable = false;
        setIconImage(img, this.icon, this.fallbackIcon);

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

function buildIconSources(icon, fallbackIcon) {
    const sources = [];
    const isValid =
        typeof icon === 'string' &&
        icon.length > 0 &&
        icon !== 'undefined' &&
        icon !== 'null';

    if (isValid) {
        if (startsWith(icon, 'data:')) {
            sources.push(icon);
        } else if (startsWith(icon, '/9j/')) {
            sources.push(`data:image/jpeg;base64,${icon}`);
        } else if (startsWith(icon, 'UklG')) {
            // WebP base64
            sources.push(`data:image/webp;base64,${icon}`);
        } else if (startsWith(icon, 'iVBOR')) {
            sources.push(`data:image/png;base64,${icon}`);
        } else if (startsWith(icon, 'http') || startsWith(icon, '//')) {
            sources.push(icon);
        } else {
            sources.push(`data:image/png;base64,${icon}`);
        }
    }

    sources.push(fallbackIcon);
    return sources.filter(src => typeof src === 'string' && src.length > 0);
}

function firstDefined() {
    for (let i = 0; i < arguments.length; i++) {
        const value = arguments[i];
        if (value !== undefined && value !== null) return value;
    }
    return undefined;
}

function findByCode(list, code) {
    if (!Array.isArray(list)) return undefined;
    for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (item && item.code === code) return item;
    }
    return undefined;
}

function startsWith(value, prefix) {
    return typeof value === 'string' && value.slice(0, prefix.length) === prefix;
}

function findClosestByClass(el, className) {
    let current = el;
    while (current) {
        if (current.classList && current.classList.contains(className)) return current;
        current = current.parentElement;
    }
    return null;
}

function pad2(value) {
    return value < 10 ? `0${value}` : String(value);
}

function installHiddenCursorGuards() {
    const body = document.body;
    if (!body) return;

    let lastScrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;

    const hideCursor = () => {
        body.classList.add('hide-cursor');
    };

    window.addEventListener('scroll', () => {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
        if (scrollTop < lastScrollTop) {
            hideCursor();
        } else {
            hideCursor();
        }
        lastScrollTop = scrollTop <= 0 ? 0 : scrollTop;
    }, false);

    document.addEventListener('scroll', hideCursor, true);
    document.addEventListener('mousemove', hideCursor, true);
    document.addEventListener('pointermove', hideCursor, true);
    document.addEventListener('touchmove', hideCursor, true);

    hideCursor();
}

function installBrightnessSafety(applyBrightness) {
    let holdTimer = null;

    const clearHold = () => {
        if (holdTimer) {
            clearTimeout(holdTimer);
            holdTimer = null;
        }
    };

    const maybeStartHold = () => {
        const current = parseInt(localStorage.getItem('dp-brightness') || '100', 10);
        if (current >= 5) return;
        clearHold();
        holdTimer = setTimeout(() => {
            applyBrightness(20);
            holdTimer = null;
        }, 4000);
    };

    document.addEventListener('pointerdown', maybeStartHold, true);
    document.addEventListener('pointerup', clearHold, true);
    document.addEventListener('pointercancel', clearHold, true);
    document.addEventListener('touchstart', maybeStartHold, true);
    document.addEventListener('touchend', clearHold, true);
    document.addEventListener('touchcancel', clearHold, true);
    document.addEventListener('mousedown', maybeStartHold, true);
    document.addEventListener('mouseup', clearHold, true);
    document.addEventListener('mouseleave', clearHold, true);
}

function installSwipeScroll(container) {
    if (!container || container.__dpSwipeScrollInstalled) return;
    container.__dpSwipeScrollInstalled = true;

    let activePointerId = null;
    let startX = 0;
    let startY = 0;
    let startScrollTop = 0;
    let dragging = false;
    let suppressClickUntil = 0;
    let captured = false;

    const finishDrag = () => {
        if (captured && activePointerId !== null && typeof container.releasePointerCapture === 'function') {
            try {
                container.releasePointerCapture(activePointerId);
            } catch { }
        }
        captured = false;
        activePointerId = null;
        if (dragging) {
            suppressClickUntil = Date.now() + 250;
        }
        dragging = false;
        container.classList.remove('dp-drag-scrolling');
    };

    container.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (event.target instanceof Element) {
            if (container.classList.contains('dp-settings-panel') &&
                event.target.closest('input[type="range"]')) {
                return;
            }
        }

        activePointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        startScrollTop = container.scrollTop;
        dragging = false;
    });

    container.addEventListener('pointermove', (event) => {
        if (event.pointerId !== activePointerId) return;

        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;

        if (!dragging) {
            if (Math.abs(deltaY) < 8) return;
            if (Math.abs(deltaX) > Math.abs(deltaY)) return;
            dragging = true;
            container.classList.add('dp-drag-scrolling');
            if (!captured && typeof container.setPointerCapture === 'function') {
                try {
                    container.setPointerCapture(event.pointerId);
                    captured = true;
                } catch { }
            }
        }

        container.scrollTop = startScrollTop - deltaY;
        event.preventDefault();
    }, { passive: false });

    container.addEventListener('pointerup', finishDrag);
    container.addEventListener('pointercancel', finishDrag);
    container.addEventListener('lostpointercapture', finishDrag);

    container.addEventListener('click', (event) => {
        if (Date.now() >= suppressClickUntil) return;
        event.preventDefault();
        event.stopPropagation();
    }, true);
}

function installSwipeScrollRegions() {
    document.querySelectorAll('.dp-apps-list, .dp-settings-panel').forEach(installSwipeScroll);
}

function setIconImage(imgEl, icon, fallbackIcon) {
    const sources = buildIconSources(icon, fallbackIcon);
    let index = 0;

    const tryNext = () => {
        if (index >= sources.length) return;
        const src = sources[index++];
        imgEl.src = src;
    };

    imgEl.addEventListener('error', () => {
        tryNext();
    });

    tryNext();
}

class MusicControls {
    constructor() {
        this.isPlaying = false;
        this.isMuted = false;
        this.playPauseBtn = document.getElementById('dp-music-playpause');
        this.playPauseIcon = document.getElementById('dp-music-playpause-icon');
        this.actionButtons = document.querySelectorAll('.dp-music-btn[data-action]');

        if (this.playPauseBtn && this.playPauseIcon) {
            this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
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
            const appId = Manager.getMusicLauncherId();
            if (appId !== null && appId !== undefined) {
                Manager.sendPacket(`11=${appId}=run`);
            }
            return;
        }
        Manager.handleMusicCommand(name);
    }

    togglePlayPause() {
        const nextPlaying = !this.isPlaying;
        this.setPlayingState(nextPlaying);
        this.triggerCommand(nextPlaying ? 'play' : 'pause');
    }

    setMuteState(isMuted) {
        this.isMuted = isMuted;
    }

    setPlayingState(isPlaying) {
        this.isPlaying = isPlaying;
        if (this.playPauseIcon) {
            this.playPauseIcon.src = isPlaying ? 'Content/PauseIcon.png' : 'Content/CurrIcon.png';
        }
    }
}

window.addEventListener('load', () => {
    installHiddenCursorGuards();
    installSwipeScrollRegions();
    Manager.renderCommandHistory();

    const reloadPageBtn = document.getElementById('dp-setting-reload-page');
    if (reloadPageBtn) {
        reloadPageBtn.addEventListener('click', () => window.location.reload());
    }
    const refreshAppsBtn = document.getElementById('dp-setting-refresh-apps');
    if (refreshAppsBtn) {
        refreshAppsBtn.addEventListener('click', () => Manager.sendPacket('10=applications=get'));
    }
    const reconnectBtn = document.getElementById('dp-setting-reconnect');
    if (reconnectBtn) {
        reconnectBtn.addEventListener('click', () => Manager.reconnectNow());
    }
    const homeStatusBtn = document.getElementById('dp-home-status');
    if (homeStatusBtn) {
        homeStatusBtn.addEventListener('click', () => Manager.reconnectNow());
    }

    const themeButtons = document.querySelectorAll('.dp-theme-option');
    const validThemes = new Set(Array.from(themeButtons, btn => btn.dataset.theme || 'default'));
    const applyTheme = (theme) => {
        const safeTheme = validThemes.has(theme || 'default') ? (theme || 'default') : 'default';
        const normalized = safeTheme !== 'default' ? safeTheme : '';
        if (normalized) {
            document.body.setAttribute('data-theme', normalized);
        } else {
            document.body.removeAttribute('data-theme');
        }
        localStorage.setItem('dp-theme', safeTheme);
        themeButtons.forEach(btn => btn.classList.remove('dp-selected'));
        let active = null;
        for (let i = 0; i < themeButtons.length; i++) {
            const btn = themeButtons[i];
            if (btn.dataset.theme === safeTheme) {
                active = btn;
                break;
            }
        }
        if (active) active.classList.add('dp-selected');
    };

    const brightnessInput = document.getElementById('dp-setting-brightness');
    const brightnessValue = document.getElementById('dp-setting-brightness-value');
    const autoHomeToggle = document.getElementById('dp-setting-auto-home');
    const showSecondsToggle = document.getElementById('dp-setting-show-seconds');
    const clock24hToggle = document.getElementById('dp-setting-clock-24h');
    const showDateToggle = document.getElementById('dp-setting-show-date');
    const showWeekdayToggle = document.getElementById('dp-setting-show-weekday');
    const clockOffsetDown = document.getElementById('dp-clock-offset-down');
    const clockOffsetUp = document.getElementById('dp-clock-offset-up');
    const clockOffsetValue = document.getElementById('dp-clock-offset-value');
    const applyBrightness = (value) => {
        const numeric = Math.max(0, Math.min(100, parseInt(value, 10) || 0));
        document.documentElement.style.setProperty('--dp-brightness', `${numeric}%`);
        localStorage.setItem('dp-brightness', String(numeric));
        if (brightnessInput) brightnessInput.value = String(numeric);
        if (brightnessValue) brightnessValue.textContent = `${numeric}%`;
    };

    const savedTheme = localStorage.getItem('dp-theme') || 'default';
    applyTheme(savedTheme);
    applyBrightness(localStorage.getItem('dp-brightness') || '100');
    installBrightnessSafety(applyBrightness);

    themeButtons.forEach(btn => {
        btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
    });

    if (brightnessInput) {
        brightnessInput.addEventListener('input', () => applyBrightness(brightnessInput.value));
    }

    Manager.musicControls = new MusicControls();
    const musicSlider = Manager.getSliderByCode('1=music');
    if (musicSlider) {
        Manager.updateMusicMuteButton(musicSlider.isMuted);
    }

    const privacyToggle = document.getElementById('dp-setting-remove-video-info');
    if (privacyToggle) {
        const privacyCard = findClosestByClass(privacyToggle, 'dp-setting-toggle');
        const saved = localStorage.getItem('dp-remove-video-info') === '1';
        privacyToggle.checked = saved;
        Manager.setMusicPrivacy(saved);
        privacyToggle.addEventListener('change', () => {
            const enabled = privacyToggle.checked;
            localStorage.setItem('dp-remove-video-info', enabled ? '1' : '0');
            Manager.setMusicPrivacy(enabled);
        });
        if (privacyCard) {
            privacyCard.addEventListener('click', (event) => {
                if (event.target === privacyToggle) return;
                privacyToggle.checked = !privacyToggle.checked;
                privacyToggle.dispatchEvent(new Event('change', { bubbles: true }));
            });
        }
    }

    const bindToggleCard = (input, onChange) => {
        if (!input) return;
        const card = findClosestByClass(input, 'dp-setting-toggle');
        input.addEventListener('change', onChange);
        if (card) {
            card.addEventListener('click', (event) => {
                if (event.target instanceof Element && event.target.closest('.dp-switch')) return;
                input.checked = !input.checked;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            });
        }
    };

    bindToggleCard(showSecondsToggle, () => {
        localStorage.setItem('dp-clock-seconds', showSecondsToggle.checked ? '1' : '0');
    });

    bindToggleCard(clock24hToggle, () => {
        localStorage.setItem('dp-clock-24h', clock24hToggle.checked ? '1' : '0');
    });
    bindToggleCard(showDateToggle, () => {
        localStorage.setItem('dp-clock-date', showDateToggle.checked ? '1' : '0');
    });
    bindToggleCard(showWeekdayToggle, () => {
        localStorage.setItem('dp-clock-weekday', showWeekdayToggle.checked ? '1' : '0');
    });
    bindToggleCard(autoHomeToggle, () => {
        localStorage.setItem('dp-auto-home', autoHomeToggle.checked ? '1' : '0');
        resetAutoHomeTimer();
    });

    let autoHomeTimer = null;
    const autoHomeEvents = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];
    const clearAutoHomeTimer = () => {
        if (autoHomeTimer) {
            clearTimeout(autoHomeTimer);
            autoHomeTimer = null;
        }
    };
    const resetAutoHomeTimer = () => {
        clearAutoHomeTimer();
        if (!autoHomeToggle || !autoHomeToggle.checked) return;
        autoHomeTimer = setTimeout(() => {
            if (typeof showOnlyDiv === 'function') {
                showOnlyDiv('dp-Home');
            }
        }, 60000);
    };
    if (autoHomeToggle) {
        autoHomeToggle.checked = localStorage.getItem('dp-auto-home') === '1';
        autoHomeEvents.forEach(eventName => {
            document.addEventListener(eventName, resetAutoHomeTimer, true);
        });
        resetAutoHomeTimer();
    }

    const clockEl = document.getElementById('dp-home-clock');
    const dateEl = document.getElementById('dp-home-date');
    if (clockEl && dateEl) {
        const getClockPreferences = () => ({
            showSeconds: localStorage.getItem('dp-clock-seconds') === '1',
            use24Hour: localStorage.getItem('dp-clock-24h') === '1',
            showDate: localStorage.getItem('dp-clock-date') !== '0',
            showWeekday: localStorage.getItem('dp-clock-weekday') !== '0',
            hourOffset: Math.max(-12, Math.min(12, parseInt(localStorage.getItem('dp-clock-hour-offset') || '0', 10) || 0))
        });
        const syncClockToggles = () => {
            const prefs = getClockPreferences();
            if (showSecondsToggle) showSecondsToggle.checked = prefs.showSeconds;
            if (clock24hToggle) clock24hToggle.checked = prefs.use24Hour;
            if (showDateToggle) showDateToggle.checked = prefs.showDate;
            if (showWeekdayToggle) showWeekdayToggle.checked = prefs.showWeekday;
            if (clockOffsetValue) {
                clockOffsetValue.textContent = prefs.hourOffset === 0
                    ? '0h'
                    : `${prefs.hourOffset > 0 ? '+' : ''}${prefs.hourOffset}h`;
            }
        };

        const updateClock = () => {
            const prefs = getClockPreferences();
            const now = new Date(Date.now() + (prefs.hourOffset * 60 * 60 * 1000));
            const chicagoDateFormatter = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/Chicago',
                weekday: prefs.showWeekday ? 'short' : undefined,
                month: 'short',
                day: '2-digit'
            });
            const chicagoTimeFormatter = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/Chicago',
                hour: 'numeric',
                minute: '2-digit',
                second: prefs.showSeconds ? '2-digit' : undefined,
                hour12: !prefs.use24Hour
            });
            const timeParts = chicagoTimeFormatter.formatToParts(now);
            const hours = timeParts.find(part => part.type === 'hour')?.value ?? '--';
            const minutes = timeParts.find(part => part.type === 'minute')?.value ?? '--';
            const seconds = timeParts.find(part => part.type === 'second')?.value;
            const ampm = timeParts.find(part => part.type === 'dayPeriod')?.value?.toUpperCase() ?? '';
            const time = prefs.use24Hour
                ? `${hours}:${minutes}${seconds ? `:${seconds}` : ''}`
                : `${hours}:${minutes}${seconds ? `:${seconds}` : ''} <span class="dp-home-ampm">${ampm}</span>`;
            const date = chicagoDateFormatter.format(now);
            const hasWideHour = String(hours).length > 1;
            clockEl.classList.toggle('dp-home-clock-compact', !!seconds);
            clockEl.classList.toggle('dp-home-clock-expanded', !seconds);
            clockEl.classList.toggle('dp-home-clock-12h', !prefs.use24Hour);
            clockEl.classList.toggle('dp-home-clock-wide-hour', hasWideHour);
            dateEl.classList.toggle('dp-hidden', !prefs.showDate);
            clockEl.innerHTML = time;
            dateEl.textContent = date;
        };
        if (showSecondsToggle) {
            showSecondsToggle.addEventListener('change', updateClock);
        }
        if (clock24hToggle) {
            clock24hToggle.addEventListener('change', updateClock);
        }
        if (showDateToggle) {
            showDateToggle.addEventListener('change', updateClock);
        }
        if (showWeekdayToggle) {
            showWeekdayToggle.addEventListener('change', updateClock);
        }
        const adjustClockOffset = (delta) => {
            const prefs = getClockPreferences();
            const next = Math.max(-12, Math.min(12, prefs.hourOffset + delta));
            localStorage.setItem('dp-clock-hour-offset', String(next));
            syncClockToggles();
            updateClock();
        };
        if (clockOffsetDown) {
            clockOffsetDown.addEventListener('click', () => adjustClockOffset(-1));
        }
        if (clockOffsetUp) {
            clockOffsetUp.addEventListener('click', () => adjustClockOffset(1));
        }
        syncClockToggles();
        updateClock();
        setInterval(updateClock, 1000);
    }
});

// helper to re-render once DOM is ready after data arrived early
Manager.renderAll = function() {
    if (!this.domReady) return;
    this.renderSliders();
    this.renderMusicSlider();
    this.renderApps();
    this.renderGames();
    this.renderCommandHistory();
    if (this.lastMusicInfo) this.updateMusicNowPlaying(this.lastMusicInfo);
};
