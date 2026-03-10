import { PostItIndexPanel } from './PostItIndexPanel.js';
import { TocPanel } from './TocPanel.js';

const ICONS = {
    robot: `<svg width="25" height="25" viewBox="0 -960 960 960" style="vertical-align:middle" xmlns="http://www.w3.org/2000/svg"><rect x="250" y="-710" width="460" height="540" rx="20" fill="#c6e2ff"/><path d="M200-400q-33.85 0-56.92-23.08Q120-446.15 120-480t23.08-56.92Q166.15-560 200-560v-95.38q0-26.66 18.98-45.64T264.62-720H400q0-33.85 23.08-56.92Q446.15-800 480-800t56.92 23.08Q560-753.85 560-720h135.38q26.66 0 45.64 18.98T760-655.38V-560q33.85 0 56.92 23.08Q840-513.85 840-480t-23.08 56.92Q793.85-400 760-400v175.38q0 26.66-18.98 45.64T695.38-160H264.62q-26.66 0-45.64-18.98T200-224.62V-400Zm188.27-71.64Q400-483.28 400-499.91t-11.64-28.36Q376.72-540 360.09-540t-28.36 11.64Q320-516.72 320-500.09t11.64 28.36Q343.28-460 359.91-460t28.36-11.64Zm240 0Q640-483.28 640-499.91t-11.64-28.36Q616.72-540 600.09-540t-28.36 11.64Q560-516.72 560-500.09t11.64 28.36Q583.28-460 599.91-460t28.36-11.64ZM340-300h280v-40H340v40Zm-75.38 100h430.76q10.77 0 17.7-6.92 6.92-6.93 6.92-17.7v-430.76q0-10.77-6.92-17.7-6.93-6.92-17.7-6.92H264.62q-10.77 0-17.7 6.92-6.92 6.93-6.92 17.7v430.76q0 10.77 6.92 17.7 6.93 6.92 17.7 6.92ZM480-440Z" fill="#202020"/></svg>`,
};

/**
 * NotebookToolbar - Navigation, file actions, settings, connected users.
 */
export class NotebookToolbar {
    /**
     * @param {HTMLElement} containerEl
     * @param {import('./KernelClient.js').KernelClient} kernelClient
     * @param {object} callbacks - { onBrowse, onImport, onSave, onExport, onSettingsToggle }
     */
    constructor(containerEl, kernelClient, callbacks = {}) {
        this._container = containerEl;
        this._client = kernelClient;
        this._callbacks = callbacks;
        this._connectedUsers = {};
        this._servicePanels = {};
        this._postItIndex = new PostItIndexPanel(callbacks.getCells || (() => []));
        this._tocPanel = new TocPanel(
            callbacks.getCells || (() => []),
            callbacks.onSelectCell || null
        );

        this._build();
        this._setupListeners();

        // Show TOC by default (defer to after layout settles)
        requestAnimationFrame(() => this._tocPanel.toggle());
    }

    _build() {
        this._container.innerHTML = '';

        // Left: title/logo
        const title = document.createElement('img');
        title.className = 'toolbar-title';
        title.src = 'static/images/noted_logo.png';
        title.alt = 'noted';
        this._container.appendChild(title);

        // Spacer
        const spacer = document.createElement('div');
        spacer.className = 'toolbar-spacer';
        this._container.appendChild(spacer);

        // AI chat toggle
        this._chatBtn = this._iconButton(ICONS.robot, 'AI Assistant', () => {
            if (this._callbacks.onChatToggle) this._callbacks.onChatToggle();
            this._chatBtn.classList.toggle('toolbar-btn-active');
        });
        this._chatBtn.classList.add('toolbar-btn-active');
        this._container.appendChild(this._chatBtn);

        // Connected users
        this._usersEl = document.createElement('div');
        this._usersEl.className = 'connected-users';
        this._container.appendChild(this._usersEl);
    }

    _setupListeners() {
        this._client.on('user:joined', (data) => {
            this._connectedUsers[data.sid] = data.name;
            this._renderUsers();
        });
        this._client.on('user:left', (data) => {
            delete this._connectedUsers[data.sid];
            this._renderUsers();
        });
        this._client.on('notebook:state', (data) => {
            this._connectedUsers = {};
            const users = data.connected_users || {};
            for (const [sid, info] of Object.entries(users)) {
                this._connectedUsers[sid] = info.name || 'Anonymous';
            }
            this._renderUsers();
        });
    }

    _renderUsers() {
        this._usersEl.innerHTML = '';
        for (const [sid, name] of Object.entries(this._connectedUsers)) {
            const avatar = document.createElement('div');
            avatar.className = 'user-avatar';
            avatar.textContent = (name || '?')[0].toUpperCase();
            avatar.title = name;
            this._usersEl.appendChild(avatar);
        }
    }

    countNotes() {
        const getCells = this._callbacks.getCells || (() => []);
        const cells = getCells();
        let count = 0;
        for (const cell of cells) {
            const meta = cell._data?.metadata?.noted;
            if (meta && meta.annotation !== undefined) count++;
        }
        return count;
    }

    refreshToc() {
        this._tocPanel.refresh();
    }

    // --- Service panels ---

    _openServicePanel(svc) {
        if (this._servicePanels[svc.key]) {
            this._servicePanels[svc.key].front();
            return;
        }

        const panel = jsPanel.create({
            id: `service-panel-${svc.key}`,
            headerTitle: svc.title,
            theme: 'none',
            borderRadius: '5px',
            border: '1px solid var(--border-color)',
            boxShadow: 3,
            position: 'center',
            panelSize: { width: '80vw', height: '80vh' },
            headerControls: { minimize: 'remove', smallify: 'remove', normalize: 'remove', maximize: 'remove' },
            onclosed: () => {
                delete this._servicePanels[svc.key];
            },
            callback: (panel) => {
                const content = panel.content;
                content.style.padding = '0';
                content.style.overflow = 'hidden';

                const iframe = document.createElement('iframe');
                iframe.src = svc.url;
                iframe.style.cssText = 'width:100%;height:100%;border:none;';
                content.appendChild(iframe);
            },
        });

        this._servicePanels[svc.key] = panel;
    }

    // --- Helpers ---

    _createGroup() {
        const div = document.createElement('div');
        div.className = 'toolbar-group';
        return div;
    }

    _iconButton(svgHtml, title, onClick) {
        const btn = document.createElement('button');
        btn.className = 'toolbar-icon-btn';
        btn.innerHTML = svgHtml;
        btn.title = title;
        btn.addEventListener('click', onClick);
        return btn;
    }
}
