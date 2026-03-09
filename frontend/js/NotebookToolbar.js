import { POST_IT_ICON_TOOLBAR } from './CellPostIt.js';
import { PostItIndexPanel } from './PostItIndexPanel.js';
import { TocPanel } from './TocPanel.js';

const S = 'stroke="#202020" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
    folder:    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ${S}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" fill="#e6b800"/></svg>`,
    upload:    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ${S}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
    save:      `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ${S}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" fill="#4caf50"/><polygon points="17 21 17 13 7 13 7 21" fill="#fff2bc"/><polyline points="7 3 7 8 15 8" fill="#cecece"/></svg>`,
    download:  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ${S}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    settings:  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ${S}><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" fill="#c4a07a"/><circle cx="12" cy="12" r="3" fill="#fff2bc"/></svg>`,
    mlflow:    `<img src="static/images/mlflow.png" width="18" height="18" style="display:block"/>`,
    airflow:   `<img src="static/images/airflow.png" width="18" height="18" style="display:block"/>`,
    minio:     `<img src="static/images/minio.png" width="18" height="18" style="display:block"/>`,
    toc:       `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ${S}><line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/><circle cx="4.5" cy="6" r="1.5" fill="#5b9bd5"/><circle cx="4.5" cy="12" r="1.5" fill="#5b9bd5"/><circle cx="4.5" cy="18" r="1.5" fill="#5b9bd5"/></svg>`,
};

const SERVICES = [
    { key: 'airflow', icon: 'airflow', title: 'Airflow', url: '/airflow' },
    { key: 'mlflow',  icon: 'mlflow',  title: 'MLflow',  url: '/mlflow' },
    { key: 'minio',   icon: 'minio',   title: 'MinIO',   url: '/minio' },
];

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

        // Center: action buttons (absolute positioned)
        const actionsGroup = this._createGroup();
        actionsGroup.classList.add('toolbar-center');

        actionsGroup.appendChild(this._iconButton(ICONS.folder, 'Browse projects', () => {
            if (this._callbacks.onBrowse) this._callbacks.onBrowse();
        }));

        this._saveBtn = this._iconButton(ICONS.save, 'Save', () => {
            if (this._callbacks.onSave) this._callbacks.onSave();
        });
        actionsGroup.appendChild(this._saveBtn);

        actionsGroup.appendChild(this._iconButton(ICONS.upload, 'Import .ipynb file', () => {
            if (this._callbacks.onImport) this._callbacks.onImport();
        }));

        this._exportBtn = this._iconButton(ICONS.download, 'Export as .ipynb', () => {
            if (this._callbacks.onExport) this._callbacks.onExport();
        });
        actionsGroup.appendChild(this._exportBtn);

        actionsGroup.appendChild(this._iconButton(ICONS.toc, 'Table of Contents', () => {
            this._tocPanel.toggle();
        }));

        this._postItBtn = this._iconButton(POST_IT_ICON_TOOLBAR, 'Notes index', () => {
            this._postItIndex.toggle();
        });
        this._postItBtn.style.position = 'relative';
        this._notesBadge = document.createElement('span');
        this._notesBadge.className = 'toolbar-notes-badge';
        this._postItBtn.appendChild(this._notesBadge);
        actionsGroup.appendChild(this._postItBtn);

        const settingsBtn = this._iconButton(ICONS.settings, 'Settings', () => {
            if (this._callbacks.onSettingsToggle) this._callbacks.onSettingsToggle();
        });
        settingsBtn.className = 'toolbar-settings-btn';
        actionsGroup.appendChild(settingsBtn);

        // Service buttons (MLflow, Airflow, MinIO) — after settings with separator
        const servicesSep = document.createElement('div');
        servicesSep.className = 'toolbar-separator';
        actionsGroup.appendChild(servicesSep);
        for (const svc of SERVICES) {
            actionsGroup.appendChild(this._iconButton(ICONS[svc.icon], svc.title, () => {
                this._openServicePanel(svc);
            }));
        }

        this._container.appendChild(actionsGroup);

        // Spacer
        const spacer = document.createElement('div');
        spacer.className = 'toolbar-spacer';
        this._container.appendChild(spacer);

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

    updateNotesBadge() {
        const getCells = this._callbacks.getCells || (() => []);
        const cells = getCells();
        let count = 0;
        for (const cell of cells) {
            const meta = cell._data?.metadata?.noted;
            if (meta && meta.annotation !== undefined) count++;
        }
        this._notesBadge.textContent = count || '';
        this._notesBadge.style.display = count ? 'inline-block' : 'none';
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
