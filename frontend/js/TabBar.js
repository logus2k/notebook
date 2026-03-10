/**
 * TabBar - Manages tabs above the notebook area.
 *
 * Tab types:
 *   - 'notebook': the always-open notebook tab (not closable)
 *   - 'service':  iframe-based service tabs (closable) — MLflow, Airflow, MinIO
 *
 * Adapted from docbro's TabManager.
 */
export class TabBar {

    /**
     * @param {HTMLElement} containerEl - The element to render into (e.g. #center-column)
     * @param {object} callbacks
     * @param {function(string)} callbacks.onActivateTab - called with tab key when a tab is activated
     * @param {function(string)} callbacks.onCloseTab - called with tab key when a service tab is closed
     */
    constructor(containerEl, callbacks = {}) {
        this._container = containerEl;
        this._callbacks = callbacks;

        /** @type {Map<string, {key:string, label:string, type:string, icon?:string, closable:boolean}>} */
        this._tabs = new Map();
        this._activeKey = null;

        // Create the tab bar wrapper and insert at the top of the container
        this._barEl = document.createElement('div');
        this._barEl.className = 'tab-bar';
        this._container.insertBefore(this._barEl, this._container.firstChild);

        // Add the permanent notebook tab
        this.addTab({ key: 'notebook', label: 'Notebook', type: 'notebook', closable: false });
        this.activate('notebook');
    }

    /**
     * Add a tab. If it already exists, just activate it.
     * @param {{key:string, label:string, type:string, icon?:string, closable?:boolean}} tab
     */
    addTab(tab) {
        if (this._tabs.has(tab.key)) {
            this.activate(tab.key);
            return;
        }
        this._tabs.set(tab.key, {
            key: tab.key,
            label: tab.label,
            type: tab.type || 'service',
            icon: tab.icon || null,
            closable: tab.closable !== false,
        });
        this._render();
        this.activate(tab.key);
    }

    /**
     * Close (remove) a tab.
     */
    closeTab(key) {
        const tab = this._tabs.get(key);
        if (!tab || !tab.closable) return;

        this._tabs.delete(key);

        // If closing the active tab, switch to notebook
        if (this._activeKey === key) {
            this._activeKey = 'notebook';
            this._callbacks.onActivateTab?.('notebook');
        }

        this._callbacks.onCloseTab?.(key);
        this._render();
    }

    /**
     * Activate a tab by key.
     */
    activate(key) {
        if (!this._tabs.has(key)) return;
        this._activeKey = key;
        this._updateActiveState();
        this._callbacks.onActivateTab?.(key);
    }

    /**
     * Get the active tab key.
     */
    get activeKey() {
        return this._activeKey;
    }

    /**
     * Update the notebook tab label (e.g. when notebook name changes).
     */
    setNotebookLabel(label) {
        const tab = this._tabs.get('notebook');
        if (tab) {
            tab.label = label || 'Notebook';
            this._render();
        }
    }

    // --- Internal ---

    _render() {
        this._barEl.innerHTML = '';

        for (const [key, tab] of this._tabs) {
            const el = document.createElement('div');
            el.className = 'tab';
            el.dataset.tabKey = key;
            el.title = tab.label;

            if (tab.icon) {
                const img = document.createElement('img');
                img.className = 'tab-icon';
                img.src = tab.icon;
                img.alt = '';
                el.appendChild(img);
            }

            const labelSpan = document.createTextNode(tab.label);
            el.appendChild(labelSpan);

            el.addEventListener('click', () => this.activate(key));

            // Close button for closable tabs
            if (tab.closable) {
                const closeBtn = document.createElement('span');
                closeBtn.className = 'tab-close-btn';
                closeBtn.textContent = '\u00d7';
                closeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.closeTab(key);
                });
                el.appendChild(closeBtn);
            }

            this._barEl.appendChild(el);
        }

        this._updateActiveState();
    }

    _updateActiveState() {
        const tabs = this._barEl.querySelectorAll('.tab');
        tabs.forEach(el => {
            if (el.dataset.tabKey === this._activeKey) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
        });
    }
}
