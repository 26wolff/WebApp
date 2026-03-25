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
        this.sliderGroups = new Map();
        this.appData = {};
        this.gameData = {};
        this.musicPrivacyEnabled = false;
        this.lastMusicInfo = null;
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

        const url = `ws://${this.SERVER_IP}:${this.SERVER_PORT}/ws`;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            console.log("[WS] Connected to server");
            clearTimeout(this.reconnectTimer);
            this.connected = true;
            this.updateTrayIconsConnection();
            this.requestInitialData();
        };

        this.ws.onmessage = (event) => {
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
        };

        this.ws.onclose = () => {
            console.log("[WS] Disconnected, reconnecting in 2s...");
            this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 2000);
            this.connected = false;
            this.updateTrayIconsConnection();
        };

        this.ws.onerror = (err) => console.error("[WS ERROR]", err);
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
        }
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
        container.innerHTML = '';

        const gameList = Array.isArray(this.gameData) ? this.gameData : [];
        if (emptyState) emptyState.style.display = gameList.length ? 'none' : 'flex';
        if (!gameList.length) return;
        gameList.forEach(gameInfo => {
            new GameTile(gameInfo, container, 'Content/GamesIcon.png');
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
        this.loadLocalSliderData();
        this.requestInitialData();
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
        const subEl = document.getElementById('dp-music-sub');
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
                if (subEl) subEl.textContent = '';
                if (thumbEl) thumbEl.src = 'Content/NoSongIcon.png';
                if (this.musicControls) this.musicControls.setPlayingState(false);
                return;
            }

            // something playing but hidden
            if (titleEl) titleEl.textContent = 'Now playing';
            if (artistEl) artistEl.textContent = 'Audio';
            if (subEl) subEl.textContent = '';
            if (thumbEl) thumbEl.src = 'Content/MusicRunIcon.png';
            if (this.musicControls) this.musicControls.setPlayingState(true);
            return;
        }

        // NORMAL MODE
        if (!info) {
            if (titleEl) titleEl.textContent = 'Nothing playing';
            if (artistEl) artistEl.textContent = '—';
            if (subEl) subEl.textContent = '';
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

function applyHiddenCursor() {
    const hidden = 'url("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==") 0 0, none';
    document.documentElement.style.cursor = hidden;
    document.body.style.cursor = hidden;
}

function installHiddenCursorGuards() {
    const force = () => applyHiddenCursor();
    const events = ['mousemove', 'mousedown', 'mouseup', 'pointermove', 'pointerdown', 'pointerup', 'touchstart', 'touchmove', 'input'];

    for (let i = 0; i < events.length; i++) {
        document.addEventListener(events[i], force, true);
    }

    force();
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
        let active = null;
        for (let i = 0; i < themeButtons.length; i++) {
            const btn = themeButtons[i];
            if (btn.dataset.theme === (theme || 'default')) {
                active = btn;
                break;
            }
        }
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

    const clockEl = document.getElementById('dp-home-clock');
    const dateEl = document.getElementById('dp-home-date');
    if (clockEl && dateEl) {
        const updateClock = () => {
            const now = new Date();
            const rawHours = now.getHours();
            const hours = rawHours % 12 || 12;
            const minutes = pad2(now.getMinutes());
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

// helper to re-render once DOM is ready after data arrived early
Manager.renderAll = function() {
    if (!this.domReady) return;
    this.renderSliders();
    this.renderMusicSlider();
    this.renderApps();
    this.renderGames();
    if (this.lastMusicInfo) this.updateMusicNowPlaying(this.lastMusicInfo);
};






