import { CellOutput } from './CellOutput.js';

/**
 * CellEditor - Manages a single notebook cell with CodeMirror editor.
 * CodeMirror 6 is loaded dynamically from ESM CDN on first use.
 */

let cmModules = null;

async function loadCodeMirror() {
    if (cmModules) return cmModules;

    const [
        { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter },
        { EditorState },
        { defaultKeymap, indentWithTab, history, historyKeymap },
        { python },
        { oneDark }
    ] = await Promise.all([
        import('https://esm.sh/@codemirror/view@6.35.0'),
        import('https://esm.sh/@codemirror/state@6.5.0'),
        import('https://esm.sh/@codemirror/commands@6.7.1'),
        import('https://esm.sh/@codemirror/lang-python@6.1.6'),
        import('https://esm.sh/@codemirror/theme-one-dark@6.1.2')
    ]);

    cmModules = {
        EditorView, keymap, lineNumbers, highlightActiveLine,
        highlightActiveLineGutter, EditorState, defaultKeymap,
        indentWithTab, history, historyKeymap, python, oneDark
    };
    return cmModules;
}


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

        // Header
        const header = document.createElement('div');
        header.className = 'cell-header';

        const typeBadge = document.createElement('span');
        typeBadge.className = `cell-type-badge ${this._cellType}`;
        typeBadge.textContent = this._cellType;

        const execCount = document.createElement('span');
        execCount.className = 'cell-execution-count';
        this._execCountEl = execCount;
        this._updateExecutionCount();

        const spacer = document.createElement('span');
        spacer.className = 'cell-header-spacer';

        const lockIndicator = document.createElement('span');
        lockIndicator.className = 'cell-lock-indicator hidden';
        this._lockIndicatorEl = lockIndicator;

        const actions = document.createElement('div');
        actions.className = 'cell-actions';

        if (this._cellType === 'code') {
            const runBtn = document.createElement('button');
            runBtn.className = 'run-btn';
            runBtn.textContent = 'Run';
            runBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._onRun();
            });
            actions.appendChild(runBtn);
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._callbacks.onDelete) {
                this._callbacks.onDelete(this._index);
            }
        });
        actions.appendChild(deleteBtn);

        header.append(typeBadge, execCount, spacer, lockIndicator, actions);

        // Editor area
        const editorArea = document.createElement('div');
        editorArea.className = 'cell-editor';
        this._editorAreaEl = editorArea;

        // Markdown rendered view
        const mdRendered = document.createElement('div');
        mdRendered.className = 'cell-markdown-rendered hidden';
        this._mdRenderedEl = mdRendered;

        cell.append(header, editorArea, mdRendered);

        if (this._cellType === 'code') {
            cell.appendChild(this._output.element);
        }

        return cell;
    }

    async _initEditor() {
        const cm = await loadCodeMirror();

        const extensions = [
            cm.lineNumbers(),
            cm.highlightActiveLine(),
            cm.highlightActiveLineGutter(),
            cm.history(),
            cm.keymap.of([
                ...cm.defaultKeymap,
                ...cm.historyKeymap,
                cm.indentWithTab,
                { key: 'Shift-Enter', run: () => { this._onRun(); return true; } }
            ]),
            cm.oneDark,
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
        this._focused = true;
        this._el.classList.add('focused');
        if (this._cellType === 'markdown') this._hideMarkdownRendered();
        if (this._callbacks.onFocus) this._callbacks.onFocus(this._index);
    }

    _onBlur() {
        this._focused = false;
        this._el.classList.remove('focused');
        if (this._cellType === 'markdown' && this._getSource().trim()) {
            this._showMarkdownRendered();
        }
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
            this._el.classList.add('executing');
            this._output.showExecuting();
            if (this._callbacks.onRun) {
                this._callbacks.onRun(this._index, this._getSource());
            }
        }
    }

    onExecuteComplete(executionCount) {
        this._executing = false;
        this._el.classList.remove('executing');
        this._executionCount = executionCount;
        this._updateExecutionCount();
    }

    addOutput(output) {
        this._output.addOutput(output);
    }

    clearOutput() {
        this._output.clear();
    }

    _updateExecutionCount() {
        if (!this._execCountEl) return;
        if (this._cellType === 'code') {
            const count = this._executionCount;
            this._execCountEl.textContent = count != null ? `[${count}]` : '[ ]';
        } else {
            this._execCountEl.textContent = '';
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

        this._mdRenderedEl.addEventListener('click', () => {
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
