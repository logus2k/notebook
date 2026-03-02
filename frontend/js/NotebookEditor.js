import { CellEditor } from './CellEditor.js';

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

        this._setupClientListeners();
    }

    get cells() { return this._cells; }
    get projectId() { return this._projectId; }
    get notebookPath() { return this._notebookPath; }

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
    }

    openNotebook(projectId, notebookPath, userName) {
        this._projectId = projectId;
        this._notebookPath = notebookPath;
        this._client.openNotebook(projectId, notebookPath, userName);
    }

    closeNotebook() {
        if (this._projectId && this._notebookPath) {
            this._client.closeNotebook(this._projectId, this._notebookPath);
        }
        this._clear();
    }

    save() {
        if (!this._notebook) return;
        const content = this._serializeNotebook();
        this._client.saveNotebook(content);
    }

    runAll() {
        for (let i = 0; i < this._cells.length; i++) {
            const cell = this._cells[i];
            if (cell.cellType === 'code') {
                this._client.executeCell(i, cell.source);
                cell._onRun();
            }
        }
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
            this._wrapperEl.appendChild(this._createAddCellButton(i + 1));
        }

        if (this._notebook.cells.length === 0) {
            this._wrapperEl.appendChild(this._createAddCellButton(0));
        }

        this._container.appendChild(this._wrapperEl);
    }

    _clear() {
        for (const cell of this._cells) {
            cell.destroy();
        }
        this._cells = [];
        this._container.innerHTML = '';
        this._wrapperEl = null;
    }

    _createCellEditor(cellData, index) {
        return new CellEditor(cellData, index, {
            onFocus: (idx) => this._onCellFocus(idx),
            onBlur: (idx) => this._onCellBlur(idx),
            onChange: (idx, source) => this._onCellChange(idx, source),
            onRun: (idx, code) => this._onCellRun(idx, code),
            onDelete: (idx) => this._onCellDelete(idx)
        });
    }

    _createAddCellButton(insertIndex) {
        const container = document.createElement('div');
        container.className = 'add-cell-container';

        const codeBtn = document.createElement('button');
        codeBtn.className = 'add-cell-button';
        codeBtn.textContent = '+ Code';
        codeBtn.addEventListener('click', () => this._addCell(insertIndex, 'code'));

        const mdBtn = document.createElement('button');
        mdBtn.className = 'add-cell-button';
        mdBtn.textContent = '+ Markdown';
        mdBtn.addEventListener('click', () => this._addCell(insertIndex, 'markdown'));

        container.append(codeBtn, mdBtn);
        return container;
    }

    // --- Local cell operations ---

    _addCell(index, cellType = 'code') {
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

        // Insert into DOM
        if (this._wrapperEl) {
            const addBtn = this._createAddCellButton(index + 1);
            const refChild = this._wrapperEl.children[index * 2] || null;
            this._wrapperEl.insertBefore(cellEditor.element, refChild);
            this._wrapperEl.insertBefore(addBtn, cellEditor.element.nextSibling);
        }

        // Broadcast
        this._client.addCell(index, cellType, cellId);
    }

    _onCellDelete(index) {
        if (this._cells.length <= 1) return; // Keep at least one cell

        const cell = this._cells[index];
        cell.destroy();
        this._cells.splice(index, 1);

        // Remove cell element and its following add-button from DOM
        if (this._wrapperEl) {
            const cellEl = this._wrapperEl.children[index * 2];
            const addBtnEl = this._wrapperEl.children[index * 2 + 1];
            if (cellEl) cellEl.remove();
            if (addBtnEl) addBtnEl.remove();
        }

        this._reindexCells();
        this._client.deleteCell(index);
    }

    _reindexCells() {
        for (let i = 0; i < this._cells.length; i++) {
            this._cells[i].index = i;
        }
    }

    // --- Cell callbacks ---

    _onCellFocus(index) {
        this._client.lockCell(index);
    }

    _onCellBlur(index) {
        this._client.unlockCell(index);
    }

    _onCellChange(index, source) {
        // Debounce remote updates
        clearTimeout(this._debounceTimers[index]);
        this._debounceTimers[index] = setTimeout(() => {
            this._client.updateCell(index, source);
        }, 300);
    }

    _onCellRun(index, code) {
        this._client.executeCell(index, code);
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
            const refChild = this._wrapperEl.children[index * 2] || null;
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
                const cellEl = this._wrapperEl.children[index * 2];
                const addBtnEl = this._wrapperEl.children[index * 2 + 1];
                if (cellEl) cellEl.remove();
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

        // Re-render for simplicity on move
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

    _onNotebookSaved(data) {
        if (data.success) {
            console.log('Notebook saved');
        } else {
            console.error('Save failed:', data.error);
        }
    }

    // --- Serialization ---

    _serializeNotebook() {
        const nb = JSON.parse(JSON.stringify(this._notebook));
        nb.cells = this._cells.map(c => c.toJSON());
        return nb;
    }
}
