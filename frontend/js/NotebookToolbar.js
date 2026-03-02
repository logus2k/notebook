/**
 * NotebookToolbar - Kernel status, venv selector, action buttons, connected users.
 */
export class NotebookToolbar {
    /**
     * @param {HTMLElement} containerEl
     * @param {import('./KernelClient.js').KernelClient} kernelClient
     * @param {object} callbacks - { onSave, onRunAll, onVenvPanelToggle }
     */
    constructor(containerEl, kernelClient, callbacks = {}) {
        this._container = containerEl;
        this._client = kernelClient;
        this._callbacks = callbacks;
        this._kernelStatus = 'dead';
        this._connectedUsers = {};
        this._venvs = { project: [], shared: [] };
        this._selectedVenv = null;

        this._build();
        this._setupListeners();
    }

    _build() {
        this._container.innerHTML = '';

        // Project/notebook selector group
        const navGroup = this._createGroup();

        this._projectSelect = document.createElement('select');
        this._projectSelect.className = 'project-selector';
        this._projectSelect.addEventListener('change', () => this._onProjectChange());
        navGroup.appendChild(this._projectSelect);

        const newProjectBtn = this._createButton('+', () => this._onCreateProject());
        newProjectBtn.title = 'Create project';
        navGroup.appendChild(newProjectBtn);

        this._notebookSelect = document.createElement('select');
        this._notebookSelect.className = 'notebook-selector';
        this._notebookSelect.addEventListener('change', () => this._onNotebookChange());
        navGroup.appendChild(this._notebookSelect);

        const newNotebookBtn = this._createButton('+', () => this._onCreateNotebook());
        newNotebookBtn.title = 'Create notebook';
        navGroup.appendChild(newNotebookBtn);

        this._container.appendChild(navGroup);
        this._container.appendChild(this._createSeparator());

        // Action buttons
        const actionsGroup = this._createGroup();

        this._saveBtn = this._createButton('Save', () => {
            if (this._callbacks.onSave) this._callbacks.onSave();
        });
        actionsGroup.appendChild(this._saveBtn);

        this._runAllBtn = this._createButton('Run All', () => {
            if (this._callbacks.onRunAll) this._callbacks.onRunAll();
        });
        actionsGroup.appendChild(this._runAllBtn);

        this._container.appendChild(actionsGroup);
        this._container.appendChild(this._createSeparator());

        // Kernel controls
        const kernelGroup = this._createGroup();

        this._kernelStatusEl = document.createElement('div');
        this._kernelStatusEl.className = 'kernel-status';
        this._kernelDot = document.createElement('span');
        this._kernelDot.className = 'kernel-status-dot dead';
        this._kernelLabel = document.createElement('span');
        this._kernelLabel.textContent = 'No Kernel';
        this._kernelStatusEl.append(this._kernelDot, this._kernelLabel);
        kernelGroup.appendChild(this._kernelStatusEl);

        this._startKernelBtn = this._createButton('Start', () => this._onStartKernel());
        this._stopKernelBtn = this._createButton('Stop', () => this._client.stopKernel());
        this._restartKernelBtn = this._createButton('Restart', () => this._client.restartKernel());
        this._interruptBtn = this._createButton('Interrupt', () => this._client.interruptKernel());

        kernelGroup.append(this._startKernelBtn, this._stopKernelBtn,
                           this._restartKernelBtn, this._interruptBtn);
        this._container.appendChild(kernelGroup);
        this._container.appendChild(this._createSeparator());

        // Venv selector
        const venvGroup = this._createGroup();
        const venvLabel = document.createElement('span');
        venvLabel.className = 'toolbar-label';
        venvLabel.textContent = 'Env:';
        venvGroup.appendChild(venvLabel);

        this._venvSelect = document.createElement('select');
        this._venvSelect.className = 'venv-selector';
        venvGroup.appendChild(this._venvSelect);

        const venvManageBtn = this._createButton('Manage', () => {
            if (this._callbacks.onVenvPanelToggle) this._callbacks.onVenvPanelToggle();
        });
        venvGroup.appendChild(venvManageBtn);

        this._container.appendChild(venvGroup);

        // Spacer
        const spacer = document.createElement('div');
        spacer.className = 'toolbar-spacer';
        this._container.appendChild(spacer);

        // Connected users
        this._usersEl = document.createElement('div');
        this._usersEl.className = 'connected-users';
        this._container.appendChild(this._usersEl);
    }

    _setupListeners() {
        this._client.on('kernel:status', (data) => this._setKernelStatus(data.status));
        this._client.on('user:joined', (data) => {
            this._connectedUsers[data.sid] = data.name;
            this._renderUsers();
        });
        this._client.on('user:left', (data) => {
            delete this._connectedUsers[data.sid];
            this._renderUsers();
        });
        this._client.on('notebook:state', (data) => {
            this._connectedUsers = {};
            const users = data.connected_users || {};
            for (const [sid, info] of Object.entries(users)) {
                this._connectedUsers[sid] = info.name || 'Anonymous';
            }
            this._renderUsers();
        });
    }

    // --- Public methods ---

    async loadProjects() {
        try {
            const resp = await fetch('/api/projects');
            const projects = await resp.json();
            this._projectSelect.innerHTML = '<option value="">Select project...</option>';
            for (const p of projects) {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = `${p.id} (${p.notebooks_count} notebooks)`;
                this._projectSelect.appendChild(opt);
            }
        } catch (err) {
            console.error('Failed to load projects:', err);
        }
    }

    async loadNotebooks(projectId) {
        try {
            const resp = await fetch(`/api/projects/${projectId}/notebooks`);
            const notebooks = await resp.json();
            this._notebookSelect.innerHTML = '<option value="">Select notebook...</option>';
            for (const nb of notebooks) {
                const opt = document.createElement('option');
                opt.value = nb.name;
                opt.textContent = nb.name;
                this._notebookSelect.appendChild(opt);
            }
        } catch (err) {
            console.error('Failed to load notebooks:', err);
        }
    }

    async loadVenvs(projectId) {
        try {
            const [projectResp, sharedResp] = await Promise.all([
                fetch(`/api/projects/${projectId}/venvs`),
                fetch('/api/venvs')
            ]);
            this._venvs.project = await projectResp.json();
            this._venvs.shared = await sharedResp.json();
            this._renderVenvSelect();
        } catch (err) {
            console.error('Failed to load venvs:', err);
        }
    }

    setProject(projectId) {
        this._projectSelect.value = projectId;
    }

    setNotebook(notebookName) {
        this._notebookSelect.value = notebookName;
    }

    getSelectedVenvRef() {
        const val = this._venvSelect.value;
        if (!val) return null;
        const [type, name] = val.split(':');
        return { type, name };
    }

    // --- Internal ---

    _onProjectChange() {
        const projectId = this._projectSelect.value;
        if (projectId) {
            this.loadNotebooks(projectId);
            this.loadVenvs(projectId);
        }
        if (this._callbacks.onProjectChange) {
            this._callbacks.onProjectChange(projectId);
        }
    }

    _onNotebookChange() {
        const notebookName = this._notebookSelect.value;
        if (this._callbacks.onNotebookChange) {
            this._callbacks.onNotebookChange(
                this._projectSelect.value, notebookName
            );
        }
    }

    async _onCreateProject() {
        const name = prompt('Project name:');
        if (!name || !name.trim()) return;
        try {
            const resp = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ project_id: name.trim() })
            });
            if (!resp.ok) {
                const err = await resp.json();
                throw new Error(err.detail || 'Failed to create project');
            }
            await this.loadProjects();
            this._projectSelect.value = name.trim();
            this._onProjectChange();
        } catch (err) {
            alert(`Error: ${err.message}`);
        }
    }

    async _onCreateNotebook() {
        const projectId = this._projectSelect.value;
        if (!projectId) {
            alert('Select a project first');
            return;
        }
        const name = prompt('Notebook name (without .ipynb):');
        if (!name || !name.trim()) return;
        try {
            const resp = await fetch(`/api/projects/${projectId}/notebooks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim() })
            });
            if (!resp.ok) {
                const err = await resp.json();
                throw new Error(err.detail || 'Failed to create notebook');
            }
            await this.loadNotebooks(projectId);
            const nbName = name.trim().endsWith('.ipynb') ? name.trim() : name.trim() + '.ipynb';
            this._notebookSelect.value = nbName;
            this._onNotebookChange();
        } catch (err) {
            alert(`Error: ${err.message}`);
        }
    }

    _onStartKernel() {
        const venvRef = this.getSelectedVenvRef();
        if (!venvRef) {
            alert('Select a virtual environment first');
            return;
        }
        this._client.startKernel(venvRef);
    }

    _setKernelStatus(status) {
        this._kernelStatus = status;
        this._kernelDot.className = `kernel-status-dot ${status}`;
        const labels = {
            idle: 'Idle', busy: 'Busy', starting: 'Starting...', dead: 'Stopped'
        };
        this._kernelLabel.textContent = labels[status] || status;
    }

    _renderVenvSelect() {
        this._venvSelect.innerHTML = '<option value="">No env</option>';
        if (this._venvs.project.length > 0) {
            const group = document.createElement('optgroup');
            group.label = 'Project';
            for (const v of this._venvs.project) {
                const opt = document.createElement('option');
                opt.value = `project:${v.name}`;
                opt.textContent = v.name;
                group.appendChild(opt);
            }
            this._venvSelect.appendChild(group);
        }
        if (this._venvs.shared.length > 0) {
            const group = document.createElement('optgroup');
            group.label = 'Shared';
            for (const v of this._venvs.shared) {
                const opt = document.createElement('option');
                opt.value = `shared:${v.name}`;
                opt.textContent = v.name;
                group.appendChild(opt);
            }
            this._venvSelect.appendChild(group);
        }
    }

    _renderUsers() {
        this._usersEl.innerHTML = '';
        for (const [sid, name] of Object.entries(this._connectedUsers)) {
            const avatar = document.createElement('div');
            avatar.className = 'user-avatar';
            avatar.textContent = (name || '?')[0].toUpperCase();
            avatar.title = name;
            this._usersEl.appendChild(avatar);
        }
    }

    // --- Helpers ---

    _createGroup() {
        const div = document.createElement('div');
        div.className = 'toolbar-group';
        return div;
    }

    _createSeparator() {
        const div = document.createElement('div');
        div.className = 'toolbar-separator';
        return div;
    }

    _createButton(label, onClick) {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.addEventListener('click', onClick);
        return btn;
    }
}
