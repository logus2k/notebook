/**
 * SidebarPanel - Collapsible/expandable panel between the icon bar and content area.
 * Hosts different views (explorer tree, etc.) selected via the icon bar.
 * Lives in the normal flex flow of #below-bar.
 */

export class SidebarPanel {
    /**
     * @param {object} [callbacks] - { onResize() }
     */
    constructor(callbacks = {}) {
        this._panel = document.getElementById('sidebar-panel');
        this._resizer = document.getElementById('sidebar-resizer');
        this._contentArea = document.getElementById('content-area');
        this._callbacks = callbacks;
        this._header = null;
        this._tabsEl = null;
        this._contentEl = null;
        this._visible = false;
        this._activeView = null;
        this._savedWidth = null;
        this._views = {};
        this._openViews = new Set(); // tracks all currently open (not just shown) view keys

        this._build();
        this._setupResize();
    }

    _build() {
        this._panel.innerHTML = '';

        // Header — contains tabs
        this._header = document.createElement('div');
        this._header.className = 'sidebar-header';

        this._tabsEl = document.createElement('div');
        this._tabsEl.className = 'sidebar-tabs';
        this._header.appendChild(this._tabsEl);

        this._panel.appendChild(this._header);

        // Title bar — shows the active view's title or a custom titleElement
        this._titleBar = document.createElement('div');
        this._titleBar.className = 'sidebar-title-bar';

        this._titleEl = document.createElement('div');
        this._titleEl.className = 'sidebar-title';
        this._titleBar.appendChild(this._titleEl);

        this._panel.appendChild(this._titleBar);
        this._activeTitleElement = null;

        // Content area
        this._contentEl = document.createElement('div');
        this._contentEl.className = 'sidebar-content';
        this._panel.appendChild(this._contentEl);
    }

    _setupResize() {
        let startX, startWidth, rafId;

        this._resizer.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            startX = e.clientX;
            startWidth = this._panel.getBoundingClientRect().width;
            rafId = 0;
            this._resizer.classList.add('dragging');
            document.body.classList.add('resizing');
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'col-resize';
            this._panel.style.transition = 'none';
            // Contain layout during drag to limit reflow scope (on content-area, which holds the iframe)
            this._contentArea.style.contain = 'inline-size layout style';

            const onMouseMove = (e) => {
                if (rafId) return;
                rafId = requestAnimationFrame(() => {
                    const rawWidth = startWidth + (e.clientX - startX);
                    const newWidth = Math.max(160, Math.min(500, rawWidth));
                    this._panel.style.width = newWidth + 'px';
                    rafId = 0;
                });
            };

            const onMouseUp = () => {
                if (rafId) cancelAnimationFrame(rafId);
                this._resizer.classList.remove('dragging');
                document.body.classList.remove('resizing');
                document.body.style.userSelect = '';
                document.body.style.cursor = '';
                this._panel.style.transition = '';
                this._contentArea.style.contain = '';
                this._savedWidth = this._panel.style.width || null;
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                if (this._callbacks.onResize) this._callbacks.onResize();
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    /**
     * Register a named view that can be shown in the sidebar.
     * @param {string} key - View identifier (e.g. 'projects', 'environments')
     * @param {object} view - { title: string, element: HTMLElement }
     */
    /**
     * Register a named view that can be shown in the sidebar.
     * @param {string} key - View identifier (e.g. 'projects', 'toc')
     * @param {object} view - { tabLabel: string, title: string, element: HTMLElement, onActivate?, onDeactivate? }
     */
    registerView(key, view) {
        this._views[key] = view;
        view.element.style.display = 'none';
        this._contentEl.appendChild(view.element);

        // Create a tab in the header
        const tab = document.createElement('div');
        tab.className = 'sidebar-tab';
        tab.textContent = view.tabLabel || view.title;
        tab.dataset.key = key;
        tab.addEventListener('click', () => this.toggle(key));
        this._tabsEl.appendChild(tab);
        view._tab = tab;
    }

    /**
     * Show the sidebar with a specific view.
     * @param {string} key - The view key to display
     */
    show(key) {
        const view = this._views[key];
        if (!view) return;
        this._openViews.add(key);

        // Deactivate previous view (keep 'open', only remove 'active')
        if (this._activeView && this._views[this._activeView]) {
            const prev = this._views[this._activeView];
            prev.element.style.display = 'none';
            if (prev._tab) prev._tab.classList.remove('active');
            if (prev.onDeactivate) prev.onDeactivate();
        }

        // Show new view
        this._activeView = key;

        // Restore default title element if previous view had a custom one
        if (this._activeTitleElement) {
            this._titleBar.replaceChild(this._titleEl, this._activeTitleElement);
            this._activeTitleElement = null;
        }

        if (view.titleElement) {
            this._titleBar.replaceChild(view.titleElement, this._titleEl);
            this._activeTitleElement = view.titleElement;
        } else {
            this._titleEl.textContent = view.title;
        }

        view.element.style.display = '';
        if (view._tab) view._tab.classList.add('open', 'active');
        if (view.onActivate) view.onActivate();

        if (!this._visible) {
            this._visible = true;
            if (this._savedWidth) {
                this._panel.style.width = this._savedWidth;
            }
            this._panel.classList.add('sidebar-open');
            this._resizer.classList.add('sidebar-open');
        }

        if (this._callbacks.onViewChange) this._callbacks.onViewChange(key);
    }

    /**
     * Hide the sidebar entirely.
     */
    hide() {
        this._openViews.clear();
        this._visible = false;
        this._panel.classList.remove('sidebar-open');
        this._resizer.classList.remove('sidebar-open');

        if (this._activeView && this._views[this._activeView]) {
            const prev = this._views[this._activeView];
            prev.element.style.display = 'none';
            if (prev._tab) prev._tab.classList.remove('open', 'active');
            if (prev.onDeactivate) prev.onDeactivate();
        }
        for (const view of Object.values(this._views)) {
            if (view._tab) view._tab.classList.remove('open', 'active');
        }
        this._activeView = null;

        if (this._callbacks.onViewChange) this._callbacks.onViewChange(null);
    }

    /**
     * Close a specific view. If it was the active view, switch to another open view
     * or hide the sidebar if none remain open.
     */
    close(key) {
        this._openViews.delete(key);
        const view = this._views[key];
        if (view?._tab) view._tab.classList.remove('open', 'active');
        if (this._activeView === key) {
            const remaining = [...this._openViews];
            if (remaining.length > 0) {
                this.show(remaining[remaining.length - 1]);
            } else {
                this.hide();
            }
        }
        if (this._callbacks.onViewChange) this._callbacks.onViewChange(this._activeView);
    }

    /**
     * Toggle a view: open it if not open, close it if already open.
     */
    toggle(key) {
        if (this._openViews.has(key)) {
            this.close(key);
        } else {
            this.show(key);
        }
    }

    /**
     * Update a view's title. Refreshes the title bar if that view is active.
     */
    updateViewTitle(key, title) {
        const view = this._views[key];
        if (!view) return;
        view.title = title;
        if (this._activeView === key) {
            this._titleEl.textContent = title;
        }
    }

    get openViews() { return this._openViews; }

    get visible() {
        return this._visible;
    }

    get activeView() {
        return this._activeView;
    }

    get contentEl() {
        return this._contentEl;
    }

    get width() {
        return this._panel.getBoundingClientRect().width;
    }
}
