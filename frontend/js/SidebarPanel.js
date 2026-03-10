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
        this._titleEl = null;
        this._contentEl = null;
        this._visible = false;
        this._activeView = null;
        this._savedWidth = null;
        this._views = {};

        this._build();
        this._setupResize();
    }

    _build() {
        this._panel.innerHTML = '';

        // Header
        this._header = document.createElement('div');
        this._header.className = 'sidebar-header';

        this._titleEl = document.createElement('div');
        this._titleEl.className = 'sidebar-title';
        this._titleEl.textContent = 'Explorer';
        this._header.appendChild(this._titleEl);

        this._panel.appendChild(this._header);

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
    registerView(key, view) {
        this._views[key] = view;
        view.element.style.display = 'none';
        this._contentEl.appendChild(view.element);
    }

    /**
     * Show the sidebar with a specific view.
     * @param {string} key - The view key to display
     */
    show(key) {
        const view = this._views[key];
        if (!view) return;

        // Hide previous view
        if (this._activeView && this._views[this._activeView]) {
            this._views[this._activeView].element.style.display = 'none';
        }

        // Show new view
        this._activeView = key;
        this._titleEl.textContent = view.title;
        view.element.style.display = '';

        if (!this._visible) {
            this._visible = true;
            if (this._savedWidth) {
                this._panel.style.width = this._savedWidth;
            }
            this._panel.classList.add('sidebar-open');
            this._resizer.classList.add('sidebar-open');
        }
    }

    /**
     * Hide the sidebar entirely.
     */
    hide() {
        this._visible = false;
        this._panel.classList.remove('sidebar-open');
        this._resizer.classList.remove('sidebar-open');

        if (this._activeView && this._views[this._activeView]) {
            this._views[this._activeView].element.style.display = 'none';
        }
        this._activeView = null;
    }

    /**
     * Toggle the sidebar for a specific view.
     * If already showing that view, hide. Otherwise, show it.
     */
    toggle(key) {
        if (this._visible && this._activeView === key) {
            this.hide();
            return false;
        }
        this.show(key);
        return true;
    }

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
