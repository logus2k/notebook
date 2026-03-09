import { CellOutput } from './CellOutput.js';
import { CellPostIt, POST_IT_ICON_CELL } from './CellPostIt.js';

/**
 * CellEditor - Manages a single notebook cell with CodeMirror editor.
 * CodeMirror 6 is loaded dynamically from ESM CDN on first use.
 */

import {
    EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
    EditorState, Compartment,
    defaultKeymap, indentWithTab, history, historyKeymap,
    syntaxHighlighting, defaultHighlightStyle, HighlightStyle,
    tags,
    python, markdown,
    ayuLight, clouds, espresso, smoothy, tomorrow, oneDark
} from '../vendor/codemirror/codemirror.bundle.js';

/** Highlight style for markdown tokens. */
const markdownHighlightStyle = HighlightStyle.define([
    { tag: tags.heading1, fontWeight: 'bold', fontSize: '1.4em', color: '#1a1a1a' },
    { tag: tags.heading2, fontWeight: 'bold', fontSize: '1.2em', color: '#2a2a2a' },
    { tag: tags.heading3, fontWeight: 'bold', fontSize: '1.1em', color: '#3a3a3a' },
    { tag: tags.heading, fontWeight: 'bold', color: '#1a1a1a' },
    { tag: tags.emphasis, fontStyle: 'italic', color: '#6a5acd' },
    { tag: tags.strong, fontWeight: 'bold', color: '#d63384' },
    { tag: tags.link, color: '#0969da', textDecoration: 'underline' },
    { tag: tags.url, color: '#0969da' },
    { tag: tags.monospace, fontFamily: 'var(--font-mono)', backgroundColor: '#f0f0f0', borderRadius: '3px', color: '#c7254e' },
    { tag: tags.strikethrough, textDecoration: 'line-through', color: '#999' },
    { tag: tags.quote, color: '#57606a', fontStyle: 'italic' },
    { tag: tags.list, color: '#cf222e' },
    { tag: tags.processingInstruction, color: '#888' },
]);

const cmModules = {
    EditorView, keymap, lineNumbers, highlightActiveLine,
    highlightActiveLineGutter, EditorState, defaultKeymap,
    indentWithTab, history, historyKeymap,
    syntaxHighlighting, defaultHighlightStyle,
    python, markdown
};

/** Shared theme compartment for all editors. */
const _themeCompartment = new Compartment();

/** Track all live CellEditor instances for theme reconfiguration. */
const _allEditors = new Set();

/** Available editor themes keyed by name. */
export const editorThemes = {
    'Default': null,
    'Ayu Light': ayuLight,
    'Clouds': clouds,
    'Espresso': espresso,
    'Smoothy': smoothy,
    'Tomorrow': tomorrow,
    'One Dark': oneDark
};

function loadCodeMirror() {
    return cmModules;
}


// Track the currently focused cell so we can blur it when another is focused
let _currentlyFocusedCell = null;
let _currentProjectId = null;

export class CellEditor {
    /**
     * @param {object} cellData - Cell data from .ipynb JSON
     * @param {number} index - Cell index in notebook
     * @param {object} callbacks - { onFocus, onBlur, onChange, onRun, onDelete }
     */
    constructor(cellData, index, callbacks = {}) {
        this._data = cellData;
        this._index = index;
        this._callbacks = callbacks;
        this._cellType = cellData.cell_type || 'code';
        this._source = Array.isArray(cellData.source)
            ? cellData.source.join('')
            : (cellData.source || '');
        this._executionCount = cellData.execution_count;
        this._editorView = null;
        this._locked = false;
        this._lockedBy = null;
        this._focused = false;
        this._executing = false;
        this._markdownRendered = false;

        this._output = new CellOutput();
        this._el = this._buildElement();
        _allEditors.add(this);

        if (cellData.outputs && cellData.outputs.length > 0) {
            this._output.setOutputs(cellData.outputs);
        }

        // Post-it note (persisted in cell.metadata.noted)
        if (!this._data.metadata) this._data.metadata = {};
        this._postIt = new CellPostIt(this._el, this._data.metadata, () => {
            this._notifyChange();
        });

        this._initEditor();
    }

    get element() { return this._el; }
    get index() { return this._index; }
    set index(val) {
        this._index = val;
        this._updateExecutionCount();
    }

    get cellType() { return this._cellType; }
    get source() { return this._getSource(); }
    get cellId() { return this._data.id; }
    get output() { return this._output; }
    get isEditorFocused() { return !!this._editorView?.hasFocus; }

    focusCell() { this._el.focus({ preventScroll: true }); }
    focusEditor() { this._editorView?.focus(); }

    /** Notify parent that cell content/metadata changed. */
    _notifyChange() {
        if (this._callbacks.onChange) {
            this._callbacks.onChange(this._index, this._getSource());
        }
    }

    _buildElement() {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.cellType = this._cellType;
        cell.tabIndex = -1;

        // Click anywhere on the cell — delegate to notebook for selection
        cell.addEventListener('mousedown', (e) => {
            if (this._callbacks.onCellMousedown) {
                this._callbacks.onCellMousedown(this._index, e);
            } else if (!this._focused) {
                this._onFocus();
            }
        });

        // Click (fires after mouseup, but NOT after drag) — for deferred focus
        cell.addEventListener('click', (e) => {
            if (this._callbacks.onCellClick) {
                this._callbacks.onCellClick(this._index, e);
            }
        });

        // Command-mode keydown: only fires when cell has focus but editor does not
        cell.addEventListener('keydown', (e) => {
            if (this.isEditorFocused) return;
            if (this._callbacks.onCellKeydown) this._callbacks.onCellKeydown(this._index, e);
        });

        // Cell-level drag (for multi-selection; cell.draggable is toggled by NotebookEditor)
        cell.addEventListener('dragstart', (e) => {
            if (this._callbacks.onCellDragStart) {
                this._callbacks.onCellDragStart(this._index, e);
            }
        });
        cell.addEventListener('dragend', () => {
            if (this._callbacks.onCellDragEnd) {
                this._callbacks.onCellDragEnd(this._index);
            }
        });

        // Sidebar
        const sidebar = document.createElement('div');
        sidebar.className = 'cell-sidebar';

        const runBtn = this._sidebarBtn('\u25B6', 'Run cell', () => this._onRun());
        runBtn.className = 'cell-run-btn';
        sidebar.appendChild(runBtn);

        const dragHandle = document.createElement('div');
        dragHandle.className = 'cell-drag-handle';
        dragHandle.textContent = '\u2847';
        dragHandle.title = 'Drag to reorder';
        dragHandle.draggable = true;
        dragHandle.addEventListener('dragstart', (e) => {
            if (this._callbacks.onCellDragStart) {
                this._callbacks.onCellDragStart(this._index, e);
            } else {
                e.dataTransfer.setData('text/plain', String(this._index));
                e.dataTransfer.effectAllowed = 'move';
                cell.classList.add('dragging');
            }
        });
        dragHandle.addEventListener('dragend', () => {
            if (this._callbacks.onCellDragEnd) {
                this._callbacks.onCellDragEnd(this._index);
            } else {
                cell.classList.remove('dragging');
            }
        });
        sidebar.appendChild(dragHandle);

        // Sidebar execution count (code cells only)
        const sidebarExecCount = document.createElement('span');
        sidebarExecCount.className = 'cell-sidebar-exec-count';
        this._sidebarExecCountEl = sidebarExecCount;
        this._updateExecutionCount();
        sidebar.appendChild(sidebarExecCount);

        // Header
        const header = document.createElement('div');
        header.className = 'cell-header';

        const typeBadge = document.createElement('span');
        typeBadge.className = `cell-type-badge ${this._cellType}`;
        typeBadge.textContent = this._cellType;

        // Left segment
        const headerLeft = document.createElement('div');
        headerLeft.className = 'cell-header-left';
        headerLeft.appendChild(typeBadge);

        // Center segment
        const headerCenter = document.createElement('div');
        headerCenter.className = 'cell-header-center';

        const addCodeBtn = document.createElement('button');
        addCodeBtn.className = 'cell-header-btn cell-add-code-btn';
        addCodeBtn.textContent = '+ code';
        addCodeBtn.title = 'Insert code cell before';
        addCodeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._callbacks.onAddCell) this._callbacks.onAddCell(this._index, 'code');
        });

        const addMdBtn = document.createElement('button');
        addMdBtn.className = 'cell-header-btn cell-add-md-btn';
        addMdBtn.textContent = '+ markdown';
        addMdBtn.title = 'Insert markdown cell before';
        addMdBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._callbacks.onAddCell) this._callbacks.onAddCell(this._index, 'markdown');
        });

        headerCenter.append(addCodeBtn, addMdBtn);

        const lockIndicator = document.createElement('span');
        lockIndicator.className = 'cell-lock-indicator hidden';
        this._lockIndicatorEl = lockIndicator;

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'cell-delete-btn';
        deleteBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#202020" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" fill="#f4a0a0"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
        deleteBtn.title = 'Delete cell';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._callbacks.onDelete) this._callbacks.onDelete(this._index);
        });

        const copyBtn = document.createElement('button');
        copyBtn.className = 'cell-copy-btn';
        copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#202020" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" fill="#a8d8a0"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        copyBtn.title = 'Copy cell content';
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const source = this._getSource();
            navigator.clipboard.writeText(source).then(() => {
                const tip = document.createElement('span');
                tip.className = 'cell-copy-toast';
                tip.textContent = 'Copied';
                copyBtn.style.position = 'relative';
                copyBtn.appendChild(tip);
                setTimeout(() => tip.remove(), 1200);
            });
        });

        const clearBtn = document.createElement('button');
        clearBtn.className = 'cell-clear-btn';
        clearBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#202020" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15.5 4 5 5-11 11H5l-2.5-2.5a1.5 1.5 0 010-2L15.5 4z" fill="#f0d080"/><path d="M5 20.5L2.5 18"/><path d="M4 22h17"/></svg>';
        clearBtn.title = 'Clear cell output';
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.clearOutput();
        });

        const runAboveBtn = document.createElement('button');
        runAboveBtn.className = 'cell-header-btn cell-run-above-btn';
        runAboveBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#202020" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="1,4 1,20 13,12" fill="#f0b870"/><line x1="20" y1="20" x2="20" y2="9"/><polygon points="16,12 20,5 24,12" fill="#202020"/></svg>';
        runAboveBtn.title = 'Execute all cells above';
        runAboveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._callbacks.onRunAbove) this._callbacks.onRunAbove(this._index);
        });

        const runBelowBtn = document.createElement('button');
        runBelowBtn.className = 'cell-header-btn cell-run-below-btn';
        runBelowBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#202020" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="1,4 1,20 13,12" fill="#f0b870"/><line x1="20" y1="4" x2="20" y2="15"/><polygon points="16,12 20,19 24,12" fill="#202020"/></svg>';
        runBelowBtn.title = 'Execute this cell and all below';
        runBelowBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._callbacks.onRunBelow) this._callbacks.onRunBelow(this._index);
        });

        // Post-it button
        const postItBtn = document.createElement('button');
        postItBtn.className = 'cell-header-btn cell-postit-btn';
        postItBtn.innerHTML = POST_IT_ICON_CELL;
        postItBtn.title = 'Note this cell';
        postItBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._postIt.toggle();
            postItBtn.classList.toggle('has-note', this._postIt.hasNote());
        });
        this._postItBtn = postItBtn;
        // Highlight if note already exists
        if (this._data.metadata?.noted?.annotation !== undefined) {
            postItBtn.classList.add('has-note');
        }

        // Right segment
        const headerRight = document.createElement('div');
        headerRight.className = 'cell-header-right';
        headerRight.append(lockIndicator, postItBtn, runAboveBtn, runBelowBtn, copyBtn, clearBtn, deleteBtn);

        header.append(headerLeft, headerCenter, headerRight);

        // Editor area
        const editorArea = document.createElement('div');
        editorArea.className = 'cell-editor';
        this._editorAreaEl = editorArea;

        // Markdown rendered view
        const mdRendered = document.createElement('div');
        mdRendered.className = 'cell-markdown-rendered hidden';
        this._mdRenderedEl = mdRendered;

        cell.append(sidebar, header, editorArea, mdRendered);

        if (this._cellType === 'code') {
            cell.appendChild(this._output.element);
        }

        return cell;
    }

    _sidebarBtn(label, title, onClick) {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.title = title;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });
        return btn;
    }

    async _initEditor() {
        const cm = await loadCodeMirror();

        // Resolve initial theme from localStorage
        const savedThemeName = localStorage.getItem('notebook-editor-theme') || 'Tomorrow';
        const initialTheme = editorThemes[savedThemeName] || [];

        const extensions = [
            cm.lineNumbers(),
            cm.highlightActiveLine(),
            cm.highlightActiveLineGutter(),
            cm.history(),
            cm.syntaxHighlighting(cm.defaultHighlightStyle, { fallback: true }),
            cm.keymap.of([
                { key: 'Shift-Enter', run: () => { this._onRun(); return true; } },
                { key: 'Ctrl-Enter', run: () => { this._onRun(); return true; } },
                { key: 'Escape', run: () => {
                    if (this._cellType === 'markdown') {
                        this._showMarkdownRendered();
                    }
                    this._editorView.contentDOM.blur();
                    this._el.focus(); // enter command mode
                    return true;
                }},
                ...cm.defaultKeymap,
                ...cm.historyKeymap,
                cm.indentWithTab
            ]),
            cm.EditorView.updateListener.of((update) => {
                if (update.docChanged) this._onContentChanged();
                if (update.focusChanged) {
                    if (update.view.hasFocus) {
                        this._onFocus();
                        if (this._callbacks.onEditorFocus) this._callbacks.onEditorFocus(this._index);
                    } else {
                        this._onBlur();
                        if (this._callbacks.onEditorBlur) this._callbacks.onEditorBlur(this._index);
                    }
                }
            }),
            cm.EditorView.theme({
                '&': { height: 'auto' },
                '.cm-scroller': { overflow: 'auto' }
            }),
            _themeCompartment.of(initialTheme)
        ];

        if (this._cellType === 'code') {
            extensions.push(cm.python());
        } else if (this._cellType === 'markdown') {
            extensions.push(cm.markdown());
            extensions.push(syntaxHighlighting(markdownHighlightStyle));
            extensions.push(cm.EditorView.lineWrapping);
        }

        this._editorView = new cm.EditorView({
            state: cm.EditorState.create({
                doc: this._source,
                extensions
            }),
            parent: this._editorAreaEl
        });

        this._syncGutterWidth();

        if (this._cellType === 'markdown' && this._source.trim()) {
            this._showMarkdownRendered();
        }
    }

    _syncGutterWidth() {
        if (!this._editorView || this._gutterObserver) return;
        const gutterEl = this._editorAreaEl.querySelector('.cm-gutters');
        if (gutterEl) {
            this._el.style.setProperty('--gutter-width', gutterEl.offsetWidth + 'px');
            this._gutterObserver = new ResizeObserver(() => {
                this._el.style.setProperty('--gutter-width', gutterEl.offsetWidth + 'px');
            });
            this._gutterObserver.observe(gutterEl);
        }
    }

    _getSource() {
        if (this._editorView) {
            return this._editorView.state.doc.toString();
        }
        return this._source;
    }

    setSource(source) {
        if (this._editorView) {
            const currentDoc = this._editorView.state.doc.toString();
            if (currentDoc !== source) {
                this._editorView.dispatch({
                    changes: { from: 0, to: currentDoc.length, insert: source }
                });
            }
        }
        this._source = source;
    }

    _onFocus() {
        if (_currentlyFocusedCell && _currentlyFocusedCell !== this) {
            _currentlyFocusedCell._onBlur();
        }
        _currentlyFocusedCell = this;
        this._focused = true;
        this._el.classList.add('focused');
        if (this._callbacks.onFocus) this._callbacks.onFocus(this._index);
    }

    _onBlur() {
        if (_currentlyFocusedCell === this) {
            _currentlyFocusedCell = null;
        }
        this._focused = false;
        this._el.classList.remove('focused');
        if (this._callbacks.onBlur) this._callbacks.onBlur(this._index);
    }

    _onContentChanged() {
        if (this._callbacks.onChange) {
            this._callbacks.onChange(this._index, this._getSource());
        }
    }

    _onRun() {
        if (this._cellType === 'code') {
            this._executing = true;
            this._executeStart = performance.now();
            this._el.classList.add('executing');
            this._data.outputs = [];
            this._output.showExecuting();
            if (this._callbacks.onRun) {
                this._callbacks.onRun(this._index, this._getSource());
            }
        } else if (this._cellType === 'markdown') {
            this._showMarkdownRendered();
        }
    }

    onExecuteComplete(executionCount) {
        this._executing = false;
        this._el.classList.remove('executing');
        this._executionCount = executionCount;
        this._updateExecutionCount();
        // Clear the "Running..." spinner if no output replaced it
        const executing = this._output.element.querySelector('.output-executing');
        if (executing) executing.remove();
        // Show elapsed time
        if (this._executeStart) {
            const elapsed = (performance.now() - this._executeStart) / 1000;
            this._executeStart = null;
            this._output.showElapsed(elapsed);
        }
    }

    addOutput(output) {
        if (!this._data.outputs) this._data.outputs = [];
        this._data.outputs.push(output);
        this._output.addOutput(output);
    }

    clearOutput() {
        this._data.outputs = [];
        this._output.clear();
    }

    _updateExecutionCount() {
        if (!this._sidebarExecCountEl) return;
        if (this._cellType === 'code') {
            const count = this._executionCount;
            this._sidebarExecCountEl.textContent = count != null ? `[${count}]` : '[ ]';
        } else {
            this._sidebarExecCountEl.textContent = '';
        }
    }

    // --- Lock management ---

    setLock(ownerName, ownerSid, isSelf) {
        this._locked = true;
        this._lockedBy = ownerName;
        if (isSelf) {
            this._el.classList.remove('locked-by-other');
        } else {
            this._el.classList.add('locked-by-other');
            this._lockIndicatorEl.textContent = `Editing: ${ownerName}`;
            this._lockIndicatorEl.classList.remove('hidden');
        }
    }

    clearLock() {
        this._locked = false;
        this._lockedBy = null;
        this._el.classList.remove('locked-by-other');
        this._lockIndicatorEl.classList.add('hidden');
    }

    // --- Markdown ---

    _showMarkdownRendered() {
        if (typeof marked !== 'undefined') {
            this._mdRenderedEl.innerHTML = marked.parse(this._getSource());
        } else {
            this._mdRenderedEl.textContent = this._getSource();
        }
        // Rewrite relative image URLs to use the project files API
        if (_currentProjectId) {
            const base = `api/projects/${encodeURIComponent(_currentProjectId)}/files/`;
            for (const img of this._mdRenderedEl.querySelectorAll('img')) {
                const src = img.getAttribute('src');
                if (src && !src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('/')) {
                    img.src = base + src;
                }
            }
        }
        // Render LaTeX math expressions
        if (typeof renderMathInElement !== 'undefined') {
            renderMathInElement(this._mdRenderedEl, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\(', right: '\\)', display: false },
                    { left: '\\[', right: '\\]', display: true },
                ],
                throwOnError: false,
            });
        }
        this._mdRenderedEl.classList.remove('hidden');
        this._editorAreaEl.classList.add('hidden');
        this._el.classList.add('markdown-rendered');
        this._markdownRendered = true;

        this._mdRenderedEl.addEventListener('dblclick', () => {
            this._hideMarkdownRendered();
            if (this._editorView) this._editorView.focus();
        }, { once: true });
    }

    _hideMarkdownRendered() {
        this._mdRenderedEl.classList.add('hidden');
        this._editorAreaEl.classList.remove('hidden');
        this._el.classList.remove('markdown-rendered');
        this._markdownRendered = false;
    }

    destroy() {
        _allEditors.delete(this);
        if (this._postIt) {
            this._postIt.destroy();
        }
        if (this._gutterObserver) {
            this._gutterObserver.disconnect();
            this._gutterObserver = null;
        }
        if (this._editorView) {
            this._editorView.destroy();
            this._editorView = null;
        }
        if (this._el.parentNode) this._el.parentNode.removeChild(this._el);
    }

    /**
     * Apply a theme to all live editor instances.
     * @param {string} themeName - Key from editorThemes
     */
    static setProjectId(projectId) {
        _currentProjectId = projectId;
    }

    static setTheme(themeName) {
        const theme = editorThemes[themeName] || [];
        localStorage.setItem('notebook-editor-theme', themeName);
        for (const cell of _allEditors) {
            if (cell._editorView) {
                cell._editorView.dispatch({
                    effects: _themeCompartment.reconfigure(theme)
                });
            }
        }
    }

    toJSON() {
        const source = this._getSource();
        const cell = {
            cell_type: this._cellType,
            id: this._data.id,
            metadata: this._data.metadata || {},
            source: source ? source.split('\n').map((line, i, arr) =>
                i < arr.length - 1 ? line + '\n' : line
            ) : []
        };
        if (this._cellType === 'code') {
            cell.outputs = this._data.outputs || [];
            cell.execution_count = this._executionCount;
        }
        return cell;
    }
}
