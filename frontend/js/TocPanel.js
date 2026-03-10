/**
 * TocPanel - Table of Contents for the notebook.
 * Extracts headings from markdown cells and allows navigation.
 * Designed to be registered as a sidebar view (no own wrapper/resizer).
 */

export class TocPanel {
    /**
     * @param {function} getCells - Returns the current cells array
     * @param {function} [onSelectCell] - Called with cell index on click
     */
    constructor(getCells, onSelectCell) {
        this._getCells = getCells;
        this._onSelectCell = onSelectCell || null;
        this._active = false;
        this._headingEls = [];
        this._tocLinks = [];
        this._scrollHost = null;
        this._scrollHandler = null;

        this._build();
    }

    _build() {
        // The root element that gets registered as a sidebar view
        this._el = document.createElement('div');
        this._el.className = 'toc-nav';

        this._list = document.createElement('ul');
        this._el.appendChild(this._list);
    }

    /** The DOM element to register with SidebarPanel */
    get element() {
        return this._el;
    }

    /** Called when the sidebar activates this view */
    activate() {
        this._active = true;
        this._renderList();
        this._setupScrollTracking();
    }

    /** Called when the sidebar deactivates this view */
    deactivate() {
        this._active = false;
        this._teardownScrollTracking();
    }

    /** Refresh list if currently active */
    refresh() {
        if (this._active) {
            this._renderList();
            this._setupScrollTracking();
        }
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
        const tocEl = this._el;
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
}
