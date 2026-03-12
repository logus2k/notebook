import { CellEditor } from './CellEditor.js';
import { POST_IT_ICON_CELL } from './CellPostIt.js';
import { ImageActions } from './ImageActions.js';
import { NotebookDragDrop } from './NotebookDragDrop.js';
import { NotebookSelection } from './NotebookSelection.js';
import { notify } from './Notify.js';

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

        // Top bar inside the notebook with project/notebook breadcrumb
        this._topBar = document.getElementById('notebook-top-bar')
            || this._createTopBar();
        this._secondBar = this._createSecondBar();
        this._buildTopBarContent();

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

        // Loading state
        this._onLoadCallback = null;
        this._loadingOverlay = null;

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
    set onLoad(fn) { this._onLoadCallback = fn; }

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
                && !e.target.closest('.jsPanel') && !e.target.closest('#right-panel')
                && !e.target.closest('#service-tab-container') && !e.target.closest('#sidebar-panel')) {
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
        this._showLoadingOverlay();
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
            notify.error('No notebook open');
            return;
        }
        try {
            const content = this._serializeNotebook();
            this._client.saveNotebook(content);
        } catch (err) {
            notify.error('Save failed');
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

    async _onNotebookState(data) {
        this._notebook = data.notebook;
        await this._render();

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

    async _render() {
        this._clear();
        if (!this._notebook || !this._notebook.cells) {
            this._hideLoadingOverlay();
            return;
        }

        const cells = this._notebook.cells;
        const total = cells.length;

        this._wrapperEl = document.createElement('div');
        this._wrapperEl.className = 'notebook';
        this._wrapperEl.appendChild(this._topBar);
        this._wrapperEl.appendChild(this._secondBar);

        if (total === 0) {
            const addBtn = this._createAddCellButton();
            addBtn.classList.add('add-cell-last');
            this._wrapperEl.appendChild(addBtn);
            this._container.appendChild(this._wrapperEl);
            this.dragDrop.setup();
            this._hideLoadingOverlay();
            this._onRenderComplete();
            return;
        }

        // Batch size: render N cells per frame to balance progress updates vs speed
        const BATCH = Math.max(1, Math.ceil(total / 20));

        for (let i = 0; i < total; i++) {
            if (i === 0) {
                this._wrapperEl.appendChild(this._createAddCellButton());
            }

            const cellEditor = this._createCellEditor(cells[i], i);
            this._cells.push(cellEditor);
            this._wrapperEl.appendChild(cellEditor.element);
            const addBtn = this._createAddCellButton();
            if (i === total - 1) addBtn.classList.add('add-cell-last');
            this._wrapperEl.appendChild(addBtn);

            // Yield to the browser every BATCH cells to update progress
            if ((i + 1) % BATCH === 0 && i < total - 1) {
                this._updateLoadingProgress(Math.round(((i + 1) / total) * 100));
                await new Promise(r => requestAnimationFrame(r));
            }
        }

        this._container.appendChild(this._wrapperEl);
        this.dragDrop.setup();
        this._hideLoadingOverlay();
        this._onRenderComplete();
    }

    _showLoadingOverlay() {
        if (this._loadingOverlay) this._loadingOverlay.remove();
        const overlay = document.createElement('div');
        overlay.className = 'notebook-loading-overlay';
        overlay.innerHTML = `
            <div class="notebook-loading-content">
                <div class="notebook-loading-label">Loading notebook...</div>
                <div class="notebook-loading-bar-track">
                    <div class="notebook-loading-bar-fill"></div>
                </div>
                <div class="notebook-loading-percent">0%</div>
            </div>`;
        this._container.appendChild(overlay);
        this._loadingOverlay = overlay;
    }

    _updateLoadingProgress(pct) {
        if (!this._loadingOverlay) return;
        const fill = this._loadingOverlay.querySelector('.notebook-loading-bar-fill');
        const label = this._loadingOverlay.querySelector('.notebook-loading-percent');
        if (fill) fill.style.width = `${pct}%`;
        if (label) label.textContent = `${pct}%`;
    }

    _hideLoadingOverlay() {
        if (this._loadingOverlay) {
            this._loadingOverlay.remove();
            this._loadingOverlay = null;
        }
    }

    _onRenderComplete() {
        notify.success('Notebook loaded');
        if (this._onLoadCallback) this._onLoadCallback();
    }

    _createTopBar() {
        const bar = document.createElement('div');
        bar.id = 'notebook-top-bar';
        return bar;
    }

    _createSecondBar() {
        const S = 'stroke="#555" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
        const ICONS = {
            runAll:    `<svg width="12" height="12" viewBox="0 0 24 24" fill="#555" ${S}><polygon points="6,3 20,12 6,21"/></svg>`,
            restart:   `<svg width="12" height="12" viewBox="0 2 24 24" fill="none" ${S}><polygon points="5,4 5,10 11,10" fill="#555"/><path d="M3.5 16a9 9 0 1 0 6-10" stroke-width="2.8"/></svg>`,
            stop:      `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" ${S}><path d="M6.34 6.34a9 9 0 1 0 11.32 0" stroke-width="2.8"/><line x1="12" y1="2" x2="12" y2="12" stroke-width="2.8"/></svg>`,
            interrupt: `<svg width="12" height="12" viewBox="0 0 24 24" fill="#555" ${S}><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`,
            clearAll:  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" ${S}><path d="M3 6h16" stroke-width="2.2"/><path d="M3 12h16" stroke-width="2.2"/><path d="M3 18h16" stroke-width="2.2"/><polygon points="19,1 23,6 19,11" fill="#555" stroke="none"/></svg>`,
            upload:    `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" ${S}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
            download:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" ${S}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
        };

        const bar = document.createElement('div');
        bar.id = 'notebook-second-bar';

        const mkBtn = (icon, label, onClick, cls) => {
            const btn = document.createElement('button');
            btn.className = cls || 'info-bar-text-btn';
            btn.innerHTML = icon + `<span class="info-bar-btn-label">${label}</span>`;
            btn.title = label;
            btn.addEventListener('click', onClick);
            return btn;
        };

        // Left: Save + Post-it
        const leftGroup = document.createElement('div');
        leftGroup.className = 'second-bar-left';

        const FS = 'stroke="#555" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
        this._secondBarSaveBtn = document.createElement('button');
        this._secondBarSaveBtn.className = 'info-bar-text-btn';
        this._secondBarSaveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ${FS}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" fill="#4caf50"/><polygon points="17 21 17 13 7 13 7 21" fill="#fff2bc"/><polyline points="7 3 7 8 15 8" fill="#cecece"/></svg>`;
        this._secondBarSaveBtn.title = 'Save';
        this._secondBarSaveBtn.addEventListener('click', () => this._onSave?.());
        leftGroup.appendChild(this._secondBarSaveBtn);

        this._secondBarPostItBtn = document.createElement('button');
        this._secondBarPostItBtn.className = 'info-bar-text-btn';
        this._secondBarPostItBtn.innerHTML = POST_IT_ICON_CELL;
        this._secondBarPostItBtn.title = 'Notes';
        this._secondBarPostItBtn.style.position = 'relative';
        this._secondBarPostItBtn.addEventListener('click', () => this._onPostItToggle?.());
        this._secondBarNotesBadge = document.createElement('span');
        this._secondBarNotesBadge.className = 'toolbar-notes-badge';
        this._secondBarPostItBtn.appendChild(this._secondBarNotesBadge);
        leftGroup.appendChild(this._secondBarPostItBtn);

        bar.appendChild(leftGroup);

        // Center: kernel controls
        const controls = document.createElement('div');
        controls.className = 'info-bar-controls';
        controls.appendChild(mkBtn(ICONS.runAll, 'Run All', () => this.runAll()));
        controls.appendChild(mkBtn(ICONS.restart, 'Restart', () => this._client.restartKernel()));
        controls.appendChild(mkBtn(ICONS.stop, 'Stop', () => this._client.stopKernel()));
        controls.appendChild(mkBtn(ICONS.interrupt, 'Interrupt', () => this._client.interruptKernel()));
        controls.appendChild(mkBtn(ICONS.clearAll, 'Clear All Outputs', () => this.clearAllOutputs()));
        bar.appendChild(controls);

        // Right: kernel selector
        const rightGroup = document.createElement('div');
        rightGroup.className = 'second-bar-right';

        this._kernelItem = document.createElement('div');
        this._kernelItem.className = 'info-bar-kernel';
        this._kernelItem.addEventListener('click', () => {
            if (this._onKernelClick) this._onKernelClick();
        });

        this._kernelDot = document.createElement('span');
        this._kernelDot.className = 'kernel-status-dot dead';

        this._kernelLabel = document.createElement('span');
        this._kernelLabel.className = 'info-bar-label';
        this._kernelLabel.textContent = 'Select Kernel';

        this._kernelItem.append(this._kernelDot, this._kernelLabel);
        rightGroup.appendChild(this._kernelItem);
        bar.appendChild(rightGroup);

        return bar;
    }

    setOnPostItToggle(cb) { this._onPostItToggle = cb; }
    setOnSave(cb) { this._onSave = cb; }

    updateNotesBadge(count) {
        if (!this._secondBarNotesBadge) return;
        this._secondBarNotesBadge.textContent = count || '';
        this._secondBarNotesBadge.style.display = count ? 'inline-block' : 'none';
    }

    _buildTopBarContent() {
        this._topBar.innerHTML = '';
        this._venvName = null;
        this._displayName = null;
        this._kernelStatus = 'dead';

        // Left: breadcrumb
        this._projectLabel = document.createElement('span');
        this._projectLabel.className = 'info-bar-text';
        this._projectLabel.textContent = '';

        this._topBarSep = document.createElement('span');
        this._topBarSep.className = 'info-bar-separator';
        this._topBarSep.textContent = '|';
        this._topBarSep.style.display = 'none';

        this._notebookLabel = document.createElement('span');
        this._notebookLabel.className = 'info-bar-text';
        this._notebookLabel.textContent = '';

        this._topBar.append(this._projectLabel, this._topBarSep, this._notebookLabel);

        // Listen for kernel status
        this._client.on('kernel:status', (data) => this._setKernelStatus(data.status));
    }

    setOnKernelClick(cb) {
        this._onKernelClick = cb;
    }

    setProject(name) {
        this._projectLabel.textContent = name || '';
        this._updateTopBarSep();
    }

    setNotebook(name) {
        this._notebookLabel.textContent = name || '';
        this._updateTopBarSep();
    }

    setVenv(name, displayName) {
        this._venvName = name;
        this._displayName = displayName;
        if (name && this._kernelStatus === 'dead') {
            this._kernelDot.className = 'kernel-status-dot standby';
        }
        this._updateKernelLabel();
    }

    _setKernelStatus(status) {
        const prev = this._kernelStatus;
        this._kernelStatus = status;
        this._kernelDot.className = `kernel-status-dot ${status}`;
        this._updateKernelLabel();
        if (status === 'idle' && prev === 'starting') {
            this._flashKernelStatus('Ready');
            const label = this._venvName
                ? this._displayName ? `${this._venvName} (${this._displayName})` : this._venvName
                : 'Kernel';
            notify.success(`${label} started`);
        } else if (status === 'dead' && prev === 'starting') {
            const label = this._venvName
                ? this._displayName ? `${this._venvName} (${this._displayName})` : this._venvName
                : 'Kernel';
            notify.error(`${label} failed to start`);
        }
    }

    _updateKernelLabel() {
        const statusText = { starting: 'Starting', dead: 'Stopped' };
        const suffix = statusText[this._kernelStatus] || '';
        if (this._venvName) {
            const info = suffix ? `(${suffix})` : this._displayName ? `(${this._displayName})` : '';
            this._kernelLabel.textContent = info ? `${this._venvName} ${info}` : this._venvName;
        } else {
            this._kernelLabel.textContent = 'Select Kernel';
        }
    }

    _flashKernelStatus(text) {
        if (this._flashTimer) clearTimeout(this._flashTimer);
        this._kernelLabel.textContent = `${this._venvName || 'Kernel'} (${text})`;
        this._flashTimer = setTimeout(() => {
            this._flashTimer = null;
            this._updateKernelLabel();
        }, 2000);
    }

    _updateTopBarSep() {
        const hasProject = !!this._projectLabel.textContent;
        const hasNotebook = !!this._notebookLabel.textContent;
        this._topBarSep.style.display = (hasProject && hasNotebook) ? '' : 'none';
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

    _createAddCellButton() {
        const container = document.createElement('div');
        container.className = 'add-cell-container';

        const getIndex = () => {
            const addBtns = this._wrapperEl.querySelectorAll('.add-cell-container');
            return [...addBtns].indexOf(container);
        };

        const codeBtn = document.createElement('button');
        codeBtn.className = 'add-cell-button add-cell-code';
        codeBtn.textContent = '+ code';
        codeBtn.addEventListener('click', () => this._addCell(getIndex(), 'code'));

        const mdBtn = document.createElement('button');
        mdBtn.className = 'add-cell-button add-cell-markdown';
        mdBtn.textContent = '+ markdown';
        mdBtn.addEventListener('click', () => this._addCell(getIndex(), 'markdown'));

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
            const addBtn = this._createAddCellButton();
            const refChild = this._wrapperEl.children[2 + index * 2] || null;
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
            const addBtnEl = this._wrapperEl.children[2 + index * 2];
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

    _reorderDOM() {
        if (!this._wrapperEl) return;
        // Remove all children after topBar and secondBar
        while (this._wrapperEl.children.length > 2) {
            this._wrapperEl.lastChild.remove();
        }
        // Re-append addBtn + cell pairs in current _cells order
        for (let i = 0; i < this._cells.length; i++) {
            this._wrapperEl.appendChild(this._createAddCellButton());
            this._wrapperEl.appendChild(this._cells[i].element);
        }
        // Final add-cell button
        const lastBtn = this._createAddCellButton();
        lastBtn.classList.add('add-cell-last');
        this._wrapperEl.appendChild(lastBtn);
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
            const addBtn = this._createAddCellButton();
            const refChild = this._wrapperEl.children[2 + index * 2] || null;
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
                const addBtnEl = this._wrapperEl.children[2 + index * 2];
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
        this._reorderDOM();
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
            notify.error(data.message || 'Request failed');
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

    setOnSaved(cb) { this._onSavedCallback = cb; }

    _onNotebookSaved(data) {
        if (data.success) {
            notify.success('Saved');
            this._onSavedCallback?.();
        } else {
            notify.error('Save failed');
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
