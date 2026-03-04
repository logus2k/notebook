import { CellOutput } from './CellOutput.js';

/**
 * CellEditor - Manages a single notebook cell with CodeMirror editor.
 * CodeMirror 6 is loaded dynamically from ESM CDN on first use.
 */

import {
    EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
    EditorState,
    defaultKeymap, indentWithTab, history, historyKeymap,
    syntaxHighlighting, defaultHighlightStyle,
    python
} from '../vendor/codemirror/codemirror.bundle.js';

const cmModules = {
    EditorView, keymap, lineNumbers, highlightActiveLine,
    highlightActiveLineGutter, EditorState, defaultKeymap,
    indentWithTab, history, historyKeymap,
    syntaxHighlighting, defaultHighlightStyle,
    python
};

function loadCodeMirror() {
    return cmModules;
}


// Track the currently focused cell so we can blur it when another is focused
let _currentlyFocusedCell = null;

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

        if (cellData.outputs && cellData.outputs.length > 0) {
            this._output.setOutputs(cellData.outputs);
        }

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

    _buildElement() {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.cellType = this._cellType;

        // Click anywhere on the cell to mark it as focused
        cell.addEventListener('mousedown', () => {
            if (!this._focused) {
                this._onFocus();
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
            e.dataTransfer.setData('text/plain', String(this._index));
            e.dataTransfer.effectAllowed = 'move';
            cell.classList.add('dragging');
        });
        dragHandle.addEventListener('dragend', () => {
            cell.classList.remove('dragging');
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

        const spacer = document.createElement('span');
        spacer.className = 'cell-header-spacer';

        const addCodeBtn = document.createElement('button');
        addCodeBtn.className = 'cell-header-btn cell-add-code-btn';
        addCodeBtn.textContent = '+ Code';
        addCodeBtn.title = 'Insert code cell before';
        addCodeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._callbacks.onAddCell) this._callbacks.onAddCell(this._index, 'code');
        });

        const addMdBtn = document.createElement('button');
        addMdBtn.className = 'cell-header-btn cell-add-md-btn';
        addMdBtn.textContent = '+ Markdown';
        addMdBtn.title = 'Insert markdown cell before';
        addMdBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._callbacks.onAddCell) this._callbacks.onAddCell(this._index, 'markdown');
        });

        const lockIndicator = document.createElement('span');
        lockIndicator.className = 'cell-lock-indicator hidden';
        this._lockIndicatorEl = lockIndicator;

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'cell-delete-btn';
        deleteBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#202020" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" fill="#f4a0a0"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
        deleteBtn.title = 'Delete cell';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._callbacks.onDelete) this._callbacks.onDelete(this._index);
        });

        const spacer2 = document.createElement('span');
        spacer2.className = 'cell-header-spacer';

        header.append(typeBadge, spacer, addCodeBtn, addMdBtn, spacer2, lockIndicator, deleteBtn);

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

        const extensions = [
            cm.lineNumbers(),
            cm.highlightActiveLine(),
            cm.highlightActiveLineGutter(),
            cm.history(),
            cm.syntaxHighlighting(cm.defaultHighlightStyle, { fallback: true }),
            cm.keymap.of([
                { key: 'Shift-Enter', run: () => { this._onRun(); return true; } },
                { key: 'Ctrl-Enter', run: () => { this._onRun(); return true; } },
                ...cm.defaultKeymap,
                ...cm.historyKeymap,
                cm.indentWithTab
            ]),
            cm.EditorView.updateListener.of((update) => {
                if (update.docChanged) this._onContentChanged();
                if (update.focusChanged) {
                    if (update.view.hasFocus) this._onFocus();
                    else this._onBlur();
                }
            }),
            cm.EditorView.theme({
                '&': { height: 'auto' },
                '.cm-scroller': { overflow: 'auto' }
            })
        ];

        if (this._cellType === 'code') {
            extensions.push(cm.python());
        }

        this._editorView = new cm.EditorView({
            state: cm.EditorState.create({
                doc: this._source,
                extensions
            }),
            parent: this._editorAreaEl
        });

        if (this._cellType === 'markdown' && this._source.trim()) {
            this._showMarkdownRendered();
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
        this._mdRenderedEl.classList.remove('hidden');
        this._editorAreaEl.classList.add('hidden');
        this._markdownRendered = true;

        this._mdRenderedEl.addEventListener('dblclick', () => {
            this._hideMarkdownRendered();
            if (this._editorView) this._editorView.focus();
        }, { once: true });
    }

    _hideMarkdownRendered() {
        this._mdRenderedEl.classList.add('hidden');
        this._editorAreaEl.classList.remove('hidden');
        this._markdownRendered = false;
    }

    destroy() {
        if (this._editorView) {
            this._editorView.destroy();
            this._editorView = null;
        }
        if (this._el.parentNode) this._el.parentNode.removeChild(this._el);
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
