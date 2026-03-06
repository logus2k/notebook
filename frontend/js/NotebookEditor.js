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

        // Multi-cell selection state
        this._selectedIndices = new Set();
        this._anchorIndex = null;
        this._clipboard = null; // { cells: [...cellJSON], isCut: bool }

        // Notebook-level undo stack (snapshots)
        this._undoStack = [];
        this._maxUndoSize = 20;

        this._setupClientListeners();
        this._setupContainerListeners();
    }

    get cells() { return this._cells; }
    get projectId() { return this._projectId; }
    get notebookPath() { return this._notebookPath; }

    _setupContainerListeners() {
        // Clicking empty space in the notebook container should not start
        // text selection or move focus into a CodeMirror editor.
        this._container.addEventListener('mousedown', (e) => {
            if (!e.target.closest('.cell') && !e.target.closest('.add-cell-container')
                && !e.target.closest('.welcome-screen') && !e.target.closest('.project-browser')) {
                e.preventDefault();
                const active = document.activeElement;
                if (active && active.closest('.cell')) active.blur();
            }
        });

        // Add copy/save buttons to images inside cells
        const copySvg = '<svg viewBox="0 0 24 24" fill="none" stroke="#202020" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" fill="#a8d8a0"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        const checkSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="#2a7a2a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 9 17 20 6"/></svg>';
        const saveSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="#202020" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4" /><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" fill="#a8c8f0"/></svg>';

        const wrapImage = (img) => {
            if (img.closest('.img-copy-wrapper')) return;
            if (!img.closest('.cell-markdown-rendered') && !img.closest('.cell-output')) return;

            const wrapper = document.createElement('span');
            wrapper.className = 'img-copy-wrapper';
            img.parentNode.insertBefore(wrapper, img);
            wrapper.appendChild(img);

            const copyBtn = document.createElement('button');
            copyBtn.className = 'img-copy-btn';
            copyBtn.innerHTML = copySvg;
            copyBtn.title = 'Copy image';
            copyBtn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    canvas.getContext('2d').drawImage(img, 0, 0);
                    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
                    await navigator.clipboard.write([
                        new ClipboardItem({ 'image/png': blob })
                    ]);
                    copyBtn.classList.add('copied');
                    copyBtn.innerHTML = checkSvg;
                    setTimeout(() => {
                        copyBtn.classList.remove('copied');
                        copyBtn.innerHTML = copySvg;
                    }, 1500);
                } catch {
                    window.open(img.src, '_blank');
                }
            });
            wrapper.appendChild(copyBtn);

            const saveBtn = document.createElement('button');
            saveBtn.className = 'img-copy-btn';
            saveBtn.innerHTML = saveSvg;
            saveBtn.title = 'Save image';
            saveBtn.style.right = '38px';
            saveBtn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    canvas.getContext('2d').drawImage(img, 0, 0);
                    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    const srcName = img.src.split('/').pop().split('?')[0];
                    a.download = srcName && srcName.includes('.') ? srcName : 'image.png';
                    a.click();
                    URL.revokeObjectURL(url);
                } catch {
                    window.open(img.src, '_blank');
                }
            });
            wrapper.appendChild(saveBtn);
        };

        // Observe DOM changes to wrap new images as they appear
        new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    const imgs = node.tagName === 'IMG' ? [node] : node.querySelectorAll?.('img') || [];
                    for (const img of imgs) wrapImage(img);
                }
            }
        }).observe(this._container, { childList: true, subtree: true });

        // Clicking page margins (outside the notebook container entirely)
        // should also not transfer focus into a CodeMirror editor.
        document.addEventListener('mousedown', (e) => {
            if (!this._container.contains(e.target)
                && !e.target.closest('#toolbar') && !e.target.closest('#info-bar')
                && !e.target.closest('.jsPanel')) {
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

    runAll() {
        for (let i = 0; i < this._cells.length; i++) {
            const cell = this._cells[i];
            if (cell.cellType === 'code') {
                cell._onRun();
            }
        }
    }

    runAbove(index) {
        for (let i = 0; i < index; i++) {
            if (this._cells[i].cellType === 'code') {
                this._cells[i]._onRun();
            }
        }
    }

    runBelow(index) {
        for (let i = index; i < this._cells.length; i++) {
            if (this._cells[i].cellType === 'code') {
                this._cells[i]._onRun();
            }
        }
    }

    clearAllOutputs() {
        for (const cell of this._cells) {
            if (cell.cellType === 'code') {
                cell.clearOutput();
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
        this._setupDragDrop();
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
            onFocus: (idx) => this._onCellFocus(idx),
            onBlur: (idx) => this._onCellBlur(idx),
            onChange: (idx, source) => this._onCellChange(idx, source),
            onRun: (idx, code) => this._onCellRun(idx, code),
            onDelete: (idx) => this._onCellDelete(idx),
            onAddCell: (idx, type) => this._addCell(idx, type),
            onRunAbove: (idx) => this.runAbove(idx),
            onRunBelow: (idx) => this.runBelow(idx),
            onCellKeydown: (idx, e) => this._onCellKeydown(idx, e),
            onCellMousedown: (idx, e) => this._onCellMousedown(idx, e),
            onCellClick: (idx, e) => this._onCellClick(idx, e),
            onCellDragStart: (idx, e) => this._onCellDragStart(idx, e),
            onCellDragEnd: (idx) => this._onCellDragEnd(idx),
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

        // Insert into DOM: structure is [addBtn, cell, addBtn, cell, addBtn, ...]
        // addBtn(i) is at children[2*i], cell(i) at children[2*i+1].
        // Insert new cell + addBtn after the addBtn at position index*2.
        if (this._wrapperEl) {
            const addBtn = this._createAddCellButton(index + 1);
            const refChild = this._wrapperEl.children[index * 2 + 1] || null;
            this._wrapperEl.insertBefore(cellEditor.element, refChild);
            this._wrapperEl.insertBefore(addBtn, cellEditor.element.nextSibling);
            this._updateAddCellLast();
        }

        // Broadcast
        this._client.addCell(index, cellType, cellId);
    }

    _onCellDelete(index) {
        this._pushUndo();

        const isLastCell = this._cells.length <= 1;
        const cell = this._cells[index];
        cell.destroy();
        this._cells.splice(index, 1);

        // cell.destroy() already removed the cell element from the DOM.
        // That leaves two adjacent addBtns where the cell was.
        // Remove one of them (the trailing one, now at index*2+1).
        if (this._wrapperEl) {
            const addBtnEl = this._wrapperEl.children[index * 2 + 1];
            if (addBtnEl) addBtnEl.remove();
        }

        this._reindexCells();
        this._updateAddCellLast();
        this._client.deleteCell(index);

        // If that was the last cell, insert a fresh empty code cell
        if (isLastCell) {
            this._addCell(0, 'code', { skipUndo: true });
            this._selectCell(0);
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

    _onCellFocus(index) {
        // Lock/unlock now handled by onEditorFocus/onEditorBlur
    }

    _onCellBlur(index) {
        // Lock/unlock now handled by onEditorFocus/onEditorBlur
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

    _setupDragDrop() {
        if (!this._wrapperEl) return;
        this._dragScrollRAF = null;

        this._wrapperEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            this._updateDropIndicator(e.clientY);
            this._updateDragScroll(e.clientY);
        });

        this._wrapperEl.addEventListener('dragleave', (e) => {
            if (!this._wrapperEl.contains(e.relatedTarget)) {
                this._clearDropIndicator();
                this._stopDragScroll();
            }
        });

        this._wrapperEl.addEventListener('drop', (e) => {
            e.preventDefault();
            this._stopDragScroll();
            const raw = e.dataTransfer.getData('text/plain');
            const toIndex = this._dropTargetIndex;
            this._clearDropIndicator();

            if (!raw || toIndex == null) return;

            // Parse dragged indices (comma-separated)
            const draggedIndices = raw.split(',').map(Number).filter(n => !isNaN(n));
            if (draggedIndices.length === 0) return;

            const sorted = [...draggedIndices].sort((a, b) => a - b);

            // Check if dropping into the same position (no-op)
            const first = sorted[0];
            const last = sorted[sorted.length - 1];
            if (toIndex >= first && toIndex <= last + 1) return;

            this._pushUndo();

            // Extract dragged cells (reverse order to preserve indices)
            const draggedCells = sorted.map(i => this._cells[i]);
            for (let i = sorted.length - 1; i >= 0; i--) {
                this._cells.splice(sorted[i], 1);
            }

            // Calculate insertion point after removal
            let insertAt = toIndex;
            for (const idx of sorted) {
                if (idx < toIndex) insertAt--;
            }

            // Insert dragged cells at new position
            this._cells.splice(insertAt, 0, ...draggedCells);
            this._reindexCells();

            this._notebook.cells = this._cells.map(c => c.toJSON());
            this._render();

            // Broadcast moves — send each cell's movement
            for (let i = 0; i < sorted.length; i++) {
                this._client.moveCell(sorted[i], insertAt + i);
            }

            // Restore selection at new positions
            this._selectedIndices.clear();
            for (let i = 0; i < draggedCells.length; i++) {
                this._selectedIndices.add(insertAt + i);
            }
            this._anchorIndex = insertAt;
            this._updateSelectionVisuals();
        });
    }

    _updateDragScroll(clientY) {
        const edgeZone = 60;
        const maxSpeed = 12;
        const rect = this._container.getBoundingClientRect();
        const distTop = clientY - rect.top;
        const distBottom = rect.bottom - clientY;

        let speed = 0;
        if (distTop < edgeZone) {
            speed = -maxSpeed * (1 - distTop / edgeZone);
        } else if (distBottom < edgeZone) {
            speed = maxSpeed * (1 - distBottom / edgeZone);
        }

        if (speed === 0) {
            this._stopDragScroll();
            return;
        }

        if (this._dragScrollRAF) return; // already scrolling

        const scroll = () => {
            this._container.scrollTop += speed;
            this._dragScrollRAF = requestAnimationFrame(scroll);
        };
        this._dragScrollRAF = requestAnimationFrame(scroll);
    }

    _stopDragScroll() {
        if (this._dragScrollRAF) {
            cancelAnimationFrame(this._dragScrollRAF);
            this._dragScrollRAF = null;
        }
    }

    _updateDropIndicator(clientY) {
        // Find the closest gap between cells based on cursor Y position
        let closestIndex = 0;
        let closestDist = Infinity;

        for (let i = 0; i <= this._cells.length; i++) {
            let y;
            if (i < this._cells.length) {
                y = this._cells[i].element.getBoundingClientRect().top;
            } else {
                const last = this._cells[this._cells.length - 1].element;
                y = last.getBoundingClientRect().bottom;
            }
            const dist = Math.abs(clientY - y);
            if (dist < closestDist) {
                closestDist = dist;
                closestIndex = i;
            }
        }

        // Only update DOM if target changed
        if (closestIndex === this._dropTargetIndex) return;

        this._clearDropIndicator();
        this._dropTargetIndex = closestIndex;

        // Show indicator on the add-cell-container at that position
        // DOM structure: [addBtn(0), cell(0), addBtn(1), cell(1), addBtn(2), ...]
        // addBtn(i) is at children[2*i]
        const indicator = this._wrapperEl.children[closestIndex * 2];
        if (indicator) {
            indicator.classList.add('drop-target');
        }
    }

    _clearDropIndicator() {
        this._dropTargetIndex = null;
        if (!this._wrapperEl) return;
        for (const el of this._wrapperEl.querySelectorAll('.drop-target')) {
            el.classList.remove('drop-target');
        }
    }

    // --- Selection ---

    _selectCell(index) {
        this._clearSelection();
        this._selectedIndices.add(index);
        this._anchorIndex = index;
        this._updateSelectionVisuals();
    }

    _extendSelectionTo(index) {
        if (this._anchorIndex === null) this._anchorIndex = index;
        this._selectedIndices.clear();
        const lo = Math.min(this._anchorIndex, index);
        const hi = Math.max(this._anchorIndex, index);
        for (let i = lo; i <= hi; i++) this._selectedIndices.add(i);
        this._updateSelectionVisuals();
    }

    _clearSelection() {
        this._selectedIndices.clear();
        this._updateSelectionVisuals();
    }

    _updateSelectionVisuals() {
        const multi = this._selectedIndices.size > 1;
        for (let i = 0; i < this._cells.length; i++) {
            const isSelected = this._selectedIndices.has(i);
            this._cells[i].element.classList.toggle('selected', isSelected);
            // Make selected cells draggable from anywhere (not just drag handle)
            this._cells[i].element.draggable = isSelected && multi;
        }
    }

    // --- Drag handling for selection ---

    _onCellDragStart(index, e) {
        // If dragged cell is part of selection, drag all selected cells
        let indices;
        if (this._selectedIndices.has(index) && this._selectedIndices.size > 1) {
            indices = [...this._selectedIndices].sort((a, b) => a - b);
        } else {
            // Dragging an unselected cell — select just that one
            this._selectCell(index);
            indices = [index];
        }

        e.dataTransfer.setData('text/plain', indices.join(','));
        e.dataTransfer.effectAllowed = 'move';

        // Mark all dragged cells visually
        for (const idx of indices) {
            this._cells[idx].element.classList.add('dragging');
        }
    }

    _onCellDragEnd(index) {
        for (const cell of this._cells) {
            cell.element.classList.remove('dragging');
        }
    }

    // --- Mouse handling for selection ---

    _onCellMousedown(index, e) {
        // Shift+click always extends cell selection, regardless of click target
        if (e.shiftKey) {
            e.preventDefault();
            this._extendSelectionTo(index);
            this._cells[index].focusCell();
            return;
        }

        // Ctrl+click toggles individual cell in selection (sparse selection)
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (this._selectedIndices.has(index)) {
                this._selectedIndices.delete(index);
                if (this._selectedIndices.size === 0) {
                    this._selectedIndices.add(index); // keep at least one selected
                }
            } else {
                this._selectedIndices.add(index);
            }
            this._anchorIndex = index;
            this._updateSelectionVisuals();
            this._cells[index].focusCell();
            return;
        }

        // Clicking inside the editor area — let CodeMirror handle focus,
        // but still update cell-level selection
        const editorArea = this._cells[index]?.element.querySelector('.cell-editor');
        if (editorArea && editorArea.contains(e.target)) {
            this._selectCell(index);
            return;
        }

        // Don't interfere with drag handle — selection is handled by dragstart
        const sidebar = this._cells[index]?.element.querySelector('.cell-sidebar');
        if (sidebar && sidebar.contains(e.target)) return;

        // Don't interfere with header buttons (delete, copy, +Code, +Markdown)
        if (e.target.closest('.cell-delete-btn, .cell-copy-btn, .cell-clear-btn, .cell-header-btn')) return;

        // Clicking an already-selected cell in multi-selection: DON'T focus here
        // (calling element.focus() during mousedown prevents browser drag initiation)
        // The click handler will focus after mouseup if no drag occurred.
        if (this._selectedIndices.has(index) && this._selectedIndices.size > 1) {
            return;
        }

        // Plain click selects one cell in command mode
        this._selectCell(index);
        this._cells[index].focusCell();
    }

    // --- Click handler (fires after mouseup, NOT after drag) ---

    _onCellClick(index, e) {
        // Skip clicks inside editor or sidebar
        const editorArea = this._cells[index]?.element.querySelector('.cell-editor');
        if (editorArea && editorArea.contains(e.target)) return;
        const sidebar = this._cells[index]?.element.querySelector('.cell-sidebar');
        if (sidebar && sidebar.contains(e.target)) return;

        // After a non-drag click on a multi-selected cell, reduce to single selection
        if (this._selectedIndices.has(index) && this._selectedIndices.size > 1 && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
            this._selectCell(index);
            this._cells[index].focusCell();
        }
    }

    // --- Command-mode keyboard handler ---

    _onCellKeydown(index, e) {
        const key = e.key;

        if (key === 'ArrowUp' || key === 'ArrowDown') {
            e.preventDefault();
            const dir = key === 'ArrowUp' ? -1 : 1;
            if (e.altKey) {
                this._moveSelectedCells(dir);
            } else if (e.shiftKey) {
                this._extendSelection(index, dir);
            } else {
                this._navigateToCell(index + dir);
            }
            return;
        }

        if (key === 'Enter') {
            e.preventDefault();
            this._clearSelection();
            const cell = this._cells[index];
            if (cell) {
                if (cell.cellType === 'markdown' && cell._markdownRendered) {
                    cell._hideMarkdownRendered();
                }
                cell.focusEditor();
            }
            return;
        }

        if (key === 'Delete' || key === 'Backspace') {
            e.preventDefault();
            this._deleteSelectedCells();
            return;
        }

        // Ctrl/Cmd+C/X/V
        const mod = e.ctrlKey || e.metaKey;
        if (mod && key === 'c') {
            e.preventDefault();
            this._copySelectedCells(false);
            return;
        }
        if (mod && key === 'x') {
            e.preventDefault();
            this._copySelectedCells(true);
            return;
        }
        if (mod && key === 'v') {
            e.preventDefault();
            this._pasteCells();
            return;
        }
        if (mod && key === 'z' && !e.shiftKey) {
            e.preventDefault();
            this._undo();
            return;
        }
    }

    // --- Cell operations ---

    _navigateToCell(targetIndex) {
        if (targetIndex < 0 || targetIndex >= this._cells.length) return;
        this._selectCell(targetIndex);
        this._cells[targetIndex].focusCell();
        this._cells[targetIndex].element.scrollIntoView({ block: 'nearest' });
    }

    _extendSelection(currentIndex, dir) {
        // Find the leading edge of current selection in the direction of extension
        const sorted = [...this._selectedIndices].sort((a, b) => a - b);
        const edge = dir > 0 ? sorted[sorted.length - 1] : sorted[0];
        const next = edge + dir;
        if (next < 0 || next >= this._cells.length) return;
        this._extendSelectionTo(next);
        this._cells[next].focusCell();
        this._cells[next].element.scrollIntoView({ block: 'nearest' });
    }

    _moveSelectedCells(dir) {
        if (this._selectedIndices.size === 0) return;
        const sorted = [...this._selectedIndices].sort((a, b) => a - b);

        // Must be a contiguous block
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] !== sorted[i - 1] + 1) return;
        }

        const first = sorted[0];
        const last = sorted[sorted.length - 1];

        if (dir < 0 && first === 0) return;
        if (dir > 0 && last === this._cells.length - 1) return;

        this._pushUndo();

        // Swap the adjacent cell with the block
        if (dir < 0) {
            // Move the cell above the block to after the block
            const adj = first - 1;
            const [cell] = this._cells.splice(adj, 1);
            this._cells.splice(last, 0, cell);
            this._client.moveCell(adj, last);
        } else {
            // Move the cell below the block to before the block
            const adj = last + 1;
            const [cell] = this._cells.splice(adj, 1);
            this._cells.splice(first, 0, cell);
            this._client.moveCell(adj, first);
        }

        this._reindexCells();
        this._notebook.cells = this._cells.map(c => c.toJSON());
        this._render();

        // Restore selection at new positions
        this._selectedIndices.clear();
        for (const idx of sorted) {
            this._selectedIndices.add(idx + dir);
        }
        this._anchorIndex = (this._anchorIndex !== null) ? this._anchorIndex + dir : null;
        this._updateSelectionVisuals();

        const focusIdx = dir < 0 ? first + dir : last + dir;
        if (this._cells[focusIdx]) {
            this._cells[focusIdx].focusCell();
            this._cells[focusIdx].element.scrollIntoView({ block: 'nearest' });
        }
    }

    _copySelectedCells(isCut) {
        if (this._selectedIndices.size === 0) return;
        const sorted = [...this._selectedIndices].sort((a, b) => a - b);
        this._clipboard = {
            cells: sorted.map(i => this._cells[i].toJSON()),
            isCut
        };
        if (isCut) {
            this._deleteSelectedCells();
        }
    }

    _pasteCells() {
        if (!this._clipboard || this._clipboard.cells.length === 0) return;
        this._pushUndo();

        // Insert after last selected cell, or at end if no selection
        let insertAt;
        if (this._selectedIndices.size > 0) {
            insertAt = Math.max(...this._selectedIndices) + 1;
        } else {
            insertAt = this._cells.length;
        }

        const newIndices = [];
        for (let i = 0; i < this._clipboard.cells.length; i++) {
            const cellJSON = this._clipboard.cells[i];
            const cellId = Math.random().toString(36).substring(2, 10);
            const cellData = {
                cell_type: cellJSON.cell_type,
                id: cellId,
                metadata: {},
                source: cellJSON.source,
                outputs: [],
                execution_count: null
            };

            const idx = insertAt + i;
            const cellEditor = this._createCellEditor(cellData, idx);
            this._cells.splice(idx, 0, cellEditor);

            // Broadcast
            this._client.addCell(idx, cellData.cell_type, cellId);
            // Set source after creation
            const src = Array.isArray(cellJSON.source) ? cellJSON.source.join('') : (cellJSON.source || '');
            if (src) {
                setTimeout(() => this._client.updateCell(idx, src), 50);
            }

            newIndices.push(idx);
        }

        this._reindexCells();
        this._notebook.cells = this._cells.map(c => c.toJSON());

        this._render();

        // Select the pasted cells
        this._selectedIndices.clear();
        for (const idx of newIndices) this._selectedIndices.add(idx);
        this._anchorIndex = newIndices[0];
        this._updateSelectionVisuals();

        if (this._cells[newIndices[0]]) {
            this._cells[newIndices[0]].focusCell();
        }
    }

    _deleteSelectedCells() {
        if (this._selectedIndices.size === 0) return;
        this._pushUndo();

        const sorted = [...this._selectedIndices].sort((a, b) => b - a); // reverse order
        const nearestAfter = Math.min(...this._selectedIndices);

        for (const idx of sorted) {
            const cell = this._cells[idx];
            cell.destroy();
            this._cells.splice(idx, 1);

            if (this._wrapperEl) {
                const addBtnEl = this._wrapperEl.children[idx * 2 + 1];
                if (addBtnEl) addBtnEl.remove();
            }

            this._client.deleteCell(idx);
        }

        this._reindexCells();
        this._updateAddCellLast();
        this._clearSelection();

        // If all cells deleted, add a fresh one
        if (this._cells.length === 0) {
            this._addCell(0, 'code', { skipUndo: true });
        }

        // Focus nearest remaining cell
        const focusIdx = Math.min(nearestAfter, this._cells.length - 1);
        this._selectCell(focusIdx);
        this._cells[focusIdx].focusCell();
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

        // Sync with server: remove all current cells, then re-add from snapshot
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
            this._selectCell(0);
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

            // cell.destroy() already removed the cell element from the DOM.
            // Remove one of the two now-adjacent addBtns.
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

    _onError(data) {
        if (data.code === 'INVALID_REQUEST') {
            // Save or other request failed due to missing context
            this._showSaveIndicator(data.message || 'Request failed', true);
            return;
        }

        // Stop all executing cells and show the error
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
        // Remove existing indicator
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
