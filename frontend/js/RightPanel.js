/**
 * RightPanel - Tabbed panel for the right side (Assistant, Prompts, etc.)
 * Mirrors the SidebarPanel tab system with matching styling.
 */
export class RightPanel {

    constructor(container) {
        this._container = container;
        this._views = {};
        this._activeView = null;
        this._build();
    }

    _build() {
        this._container.innerHTML = '';

        // Header — contains tabs
        this._header = document.createElement('div');
        this._header.className = 'right-panel-header';

        this._tabsEl = document.createElement('div');
        this._tabsEl.className = 'right-panel-tabs';
        this._header.appendChild(this._tabsEl);
        this._container.appendChild(this._header);

        // Title bar
        this._titleBar = document.createElement('div');
        this._titleBar.className = 'right-panel-title-bar';
        this._titleEl = document.createElement('div');
        this._titleEl.className = 'right-panel-title';
        this._titleBar.appendChild(this._titleEl);

        // Status label + LED (right-aligned)
        this._statusLabel = document.createElement('span');
        this._statusLabel.className = 'right-panel-status-label';
        this._titleBar.appendChild(this._statusLabel);

        this._statusLed = document.createElement('span');
        this._statusLed.className = 'right-panel-status-led';
        this._titleBar.appendChild(this._statusLed);

        this._container.appendChild(this._titleBar);

        // Content area
        this._contentEl = document.createElement('div');
        this._contentEl.className = 'right-panel-content';
        this._container.appendChild(this._contentEl);
    }

    registerView(key, view) {
        this._views[key] = view;
        view.element.style.display = 'none';
        this._contentEl.appendChild(view.element);

        const tab = document.createElement('div');
        tab.className = 'right-panel-tab';
        tab.textContent = view.tabLabel || view.title;
        tab.dataset.key = key;
        tab.addEventListener('click', () => this.show(key));
        this._tabsEl.appendChild(tab);
        view._tab = tab;
    }

    show(key) {
        const view = this._views[key];
        if (!view) return;

        // Deactivate previous
        if (this._activeView && this._activeView !== key) {
            const prev = this._views[this._activeView];
            prev.element.style.display = 'none';
            prev._tab.classList.remove('active');
            if (prev.onDeactivate) prev.onDeactivate();
        }

        // Activate new
        view.element.style.display = '';
        view._tab.classList.add('active');
        this._activeView = key;
        this._titleEl.textContent = view.title || '';
        if (view.onActivate) view.onActivate();
    }

    updateViewTitle(key, title) {
        const view = this._views[key];
        if (!view) return;
        view.title = title;
        if (this._activeView === key) {
            this._titleEl.textContent = title;
        }
    }

    /** Set the status LED: 'connected', 'disconnected', or 'connecting' */
    setStatusLed(state) {
        this._statusLed.className = `right-panel-status-led ${state}`;
        const labels = { connected: 'Connected', disconnected: 'Disconnected', connecting: 'Connecting...' };
        this._statusLabel.textContent = labels[state] || '';
    }

    get activeView() {
        return this._activeView;
    }
}
