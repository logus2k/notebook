/**
 * IconBar - Narrow vertical strip on the left side of the application.
 * Holds category icons for the Workspace Explorer and service shortcuts.
 * Clicking an icon toggles the corresponding sidebar section.
 */

const S = 'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

const ICON_BAR_ICONS = {
    projects: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" ${S}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    environments: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" ${S}><rect x="2" y="3" width="20" height="18" rx="2"/><line x1="2" y1="9" x2="22" y2="9"/><line x1="8" y1="9" x2="8" y2="21"/><path d="M12 14l2 2-2 2"/></svg>`,
    experiments: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" ${S}><path d="M9 3h6v5l4 7H5l4-7V3z"/><line x1="9" y1="3" x2="15" y2="3"/><circle cx="10" cy="17" r="1" fill="currentColor"/><circle cx="14" cy="15" r="1" fill="currentColor"/><path d="M5 20h14"/></svg>`,
    storage: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" ${S}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4.03 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/></svg>`,
    pipelines: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" ${S}><rect x="1" y="4" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/><rect x="17" y="4" width="6" height="6" rx="1"/><path d="M7 7h2M15 12h2M12 9V7h5"/></svg>`,
    models: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" ${S}><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
    settings: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" ${S}><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" "/><circle cx="12" cy="12" r="3"/></svg>`,
};

export class IconBar {
    /**
     * @param {HTMLElement} containerEl - The #icon-bar element
     * @param {object} callbacks - { onIconClick(key) }
     */
    constructor(containerEl, callbacks = {}) {
        this._container = containerEl;
        this._callbacks = callbacks;
        this._activeKey = null;
        this._buttons = {};

        this._build();
    }

    _build() {
        this._container.innerHTML = '';

        // Workspace category icons
        const topGroup = document.createElement('div');
        topGroup.className = 'icon-bar-group';

        // Only Projects and Environments are active for now
        const categories = [
            { key: 'projects', title: 'Projects', enabled: true },
            { key: 'environments', title: 'Environments', enabled: true },
            { key: 'experiments', title: 'Experiments', enabled: false },
            { key: 'storage', title: 'Storage', enabled: false },
            { key: 'pipelines', title: 'Pipelines', enabled: false },
            { key: 'models', title: 'Models', enabled: false },
        ];

        for (const cat of categories) {
            const btn = document.createElement('button');
            btn.className = 'icon-bar-btn';
            btn.innerHTML = ICON_BAR_ICONS[cat.key];
            btn.title = cat.title;
            btn.dataset.key = cat.key;

            if (!cat.enabled) {
                btn.classList.add('icon-bar-btn-disabled');
                btn.disabled = true;
            } else {
                btn.addEventListener('click', () => this._onIconClick(cat.key));
            }

            topGroup.appendChild(btn);
            this._buttons[cat.key] = btn;
        }

        this._container.appendChild(topGroup);

        // Spacer pushes bottom group down
        const spacer = document.createElement('div');
        spacer.className = 'icon-bar-spacer';
        this._container.appendChild(spacer);

        // Bottom group: service shortcuts + settings
        const bottomGroup = document.createElement('div');
        bottomGroup.className = 'icon-bar-group icon-bar-bottom';

        const services = [
            { key: 'airflow', title: 'Airflow', img: 'static/images/airflow.png' },
            { key: 'mlflow', title: 'MLflow', img: 'static/images/mlflow.png' },
            { key: 'minio', title: 'MinIO', img: 'static/images/minio.png' },
        ];

        for (const svc of services) {
            const btn = document.createElement('button');
            btn.className = 'icon-bar-btn icon-bar-service';
            btn.innerHTML = `<img src="${svc.img}" width="20" height="20" alt="${svc.title}"/>`;
            btn.title = svc.title;
            btn.dataset.key = svc.key;
            btn.addEventListener('click', () => this._onIconClick(svc.key));
            bottomGroup.appendChild(btn);
            this._buttons[svc.key] = btn;
        }

        // Settings (always last)
        const settingsBtn = document.createElement('button');
        settingsBtn.className = 'icon-bar-btn';
        settingsBtn.innerHTML = ICON_BAR_ICONS.settings;
        settingsBtn.title = 'Settings';
        settingsBtn.dataset.key = 'settings';
        settingsBtn.addEventListener('click', () => this._onIconClick('settings'));
        bottomGroup.appendChild(settingsBtn);
        this._buttons['settings'] = settingsBtn;

        this._container.appendChild(bottomGroup);
    }

    _onIconClick(key) {
        // Toggle active state
        if (this._activeKey === key) {
            this._activeKey = null;
            this._buttons[key].classList.remove('icon-bar-btn-active');
        } else {
            // Deactivate previous
            if (this._activeKey && this._buttons[this._activeKey]) {
                this._buttons[this._activeKey].classList.remove('icon-bar-btn-active');
            }
            this._activeKey = key;
            this._buttons[key].classList.add('icon-bar-btn-active');
        }

        if (this._callbacks.onIconClick) {
            this._callbacks.onIconClick(key, this._activeKey === key);
        }
    }

    /** Set the active icon programmatically */
    setActive(key) {
        if (this._activeKey && this._buttons[this._activeKey]) {
            this._buttons[this._activeKey].classList.remove('icon-bar-btn-active');
        }
        this._activeKey = key;
        if (key && this._buttons[key]) {
            this._buttons[key].classList.add('icon-bar-btn-active');
        }
    }

    /** Clear any active state */
    clearActive() {
        if (this._activeKey && this._buttons[this._activeKey]) {
            this._buttons[this._activeKey].classList.remove('icon-bar-btn-active');
        }
        this._activeKey = null;
    }

    /** Get the currently active key */
    get activeKey() {
        return this._activeKey;
    }
}
