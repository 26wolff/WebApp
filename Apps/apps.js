

/*
updateApps(packet) {
        this.appsDiv.innerHTML = "";
        this.appsDiv.classList.add("app-grid");

        const allApps = [
            ...(packet.apps || []),
            ...(packet.steamGames || [])
        ];

        allApps.forEach(app => {
            if (!app.icon) return; // skip apps without an icon

            const btn = document.createElement("button");
            btn.classList.add("app-button");

            const img = document.createElement("img");

            // Desktop app (base64)
            if (!app.icon.startsWith("http")) {
                img.src = `data:image/png;base64,${app.icon}`;
            }
            // Steam icon (URL)
            else {
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
*/ 