/**
 * TocPanel - Docked Table of Contents sidebar.
 * Extracts headings from markdown cells and allows navigation.
 * Visibility controlled via toolbar button.
 */

export class TocPanel {
    /**
     * @param {function} getCells - Returns the current cells array
     */
    constructor(getCells, onSelectCell) {
        this._getCells = getCells;
        this._onSelectCell = onSelectCell || null;
        this._visible = false;
        this._wrapper = null;
        this._list = null;
        this._resizer = null;
        this._savedWidth = null;
        this._scrollHost = null;
        this._headingEls = [];
        this._tocLinks = [];
        this._scrollHandler = null;

        this._build();
    }

    _build() {
        // Wrapper — fixed sidebar
        this._wrapper = document.createElement('div');
        this._wrapper.className = 'toc-wrapper';
        this._wrapper.style.display = 'none';

        // Header (outside scrollable area so it spans full width)
        const header = document.createElement('div');
        header.className = 'toc-header';

        const title = document.createElement('div');
        title.className = 'toc-title';
        title.textContent = 'Table of Contents';
        header.appendChild(title);

        this._wrapper.appendChild(header);

        // TOC content (scrollable)
        const toc = document.createElement('div');
        toc.className = 'toc-nav';

        // List container
        this._list = document.createElement('ul');
        toc.appendChild(this._list);

        this._wrapper.appendChild(toc);
        this._tocEl = toc;

        // Resize handle
        this._resizer = document.createElement('div');
        this._resizer.className = 'toc-resizer';
        this._resizer.style.display = 'none';
        this._setupResize();

        // Insert into DOM
        const app = document.getElementById('app');
        app.appendChild(this._wrapper);
        app.appendChild(this._resizer);

        this._contentArea = document.getElementById('content-area');
    }

    _setupResize() {
        let dragging = false;
        let startX, startWidth;

        this._resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            dragging = true;
            startX = e.clientX;
            startWidth = this._wrapper.getBoundingClientRect().width;
            this._resizer.classList.add('toc-dragging');
            this._wrapper.style.transition = 'none';
            this._contentArea.style.transition = 'none';
        });

        window.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const rawWidth = startWidth + (e.clientX - startX);
            const newWidth = Math.max(100, Math.min(500, rawWidth));
            this._wrapper.style.width = newWidth + 'px';
            this._positionResizer();
        });

        window.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            this._resizer.classList.remove('toc-dragging');
            this._wrapper.style.transition = '';
            this._contentArea.style.transition = '';
            this._savedWidth = this._wrapper.style.width || null;
        });

        window.addEventListener('resize', () => {
            if (this._visible) this._positionResizer();
        });
    }

    _positionResizer() {
        if (!this._visible) return;
        const rect = this._wrapper.getBoundingClientRect();
        this._resizer.style.left = (rect.right + 10) + 'px';
        this._resizer.style.top = rect.top + 'px';
        this._resizer.style.height = rect.height + 'px';
        this._updateContainerMargin();
    }

    _getTargetWidth() {
        return parseInt(this._wrapper.style.width) || 360;
    }

    _updateContainerMargin() {
        if (!this._contentArea) return;
        if (!this._visible) {
            this._contentArea.style.marginLeft = '';
        } else {
            const left = parseInt(getComputedStyle(this._wrapper).left) || 16;
            const margin = left + this._getTargetWidth() + 20;
            this._contentArea.style.marginLeft = margin + 'px';
        }
    }

    toggle() {
        if (this._visible) {
            this._hide();
        } else {
            this._show();
        }
    }

    _show() {
        this._visible = true;
        this._wrapper.style.display = '';
        this._resizer.style.display = '';
        if (this._savedWidth) {
            this._wrapper.style.width = this._savedWidth;
        }
        this._renderList();
        this._setupScrollTracking();
        this._updateContainerMargin();
        requestAnimationFrame(() => this._positionResizer());
    }

    _hide() {
        this._visible = false;
        this._wrapper.style.display = 'none';
        this._resizer.style.display = 'none';
        this._teardownScrollTracking();
        this._updateContainerMargin();
    }

    _renderList() {
        this._list.innerHTML = '';
        this._headingEls = [];
        this._tocLinks = [];

        const cells = this._getCells();

        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            if (cell._cellType !== 'markdown') continue;

            // Extract headings from rendered markdown
            const rendered = cell._mdRenderedEl;
            if (rendered) {
                const hEls = rendered.querySelectorAll('h1, h2, h3, h4, h5, h6');
                for (const h of hEls) {
                    const level = parseInt(h.tagName[1]);
                    const text = h.textContent.replace(/#$/, '').trim();
                    if (text) {
                        this._addEntry(level, text, cell, i, h);
                    }
                }
                if (hEls.length > 0) continue;
            }

            // Fallback: parse source for unrendered cells
            const source = cell._getSource ? cell._getSource() : (cell._data?.source || '');
            const srcText = Array.isArray(source) ? source.join('') : source;
            const lines = srcText.split('\n');
            for (const line of lines) {
                const match = line.match(/^(#{1,6})\s+(.+)/);
                if (match) {
                    this._addEntry(match[1].length, match[2].trim(), cell, i, null);
                }
            }
        }

        if (this._list.children.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'toc-empty';
            empty.textContent = 'No headings in this notebook.';
            this._list.appendChild(empty);
        }
    }

    _addEntry(level, text, cell, cellIndex, headingEl) {
        const li = document.createElement('li');
        li.className = `toc-h${level}`;

        const a = document.createElement('a');
        a.textContent = text;
        a.href = 'javascript:void(0)';
        a.addEventListener('click', (e) => {
            e.preventDefault();
            if (headingEl) {
                headingEl.scrollIntoView({ behavior: 'instant', block: 'start' });
            } else {
                cell.element.scrollIntoView({ behavior: 'instant', block: 'start' });
            }
            if (this._onSelectCell) {
                this._onSelectCell(cellIndex);
            }
        });

        li.appendChild(a);
        this._list.appendChild(li);

        this._headingEls.push({ el: headingEl || cell.element, li, isCell: !headingEl });
        this._tocLinks.push(a);
    }

    _setupScrollTracking() {
        this._teardownScrollTracking();
        if (this._headingEls.length === 0) return;

        this._scrollHost = document.getElementById('notebook-container');
        this._scrollHandler = () => this._updateActive();
        this._scrollHost.addEventListener('scroll', this._scrollHandler, { passive: true });
        this._updateActive();
    }

    _teardownScrollTracking() {
        if (this._scrollHost && this._scrollHandler) {
            this._scrollHost.removeEventListener('scroll', this._scrollHandler);
            this._scrollHandler = null;
        }
    }

    _updateActive() {
        if (this._headingEls.length === 0) return;

        const host = this._scrollHost;
        let active = this._headingEls[0];

        for (const h of this._headingEls) {
            if (h.el.getBoundingClientRect().top <= 80) active = h;
        }

        // If scrolled to top, activate first
        if (host.scrollTop < 2) {
            active = this._headingEls[0];
        }
        // If scrolled to bottom, activate last
        if (Math.abs((host.scrollTop + host.clientHeight) - host.scrollHeight) < 2) {
            active = this._headingEls[this._headingEls.length - 1];
        }

        for (const h of this._headingEls) {
            h.li.classList.remove('toc-active');
        }
        active.li.classList.add('toc-active');

        // Scroll TOC to keep active item visible
        const tocEl = this._tocEl;
        const liRect = active.li.getBoundingClientRect();
        const tocRect = tocEl.getBoundingClientRect();
        const padTop = parseFloat(getComputedStyle(tocEl).paddingTop);
        const padBottom = parseFloat(getComputedStyle(tocEl).paddingBottom);
        const visibleTop = tocRect.top + padTop;
        const visibleBottom = tocRect.bottom - padBottom;
        if (liRect.top < visibleTop) {
            tocEl.scrollTop += liRect.top - visibleTop;
        } else if (liRect.bottom > visibleBottom) {
            tocEl.scrollTop += liRect.bottom - visibleBottom;
        }
    }

    refresh() {
        if (this._visible) {
            this._renderList();
            this._setupScrollTracking();
            requestAnimationFrame(() => this._positionResizer());
        }
    }
}
