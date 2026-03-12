/**
 * IconBar - Narrow vertical strip on the left side of the application.
 * Holds category icons for the Workspace Explorer and service shortcuts.
 * Clicking an icon toggles the corresponding sidebar section.
 */

const ICON_BAR_ICONS = {
    projects:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="#f0c040" stroke="#fefefe" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    toc:       `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8fbcf0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="5" x2="21" y2="5"/><line x1="6" y1="10" x2="21" y2="10"/><line x1="6" y1="15" x2="21" y2="15"/><line x1="3" y1="20" x2="21" y2="20"/></svg>`,
    git:       `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8fbcf0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/><circle cx="6" cy="21" r="3"/></svg>`,
    robot:     `<svg width="27" height="27" viewBox="0 -960 960 960" xmlns="http://www.w3.org/2000/svg"><path d="M200-400q-33.85 0-56.92-23.08Q120-446.15 120-480t23.08-56.92Q166.15-560 200-560v-95.38q0-26.66 18.98-45.64T264.62-720H400q0-33.85 23.08-56.92Q446.15-800 480-800t56.92 23.08Q560-753.85 560-720h135.38q26.66 0 45.64 18.98T760-655.38V-560q33.85 0 56.92 23.08Q840-513.85 840-480t-23.08 56.92Q793.85-400 760-400v175.38q0 26.66-18.98 45.64T695.38-160H264.62q-26.66 0-45.64-18.98T200-224.62V-400Zm188.27-71.64Q400-483.28 400-499.91t-11.64-28.36Q376.72-540 360.09-540t-28.36 11.64Q320-516.72 320-500.09t11.64 28.36Q343.28-460 359.91-460t28.36-11.64Zm240 0Q640-483.28 640-499.91t-11.64-28.36Q616.72-540 600.09-540t-28.36 11.64Q560-516.72 560-500.09t11.64 28.36Q583.28-460 599.91-460t28.36-11.64ZM340-300h280v-40H340v40Zm-75.38 100h430.76q10.77 0 17.7-6.92 6.92-6.93 6.92-17.7v-430.76q0-10.77-6.92-17.7-6.93-6.92-17.7-6.92H264.62q-10.77 0-17.7 6.92-6.92 6.93-6.92 17.7v430.76q0 10.77 6.92 17.7 6.93 6.92 17.7 6.92ZM480-440Z" fill="#5ba4e6"/><rect x="240" y="-680" width="480" height="480" rx="18" fill="#ffffff"/><circle cx="360" cy="-500" r="36" fill="#2a6399"/><circle cx="600" cy="-500" r="36" fill="#2a6399"/><rect x="340" y="-340" width="280" height="40" rx="4" fill="#2a6399"/></svg>`,
    prompts:   `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c4a6e0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 9 12 4 17"/><line x1="12" y1="19" x2="20" y2="19"/><line x1="12" y1="12" x2="20" y2="12"/><line x1="12" y1="5" x2="20" y2="5"/></svg>`,
    settings:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="#CC7B19" stroke="#d4a855" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/><circle cx="12" cy="12" r="3" fill="#181818"/></svg>`,
};

export class IconBar {
    /**
     * @param {HTMLElement} containerEl - The #icon-bar element
     * @param {object} callbacks - { onIconClick(key) }
     */
    constructor(containerEl, callbacks = {}) {
        this._container = containerEl;
        this._callbacks = callbacks;
        this._buttons = {};

        this._build();
    }

    _build() {
        this._container.innerHTML = '';

        // Logo at the very top
        const logo = document.createElement('img');
        logo.src = 'static/images/noted_logo_small.png';
        logo.alt = 'noted';
        logo.className = 'icon-bar-logo';
        this._container.appendChild(logo);

        // Workspace category icons
        const topGroup = document.createElement('div');
        topGroup.className = 'icon-bar-group';

        // Projects (folder) icon
        const projectsBtn = document.createElement('button');
        projectsBtn.className = 'icon-bar-btn';
        projectsBtn.innerHTML = ICON_BAR_ICONS.projects;
        projectsBtn.title = 'Workspace';
        projectsBtn.dataset.key = 'projects';
        projectsBtn.addEventListener('click', () => this._onIconClick('projects'));
        topGroup.appendChild(projectsBtn);
        this._buttons['projects'] = projectsBtn;

        // TOC icon
        const tocBtn = document.createElement('button');
        tocBtn.className = 'icon-bar-btn';
        tocBtn.innerHTML = ICON_BAR_ICONS.toc;
        tocBtn.title = 'Table of Contents';
        tocBtn.dataset.key = 'toc';
        tocBtn.addEventListener('click', () => this._onIconClick('toc'));
        topGroup.appendChild(tocBtn);
        this._buttons['toc'] = tocBtn;

        // Git icon
        const gitBtn = document.createElement('button');
        gitBtn.className = 'icon-bar-btn';
        gitBtn.innerHTML = ICON_BAR_ICONS.git;
        gitBtn.title = 'Source Control';
        gitBtn.dataset.key = 'git';
        gitBtn.addEventListener('click', () => this._onIconClick('git'));
        topGroup.appendChild(gitBtn);
        this._buttons['git'] = gitBtn;

        // AI Assistant icon
        const chatBtn = document.createElement('button');
        chatBtn.className = 'icon-bar-btn icon-bar-btn-active';
        chatBtn.innerHTML = ICON_BAR_ICONS.robot;
        chatBtn.title = 'AI Assistant';
        chatBtn.dataset.key = 'assistant';
        chatBtn.addEventListener('click', () => this._onIconClick('assistant'));
        topGroup.appendChild(chatBtn);
        this._buttons['assistant'] = chatBtn;

        // LLM Prompts icon
        const promptsBtn = document.createElement('button');
        promptsBtn.className = 'icon-bar-btn';
        promptsBtn.innerHTML = ICON_BAR_ICONS.prompts;
        promptsBtn.title = 'LLM Prompts';
        promptsBtn.dataset.key = 'prompts';
        promptsBtn.addEventListener('click', () => this._onIconClick('prompts'));
        topGroup.appendChild(promptsBtn);
        this._buttons['prompts'] = promptsBtn;

        // Service icons (right after chat)
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
            topGroup.appendChild(btn);
            this._buttons[svc.key] = btn;
        }

        this._container.appendChild(topGroup);

        // Spacer pushes bottom group down
        const spacer = document.createElement('div');
        spacer.className = 'icon-bar-spacer';
        this._container.appendChild(spacer);

        // Bottom group: settings only
        const bottomGroup = document.createElement('div');
        bottomGroup.className = 'icon-bar-group icon-bar-bottom';

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
        // Delegate all state management to the app via callback
        if (this._callbacks.onIconClick) {
            this._callbacks.onIconClick(key);
        }
    }

    /** Show/hide the active indicator on an icon */
    setTabIndicator(key, show) {
        const btn = this._buttons[key];
        if (!btn) return;
        btn.classList.toggle('icon-bar-btn-active', show);
    }
}
