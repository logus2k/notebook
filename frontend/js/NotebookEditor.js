import { CellEditor } from './CellEditor.js';
import { ImageActions } from './ImageActions.js';
import { NotebookDragDrop } from './NotebookDragDrop.js';
import { NotebookSelection } from './NotebookSelection.js';

/**
 * NotebookEditor - Main notebook container, manages cells array.
 */
export class NotebookEditor {
    /**
     * @param {HTMLElement} containerEl
     * @param {import('./KernelClient.js').KernelClient} kernelClient
     */
    constructor(containerEl, kernelClient) {
        this._container = containerEl;
        this._client = kernelClient;
        this._cells = [];
        this._notebook = null;
        this._projectId = null;
        this._notebookPath = null;
        this._wrapperEl = null;
        this._debounceTimers = {};

        // Multi-cell selection state
        this._selectedIndices = new Set();
        this._anchorIndex = null;
        this._clipboard = null; // { cells: [...cellJSON], isCut: bool }

        // Notebook-level undo stack (snapshots)
        this._undoStack = [];
        this._maxUndoSize = 20;

        // Sequential execution queue (for Run All / Run Above / Run Below)
        this._execQueue = [];
        this._execRunning = false;

        // External change listener
        this._onChangeCallback = null;

        // Callback to ensure kernel is running before execution (returns Promise)
        this._ensureKernelCallback = null;

        // Delegate modules
        this.selection = new NotebookSelection(this);
        this.dragDrop = new NotebookDragDrop(this);
        new ImageActions(this._container);

        this._setupClientListeners();
        this._setupContainerListeners();
    }

    get cells() { return this._cells; }
    get projectId() { return this._projectId; }
    get notebookPath() { return this._notebookPath; }
    set onCellsChanged(fn) { this._onChangeCallback = fn; }
    set onEnsureKernel(fn) { this._ensureKernelCallback = fn; }

    _setupContainerListeners() {
        // Open links in new tab
        this._container.addEventListener('click', (e) => {
            const a = e.target.closest('a[href]');
            if (a && this._container.contains(a)) {
                e.preventDefault();
                window.open(a.href, '_blank', 'noopener');
            }
        });

        this._container.addEventListener('mousedown', (e) => {
            if (!e.target.closest('.cell') && !e.target.closest('.add-cell-container')
                && !e.target.closest('.welcome-screen') && !e.target.closest('.project-browser')) {
                e.preventDefault();
                const active = document.activeElement;
                if (active && active.closest('.cell')) active.blur();
            }
        });

        document.addEventListener('mousedown', (e) => {
            if (!this._container.contains(e.target)
                && !e.target.closest('#toolbar') && !e.target.closest('#info-bar')
                && !e.target.closest('.jsPanel') && !e.target.closest('#right-panel')) {
                e.preventDefault();
                const active = document.activeElement;
                if (active && active.closest('.cell')) active.blur();
            }
        });
    }

    _setupClientListeners() {
        this._client.on('notebook:state', (data) => this._onNotebookState(data));
        this._client.on('notebook:saved', (data) => this._onNotebookSaved(data));
        this._client.on('cell:updated', (data) => this._onRemoteCellUpdate(data));
        this._client.on('cell:added', (data) => this._onRemoteCellAdd(data));
        this._client.on('cell:deleted', (data) => this._onRemoteCellDelete(data));
        this._client.on('cell:moved', (data) => this._onRemoteCellMove(data));
        this._client.on('cell:output', (data) => this._onCellOutput(data));
        this._client.on('cell:execute_complete', (data) => this._onExecuteComplete(data));
        this._client.on('cell:lock_changed', (data) => this._onLockChanged(data));
        this._client.on('error', (data) => this._onError(data));
    }

    // --- Public API ---

    openNotebook(projectId, notebookPath, userName) {
        this._projectId = projectId;
        this._notebookPath = notebookPath;
        CellEditor.setProjectId(projectId);
        this._client.openNotebook(projectId, notebookPath, userName);
    }

    closeNotebook() {
        if (this._projectId && this._notebookPath) {
            this._client.closeNotebook(this._projectId, this._notebookPath);
        }
        this._clear();
    }

    save() {
        if (!this._notebook) {
            this._showSaveIndicator('No notebook open', true);
            return;
        }
        try {
            const content = this._serializeNotebook();
            this._client.saveNotebook(content);
        } catch (err) {
            this._showSaveIndicator('Save failed', true);
            console.error('Save serialization error:', err);
        }
    }

    export() {
        if (!this._notebook) return;
        const content = this._serializeNotebook();
        const json = JSON.stringify(content, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this._notebookPath || 'notebook.ipynb';
        a.click();
        URL.revokeObjectURL(url);
    }

    // --- Execution queue ---

    runAll() {
        this._runSequential(0, this._cells.length);
    }

    runAbove(index) {
        this._runSequential(0, index);
    }

    runBelow(index) {
        this._runSequential(index, this._cells.length);
    }

    clearAllOutputs() {
        for (const cell of this._cells) {
            if (cell.cellType === 'code') {
                cell.clearOutput();
            }
        }
    }

    async _runSequential(from, to) {
        const indices = [];
        for (let i = from; i < to; i++) {
            if (this._cells[i]?.cellType === 'code') {
                indices.push(i);
            }
        }
        if (!indices.length) return;
        if (this._ensureKernelCallback) {
            const ok = await this._ensureKernelCallback();
            if (!ok) return;
        }
        this._execQueue = indices;
        this._execRunning = true;
        this._execNext();
    }

    _execNext() {
        if (!this._execQueue.length) {
            this._execRunning = false;
            return;
        }
        const idx = this._execQueue.shift();
        const cell = this._cells[idx];
        if (cell) {
            cell._onRun();
        } else {
            this._execNext();
        }
    }

    _cancelExecQueue() {
        this._execQueue = [];
        this._execRunning = false;
    }

    // --- Rendering ---

    _onNotebookState(data) {
        this._notebook = data.notebook;
        this._render();

        const locks = data.locks || {};
        for (const [idx, lock] of Object.entries(locks)) {
            const cell = this._cells[parseInt(idx)];
            if (cell) {
                const isSelf = lock.owner_sid === this._client.sid;
                cell.setLock(lock.owner_name, lock.owner_sid, isSelf);
            }
        }
        if (this._onChangeCallback) this._onChangeCallback();
    }

    _render() {
        this._clear();
        if (!this._notebook || !this._notebook.cells) return;

        this._wrapperEl = document.createElement('div');
        this._wrapperEl.className = 'notebook';

        for (let i = 0; i < this._notebook.cells.length; i++) {
            const cellData = this._notebook.cells[i];

            if (i === 0) {
                this._wrapperEl.appendChild(this._createAddCellButton(i));
            }

            const cellEditor = this._createCellEditor(cellData, i);
            this._cells.push(cellEditor);
            this._wrapperEl.appendChild(cellEditor.element);
            const addBtn = this._createAddCellButton(i + 1);
            if (i === this._notebook.cells.length - 1) {
                addBtn.classList.add('add-cell-last');
            }
            this._wrapperEl.appendChild(addBtn);
        }

        if (this._notebook.cells.length === 0) {
            const addBtn = this._createAddCellButton(0);
            addBtn.classList.add('add-cell-last');
            this._wrapperEl.appendChild(addBtn);
        }

        this._container.appendChild(this._wrapperEl);
        this.dragDrop.setup();
    }

    _clear() {
        for (const cell of this._cells) {
            cell.destroy();
        }
        this._cells = [];
        this._selectedIndices.clear();
        this._container.innerHTML = '';
        this._wrapperEl = null;
    }

    _createCellEditor(cellData, index) {
        return new CellEditor(cellData, index, {
            onFocus: () => {},
            onBlur: () => {},
            onChange: (idx, source) => this._onCellChange(idx, source),
            onRun: (idx, code) => this._onCellRun(idx, code),
            onInterrupt: () => this._client.interruptKernel(),
            onDelete: (idx) => this._onCellDelete(idx),
            onAddCell: (idx, type) => this._addCell(idx, type),
            onRunAbove: (idx) => this.runAbove(idx),
            onRunBelow: (idx) => this.runBelow(idx),
            onCellKeydown: (idx, e) => this.selection.onCellKeydown(idx, e),
            onCellMousedown: (idx, e) => this.selection.onCellMousedown(idx, e),
            onCellClick: (idx, e) => this.selection.onCellClick(idx, e),
            onCellDragStart: (idx, e) => this.dragDrop.onDragStart(idx, e),
            onCellDragEnd: () => this.dragDrop.onDragEnd(),
            onEditorFocus: (idx) => this._client.lockCell(idx),
            onEditorBlur: (idx) => this._client.unlockCell(idx)
        });
    }

    _createAddCellButton(insertIndex) {
        const container = document.createElement('div');
        container.className = 'add-cell-container';

        const codeBtn = document.createElement('button');
        codeBtn.className = 'add-cell-button add-cell-code';
        codeBtn.textContent = '+ code';
        codeBtn.addEventListener('click', () => this._addCell(insertIndex, 'code'));

        const mdBtn = document.createElement('button');
        mdBtn.className = 'add-cell-button add-cell-markdown';
        mdBtn.textContent = '+ markdown';
        mdBtn.addEventListener('click', () => this._addCell(insertIndex, 'markdown'));

        const center = document.createElement('div');
        center.className = 'add-cell-buttons';
        center.append(codeBtn, mdBtn);
        container.append(center);
        return container;
    }

    // --- Local cell operations ---

    _addCell(index, cellType = 'code', { skipUndo = false } = {}) {
        if (!skipUndo) this._pushUndo();

        const cellId = Math.random().toString(36).substring(2, 10);
        const cellData = {
            cell_type: cellType,
            id: cellId,
            metadata: {},
            source: [],
            outputs: [],
            execution_count: null
        };

        const cellEditor = this._createCellEditor(cellData, index);
        this._cells.splice(index, 0, cellEditor);
        this._reindexCells();

        if (this._wrapperEl) {
            const addBtn = this._createAddCellButton(index + 1);
            const refChild = this._wrapperEl.children[index * 2 + 1] || null;
            this._wrapperEl.insertBefore(cellEditor.element, refChild);
            this._wrapperEl.insertBefore(addBtn, cellEditor.element.nextSibling);
            this._updateAddCellLast();
        }

        this._client.addCell(index, cellType, cellId);
        if (this._onChangeCallback) this._onChangeCallback();
    }

    _onCellDelete(index) {
        this._pushUndo();

        const isLastCell = this._cells.length <= 1;
        const cell = this._cells[index];
        cell.destroy();
        this._cells.splice(index, 1);

        if (this._wrapperEl) {
            const addBtnEl = this._wrapperEl.children[index * 2 + 1];
            if (addBtnEl) addBtnEl.remove();
        }

        this._reindexCells();
        this._updateAddCellLast();
        this._client.deleteCell(index);
        if (this._onChangeCallback) this._onChangeCallback();

        if (isLastCell) {
            this._addCell(0, 'code', { skipUndo: true });
            this.selection.selectCell(0);
            this._cells[0].focusCell();
        }
    }

    _reindexCells() {
        for (let i = 0; i < this._cells.length; i++) {
            this._cells[i].index = i;
        }
    }

    _updateAddCellLast() {
        if (!this._wrapperEl) return;
        const addBtns = this._wrapperEl.querySelectorAll('.add-cell-container');
        addBtns.forEach(btn => btn.classList.remove('add-cell-last'));
        if (addBtns.length > 0) {
            addBtns[addBtns.length - 1].classList.add('add-cell-last');
        }
    }

    // --- Cell callbacks ---

    _onCellChange(index, source) {
        clearTimeout(this._debounceTimers[index]);
        this._debounceTimers[index] = setTimeout(() => {
            this._client.updateCell(index, source);
        }, 300);
        if (this._onChangeCallback) this._onChangeCallback();
    }

    async _onCellRun(index, code) {
        if (this._ensureKernelCallback) {
            const ok = await this._ensureKernelCallback();
            if (!ok) return;
        }
        this._client.executeCell(index, code);
    }

    // --- Undo ---

    _pushUndo() {
        this._undoStack.push(this._cells.map(c => c.toJSON()));
        if (this._undoStack.length > this._maxUndoSize) {
            this._undoStack.shift();
        }
    }

    _undo() {
        if (this._undoStack.length === 0) return;
        const snapshot = this._undoStack.pop();

        for (let i = this._cells.length - 1; i >= 0; i--) {
            this._client.deleteCell(i);
        }

        this._notebook.cells = snapshot;
        this._cells = [];
        this._render();

        for (let i = 0; i < snapshot.length; i++) {
            const cell = snapshot[i];
            this._client.addCell(i, cell.cell_type, cell.id);
            const src = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
            if (src) {
                const idx = i;
                setTimeout(() => this._client.updateCell(idx, src), 50);
            }
        }

        if (this._cells.length > 0) {
            this.selection.selectCell(0);
            this._cells[0].focusCell();
        }
    }

    // --- Remote events ---

    _onRemoteCellUpdate(data) {
        const cell = this._cells[data.cell_index];
        if (cell) {
            cell.setSource(data.source);
        }
    }

    _onRemoteCellAdd(data) {
        const cellData = {
            cell_type: data.cell_type,
            id: data.cell_id,
            metadata: {},
            source: [],
            outputs: [],
            execution_count: null
        };
        const index = data.cell_index;
        const cellEditor = this._createCellEditor(cellData, index);
        this._cells.splice(index, 0, cellEditor);
        this._reindexCells();

        if (this._wrapperEl) {
            const addBtn = this._createAddCellButton(index + 1);
            const refChild = this._wrapperEl.children[index * 2 + 1] || null;
            this._wrapperEl.insertBefore(cellEditor.element, refChild);
            this._wrapperEl.insertBefore(addBtn, cellEditor.element.nextSibling);
        }
    }

    _onRemoteCellDelete(data) {
        const index = data.cell_index;
        if (index >= 0 && index < this._cells.length) {
            const cell = this._cells[index];
            cell.destroy();
            this._cells.splice(index, 1);

            if (this._wrapperEl) {
                const addBtnEl = this._wrapperEl.children[index * 2 + 1];
                if (addBtnEl) addBtnEl.remove();
            }
            this._reindexCells();
        }
    }

    _onRemoteCellMove(data) {
        const { from_index, to_index } = data;
        if (from_index < 0 || from_index >= this._cells.length) return;
        if (to_index < 0 || to_index >= this._cells.length) return;

        const [cell] = this._cells.splice(from_index, 1);
        this._cells.splice(to_index, 0, cell);
        this._reindexCells();

        this._notebook.cells = this._cells.map(c => c.toJSON());
        this._render();
    }

    _onCellOutput(data) {
        const cell = this._cells[data.cell_index];
        if (cell) {
            cell.addOutput(data.output);
        }
    }

    _onExecuteComplete(data) {
        const cell = this._cells[data.cell_index];
        if (cell) {
            cell.onExecuteComplete(data.execution_count);

            if (this._execRunning) {
                const hadError = cell._data.outputs?.some(
                    o => o.output_type === 'error'
                );
                if (hadError) {
                    this._cancelExecQueue();
                } else {
                    this._execNext();
                }
            }
        }
    }

    _onLockChanged(data) {
        const cell = this._cells[data.cell_index];
        if (!cell) return;
        if (data.locked) {
            const isSelf = data.owner_sid === this._client.sid;
            cell.setLock(data.owner, data.owner_sid, isSelf);
        } else {
            cell.clearLock();
        }
    }

    _onError(data) {
        if (data.code === 'INVALID_REQUEST') {
            this._showSaveIndicator(data.message || 'Request failed', true);
            return;
        }

        for (const cell of this._cells) {
            if (cell._executing) {
                cell.addOutput({
                    output_type: 'error',
                    ename: data.code || 'Error',
                    evalue: data.message || 'Unknown error',
                    traceback: []
                });
                cell.onExecuteComplete(null);
            }
        }
    }

    _onNotebookSaved(data) {
        if (data.success) {
            this._showSaveIndicator('Saved');
        } else {
            this._showSaveIndicator('Save failed', true);
            console.error('Save failed:', data.error);
        }
    }

    _showSaveIndicator(message, isError = false) {
        const existing = document.querySelector('.save-indicator');
        if (existing) existing.remove();

        const el = document.createElement('div');
        el.className = 'save-indicator';
        el.textContent = message;
        el.style.cssText = `
            position: fixed; top: 48px; right: 16px; z-index: 1000;
            padding: 6px 14px; border-radius: 6px; font-size: 13px;
            font-family: var(--font-sans); animation: fadeInOut 2s ease forwards;
            background: ${isError ? 'var(--accent-red)' : 'var(--accent-green)'};
            color: #fff;
        `;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 2000);
    }

    // --- Serialization ---

    _serializeNotebook() {
        const nb = JSON.parse(JSON.stringify(this._notebook));
        nb.cells = this._cells.map(c => c.toJSON());
        return nb;
    }
}
