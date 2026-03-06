/**
 * ExplorerPanel - Unified jsPanel with Wunderbaum tree (left) and detail pane (right).
 * Two root branches: Projects (with notebooks) and Environments.
 */
export class ExplorerPanel {
    /**
     * @param {object} callbacks
     *   onNotebookSelect(projectId, notebookName)
     *   onVenvSelect({ name, runtimeId, displayName })
     *   onVenvDeleted(name)
     *   onProjectDeleted(projectId)
     *   onNotebookDeleted(projectId, notebookName)
     *   onProjectRenamed(oldId, newId)
     *   onNotebookRenamed(projectId, oldName, newName)
     */
    constructor(callbacks = {}) {
        this._callbacks = callbacks;
        this._panel = null;
        this._tree = null;
        this._detailEl = null;
        this._treeEl = null;
        this._activeVenvName = null;
        this._autoLoad = false;
        this._currentProject = null;
        this._currentNotebook = null;
    }

    setActiveVenv(name) {
        this._activeVenvName = name;
    }

    /**
     * @param {object} opts
     *   opts.currentProject, opts.currentNotebook - for notebook navigation
     *   opts.navigateToVenv - venv name to navigate to and select
     *   opts.navigateToEnvs - navigate to the Environments root node
     */
    open(opts = {}) {
        const { currentProject = null, currentNotebook = null, navigateToVenv = null, navigateToEnvs = false } = opts;
        this._currentProject = currentProject;
        this._currentNotebook = currentNotebook;
        this._navigateToVenvName = navigateToVenv;
        this._navigateToEnvs = navigateToEnvs;

        if (this._panel) {
            this._panel.front();
            this._applyNavigation();
            return;
        }

        this._panel = jsPanel.create({
            id: 'explorer-panel',
            headerTitle: 'Workspace',
            theme: 'none',
            borderRadius: '5px',
            border: '1px solid var(--border-color)',
            boxShadow: 3,
            position: 'center',
            panelSize: { width: 900, height: 574 },
            headerControls: { minimize: 'remove', smallify: 'remove', normalize: 'remove', maximize: 'remove' },
            onclosed: () => {
                this._panel = null;
                this._tree = null;
            },
            callback: (panel) => {
                this._panel = panel;
                panel.content.style.padding = '0';
                panel.content.style.overflow = 'hidden';
                // Prevent wheel events from bleeding through to the page behind
                panel.content.addEventListener('wheel', (e) => e.stopPropagation(), { passive: false });
                this._buildLayout(panel.content);
                this._loadTree();
            }
        });
    }

    close() {
        if (this._panel) {
            this._panel.close();
            this._panel = null;
            this._tree = null;
        }
    }

    _buildLayout(container) {
        container.innerHTML = '';
        container.classList.add('explorer-layout');

        // Left pane: tree
        const left = document.createElement('div');
        left.className = 'explorer-tree-pane';

        const treeWrapper = document.createElement('div');
        treeWrapper.id = 'explorerTreeWrapper';

        this._treeEl = document.createElement('div');
        this._treeEl.id = 'explorerTree';
        treeWrapper.appendChild(this._treeEl);
        left.appendChild(treeWrapper);

        // Right pane: detail wrapper with close button
        const right = document.createElement('div');
        right.className = 'explorer-detail-pane';

        this._detailEl = document.createElement('div');
        this._detailEl.className = 'explorer-detail-content';
        right.appendChild(this._detailEl);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'explorer-btn primary explorer-close-btn';
        closeBtn.textContent = 'Close';
        closeBtn.addEventListener('click', () => this.close());
        right.appendChild(closeBtn);

        this._showWelcomeDetail();

        container.append(left, right);

        // Initialize resizable splitter
        Split([left, right], {
            sizes: [30, 70],
            minSize: [150, 200],
            gutterSize: 6,
            cursor: 'col-resize',
        });
    }

    _showWelcomeDetail() {
        this._detailEl.innerHTML = `
            <div class="explorer-detail-empty">
                <span>Select an item from the tree</span>
            </div>`;
    }

    async _loadTree() {
        // Fetch projects, runtimes, and environments in parallel
        const [projectsResp, runtimesResp, envsResp] = await Promise.all([
            fetch('api/projects'),
            fetch('api/runtimes'),
            fetch('api/envs')
        ]);

        const projects = await projectsResp.json();
        this._runtimes = await runtimesResp.json();
        const envs = await envsResp.json();

        // Group envs by runtime_id
        const envsByRuntime = {};
        for (const env of envs) {
            if (!envsByRuntime[env.runtime_id]) envsByRuntime[env.runtime_id] = [];
            envsByRuntime[env.runtime_id].push(env);
        }

        // Find which runtime contains the active venv (if any)
        const activeEnv = this._activeVenvName
            ? envs.find(e => e.name === this._activeVenvName)
            : null;
        const activeRuntimeId = activeEnv ? activeEnv.runtime_id : null;

        // Build runtime nodes, sorted alphabetically; only expand the active runtime
        const runtimeNodes = this._runtimes
            .slice().sort((a, b) => a.display_name.localeCompare(b.display_name))
            .map(rt => ({
                title: rt.display_name,
                key: `runtime:${rt.runtime_id}`,
                icon: 'fa-solid fa-layer-group',
                folder: true,
                expanded: rt.runtime_id === activeRuntimeId,
                children: (envsByRuntime[rt.runtime_id] || [])
                    .slice().sort((a, b) => a.name.localeCompare(b.name))
                    .map(env => ({
                        title: env.name,
                        key: `env:${env.runtime_id}:${env.name}`,
                        icon: 'fa-solid fa-cube',
                    }))
            }));

        const treeData = [
            {
                title: 'Projects',
                key: 'root-projects',
                icon: 'fa-solid fa-diagram-project',
                folder: true,
                expanded: true,
                children: projects.map(p => ({
                    title: p.id,
                    key: `project:${p.id}`,
                    icon: 'fa-solid fa-folder',
                    folder: true,
                    lazy: true,
                }))
            },
            {
                title: 'Environments',
                key: 'root-envs',
                icon: 'fa-solid fa-cubes',
                folder: true,
                expanded: true,
                children: runtimeNodes,
            }
        ];

        this._tree = new mar10.Wunderbaum({
            adjustHeight: false,
            element: this._treeEl,
            source: treeData,
            selectMode: 'single',
            checkbox: false,
            icon: true,
            iconMap: {
                folder: 'fa-solid fa-folder',
                folderOpen: 'fa-solid fa-folder-open',
                doc: 'fa-solid fa-file',
                expanderExpanded: 'fa-solid fa-chevron-down',
                expanderCollapsed: 'fa-solid fa-chevron-right',
            },
            render: (e) => {
                const node = e.node;
                const row = e.nodeElem;
                if (!row) return;
                const key = node.key || '';
                let type = '';
                if (key === 'root-projects' || key === 'root-envs') type = 'root';
                else if (key.startsWith('project:')) type = 'project';
                else if (key.startsWith('notebook:')) type = 'notebook';
                else if (key.startsWith('runtime:')) type = 'runtime';
                else if (key.startsWith('env:')) type = 'env';
                row.setAttribute('data-type', type);
            },
            lazyLoad: async (e) => {
                const node = e.node;
                const key = node.key || '';
                if (key.startsWith('project:')) {
                    const projectId = key.replace('project:', '');
                    try {
                        const resp = await fetch(`api/projects/${encodeURIComponent(projectId)}/notebooks`);
                        const notebooks = await resp.json();
                        return notebooks.map(nb => ({
                            title: nb.name,
                            key: `notebook:${projectId}:${nb.name}`,
                            icon: 'fa-solid fa-file',
                        }));
                    } catch {
                        return [];
                    }
                }
                return [];
            },
            activate: (e) => {
                const key = e.node.key || '';
                this._showDetailForNode(e.node);
                // Auto-load notebook on activation (click or keyboard)
                if (key.startsWith('notebook:') && this._autoLoad && this._callbacks.onNotebookSelect) {
                    const parts = key.replace('notebook:', '').split(':');
                    this._callbacks.onNotebookSelect(parts[0], parts.slice(1).join(':'));
                }
            },
            click: (e) => {
                const node = e.node;
                const key = node.key || '';

                if (e.targetType === 'expander') return;

                // Toggle expand for branch nodes on click
                if (key === 'root-projects' || key === 'root-envs' ||
                    key.startsWith('project:') || key.startsWith('runtime:')) {
                    node.setExpanded(!node.isExpanded());
                }

                // Activate the node (triggers activate event which updates detail)
                node.setActive(true);
                return false;
            }
        });

        this._applyNavigation();
    }

    _applyNavigation() {
        if (this._navigateToVenvName) {
            this._navigateToVenv(this._navigateToVenvName);
        } else if (this._navigateToEnvs) {
            this._navigateToEnvsRoot();
        } else {
            this._navigateToCurrentNotebook();
        }
    }

    _navigateToEnvsRoot() {
        if (!this._tree) return;
        const envsRoot = this._tree.findKey('root-envs');
        if (envsRoot) {
            if (!envsRoot.isExpanded()) envsRoot.setExpanded(true);
            envsRoot.setActive(true, { noEvents: true });
            this._showEnvsRootDetail();
        }
    }

    _navigateToVenv(envKey) {
        if (!this._tree) return;
        const envsRoot = this._tree.findKey('root-envs');
        if (envsRoot && !envsRoot.isExpanded()) envsRoot.setExpanded(true);
        // envKey = "runtimeId:name" (e.g. "python/3.12:my-env")
        const nodeKey = `env:${envKey}`;
        const envNode = this._tree.findKey(nodeKey);
        if (envNode) {
            // Expand the runtime parent
            const parent = envNode.parent;
            if (parent && !parent.isExpanded()) parent.setExpanded(true);
            envNode.setActive(true, { noEvents: true });
            const lastColon = envKey.lastIndexOf(':');
            const runtimeId = envKey.substring(0, lastColon);
            const envName = envKey.substring(lastColon + 1);
            this._showEnvDetail(envName, runtimeId, this._getDisplayName(runtimeId));
        }
    }

    async _navigateToCurrentNotebook() {
        if (!this._tree || !this._currentProject || !this._currentNotebook) return;

        // Expand the project node (triggers lazy load of notebooks)
        const projectNode = this._tree.findKey(`project:${this._currentProject}`);
        if (!projectNode) return;

        if (!projectNode.isExpanded()) {
            await projectNode.setExpanded(true);
        }

        // Find and activate the notebook node
        const nbKey = `notebook:${this._currentProject}:${this._currentNotebook}`;
        const nbNode = this._tree.findKey(nbKey);
        if (nbNode) {
            nbNode.setActive(true, { noEvents: true });
            this._showNotebookDetail(this._currentProject, this._currentNotebook);
        }
    }

    // --- Detail routing ---

    _showDetailForNode(node) {
        const key = node.key || '';
        if (key === 'root-projects') {
            this._showProjectsRootDetail();
        } else if (key === 'root-envs') {
            this._showEnvsRootDetail();
        } else if (key.startsWith('project:')) {
            this._showProjectDetail(key.replace('project:', ''));
        } else if (key.startsWith('notebook:')) {
            const parts = key.replace('notebook:', '').split(':');
            this._showNotebookDetail(parts[0], parts.slice(1).join(':'));
        } else if (key.startsWith('runtime:')) {
            const rtId = key.substring(8);
            this._showRuntimeDetail(rtId, this._getDisplayName(rtId));
        } else if (key.startsWith('env:')) {
            const rest = key.substring(4);
            const lastColon = rest.lastIndexOf(':');
            const runtimeId = rest.substring(0, lastColon);
            const envName = rest.substring(lastColon + 1);
            this._showEnvDetail(envName, runtimeId, this._getDisplayName(runtimeId));
        }
    }

    // --- Detail views ---

    _showProjectsRootDetail() {
        this._detailEl.innerHTML = '';

        const header = this._createDetailHeader('Projects', 'fa-solid fa-folder');
        this._detailEl.appendChild(header);

        const form = document.createElement('div');
        form.className = 'explorer-create-form';

        const label = document.createElement('label');
        label.textContent = 'New Project';
        form.appendChild(label);

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = 'Project name';
        form.appendChild(nameInput);

        const errorEl = document.createElement('div');
        errorEl.className = 'explorer-form-error';
        form.appendChild(errorEl);

        const createBtn = document.createElement('button');
        createBtn.className = 'explorer-btn primary';
        createBtn.textContent = 'Create Project';
        createBtn.addEventListener('click', () => this._createProject(nameInput, createBtn, errorEl));
        form.appendChild(createBtn);

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') createBtn.click();
        });

        this._detailEl.appendChild(form);
        nameInput.focus();
    }

    _showEnvsRootDetail() {
        this._detailEl.innerHTML = '';

        const header = this._createDetailHeader('Environments', 'fa-solid fa-cubes');
        this._detailEl.appendChild(header);

        this._buildEnvCreateForm(this._detailEl);
    }

    _showRuntimeDetail(runtimeId, displayName) {
        this._detailEl.innerHTML = '';

        const header = this._createDetailHeader(displayName || runtimeId, 'fa-solid fa-layer-group');
        this._detailEl.appendChild(header);

        this._buildEnvCreateForm(this._detailEl, runtimeId);
    }

    _buildEnvCreateForm(container, preselectedRuntimeId = null) {
        const form = document.createElement('div');
        form.className = 'explorer-create-form';

        const interpreterLabel = document.createElement('label');
        interpreterLabel.textContent = 'Select Interpreter';
        form.appendChild(interpreterLabel);

        // Runtime selector
        const runtimeSelect = document.createElement('select');
        runtimeSelect.className = 'explorer-select';
        const runtimes = this._runtimes || [];
        if (runtimes.length > 1) {
            for (const rt of runtimes) {
                const opt = document.createElement('option');
                opt.value = rt.runtime_id;
                opt.textContent = rt.display_name;
                if (rt.runtime_id === preselectedRuntimeId) opt.selected = true;
                runtimeSelect.appendChild(opt);
            }
            form.appendChild(runtimeSelect);
        } else if (runtimes.length === 1) {
            runtimeSelect.innerHTML = `<option value="${runtimes[0].runtime_id}">${runtimes[0].display_name}</option>`;
        }
        // If preselected and only one runtime, don't show selector
        if (runtimes.length <= 1) {
            runtimeSelect.style.display = 'none';
            form.appendChild(runtimeSelect);
        }

        const envNameLabel = document.createElement('label');
        envNameLabel.textContent = 'Environment Name';
        form.appendChild(envNameLabel);

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = 'Environment name (e.g. ml-env)';
        form.appendChild(nameInput);

        const reqLabel = document.createElement('label');
        reqLabel.textContent = 'Requirements (optional, one per line)';
        form.appendChild(reqLabel);

        const reqInput = document.createElement('textarea');
        reqInput.placeholder = 'numpy\npandas\nmatplotlib';
        reqInput.rows = 4;
        form.appendChild(reqInput);

        const errorEl = document.createElement('div');
        errorEl.className = 'explorer-form-error';
        form.appendChild(errorEl);

        const createBtn = document.createElement('button');
        createBtn.className = 'explorer-btn primary';
        createBtn.textContent = 'Create Environment';
        createBtn.addEventListener('click', () => this._createEnv(nameInput, reqInput, runtimeSelect, createBtn, errorEl));
        form.appendChild(createBtn);

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') createBtn.click();
        });

        container.appendChild(form);
        nameInput.focus();
    }

    _showProjectDetail(projectId) {
        this._detailEl.innerHTML = '';

        const header = this._createEditableHeader(projectId, 'fa-solid fa-folder-open', async (newName) => {
            return this._renameProject(projectId, newName);
        });
        this._detailEl.appendChild(header);

        const form = document.createElement('div');
        form.className = 'explorer-create-form';

        const label = document.createElement('label');
        label.textContent = 'New Notebook';
        form.appendChild(label);

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = 'Notebook name (without .ipynb)';
        form.appendChild(nameInput);

        const errorEl = document.createElement('div');
        errorEl.className = 'explorer-form-error';
        form.appendChild(errorEl);

        const createBtn = document.createElement('button');
        createBtn.className = 'explorer-btn primary';
        createBtn.textContent = 'Create Notebook';
        createBtn.addEventListener('click', () => this._createNotebook(projectId, nameInput, createBtn, errorEl));
        form.appendChild(createBtn);

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') createBtn.click();
        });

        this._detailEl.appendChild(form);

        // Bottom action bar
        const actionBar = this._createActionBar();
        const delBtn = document.createElement('button');
        delBtn.className = 'explorer-btn danger';
        delBtn.textContent = 'Delete Project';
        delBtn.addEventListener('click', async () => {
            if (!confirm(`Delete project "${projectId}" and all its notebooks?`)) return;
            try {
                const resp = await fetch(`api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    throw new Error(err.detail || 'Failed to delete project');
                }
                const projectNode = this._tree.findKey(`project:${projectId}`);
                if (projectNode) projectNode.remove();
                if (this._callbacks.onProjectDeleted) {
                    this._callbacks.onProjectDeleted(projectId);
                }
                this._showWelcomeDetail();
            } catch (err) {
                alert(`Error: ${err.message}`);
            }
        });
        actionBar.appendChild(delBtn);
        this._detailEl.appendChild(actionBar);

        nameInput.focus();
    }

    async _showNotebookDetail(projectId, notebookName) {
        this._detailEl.innerHTML = '';

        const header = this._createEditableHeader(notebookName, 'fa-solid fa-file', async (newName) => {
            return this._renameNotebook(projectId, notebookName, newName);
        });
        this._detailEl.appendChild(header);

        const meta = document.createElement('div');
        meta.className = 'explorer-detail-meta';
        meta.textContent = `Project: ${projectId}`;
        this._detailEl.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'explorer-detail-actions';

        const openBtn = document.createElement('button');
        openBtn.className = 'explorer-btn primary';
        openBtn.textContent = 'Open Notebook';
        openBtn.addEventListener('click', () => {
            if (this._callbacks.onNotebookSelect) {
                this._callbacks.onNotebookSelect(projectId, notebookName);
            }
        });
        actions.appendChild(openBtn);

        const autoLoadLabel = document.createElement('label');
        autoLoadLabel.className = 'explorer-autoload-label';
        const autoLoadCb = document.createElement('input');
        autoLoadCb.type = 'checkbox';
        autoLoadCb.checked = this._autoLoad;
        autoLoadCb.addEventListener('change', () => {
            this._autoLoad = autoLoadCb.checked;
            if (this._autoLoad && this._callbacks.onNotebookSelect) {
                this._callbacks.onNotebookSelect(projectId, notebookName);
            }
        });
        autoLoadLabel.appendChild(autoLoadCb);
        autoLoadLabel.appendChild(document.createTextNode(' Auto-load'));
        actions.appendChild(autoLoadLabel);

        this._detailEl.appendChild(actions);

        // Fetch and display summary
        try {
            const resp = await fetch(
                `api/projects/${encodeURIComponent(projectId)}/notebooks/${encodeURIComponent(notebookName)}/summary`
            );
            if (!resp.ok) return;
            const summary = await resp.json();

            const infoGrid = document.createElement('div');
            infoGrid.className = 'explorer-nb-info';

            const rows = [];
            if (summary.cells_total != null) {
                rows.push(['Cells', `${summary.cells_total} (${summary.code_cells} code, ${summary.markdown_cells} markdown)`]);
            }
            if (summary.language) {
                const langText = summary.language_version
                    ? `${summary.language} ${summary.language_version}`
                    : summary.language;
                rows.push(['Language', langText]);
            }
            if (summary.kernel) {
                rows.push(['Kernel', summary.kernel]);
            }
            if (summary.size != null) {
                const kb = (summary.size / 1024).toFixed(1);
                rows.push(['Size', `${kb} KB`]);
            }
            if (summary.modified) {
                const date = new Date(summary.modified * 1000);
                rows.push(['Modified', date.toLocaleString()]);
            }

            for (const [label, value] of rows) {
                const row = document.createElement('div');
                row.className = 'explorer-nb-info-row';
                row.innerHTML = `<span class="explorer-nb-info-label">${label}</span><span class="explorer-nb-info-value">${value}</span>`;
                infoGrid.appendChild(row);
            }

            this._detailEl.appendChild(infoGrid);

            // Description preview (first markdown cell, rendered as HTML)
            if (summary.description) {
                const descEl = document.createElement('div');
                descEl.className = 'explorer-nb-description';
                descEl.innerHTML = marked.parse(summary.description);
                this._detailEl.appendChild(descEl);
            }
        } catch {
            // Summary is optional — fail silently
        }

        // Bottom action bar
        const actionBar = this._createActionBar();
        const delBtn = document.createElement('button');
        delBtn.className = 'explorer-btn danger';
        delBtn.textContent = 'Delete Notebook';
        delBtn.addEventListener('click', async () => {
            if (!confirm(`Delete notebook "${notebookName}"?`)) return;
            try {
                const resp = await fetch(
                    `api/projects/${encodeURIComponent(projectId)}/notebooks/${encodeURIComponent(notebookName)}`,
                    { method: 'DELETE' }
                );
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    throw new Error(err.detail || 'Failed to delete notebook');
                }
                const nbNode = this._tree.findKey(`notebook:${projectId}:${notebookName}`);
                if (nbNode) nbNode.remove();
                if (this._callbacks.onNotebookDeleted) {
                    this._callbacks.onNotebookDeleted(projectId, notebookName);
                }
                this._showWelcomeDetail();
            } catch (err) {
                alert(`Error: ${err.message}`);
            }
        });
        actionBar.appendChild(delBtn);
        this._detailEl.appendChild(actionBar);
    }

    _showEnvDetail(envName, runtimeId, displayName) {
        this._detailEl.innerHTML = '';

        const title = displayName ? `${envName} (${displayName})` : envName;
        const header = this._createDetailHeader(title, 'fa-solid fa-cube');
        this._detailEl.appendChild(header);

        const isActive = this._activeVenvName === envName;
        const actions = document.createElement('div');
        actions.className = 'explorer-detail-actions';

        if (isActive) {
            const badge = document.createElement('span');
            badge.className = 'env-active-badge';
            badge.textContent = 'Active';
            actions.appendChild(badge);
        } else {
            const selectBtn = document.createElement('button');
            selectBtn.className = 'explorer-btn primary';
            selectBtn.textContent = 'Use This Environment';
            selectBtn.addEventListener('click', () => {
                this._activeVenvName = envName;
                if (this._callbacks.onVenvSelect) {
                    this._callbacks.onVenvSelect({ name: envName, runtimeId, displayName });
                }
                this._showEnvDetail(envName, runtimeId, displayName);
            });
            actions.appendChild(selectBtn);
        }

        const pkgBtn = document.createElement('button');
        pkgBtn.className = 'explorer-btn orange';
        pkgBtn.textContent = 'Manage Packages';
        pkgBtn.addEventListener('click', () => {
            this._showEnvPackages(envName, runtimeId);
        });
        actions.appendChild(pkgBtn);

        this._detailEl.appendChild(actions);

        // Bottom action bar
        const actionBar = this._createActionBar();
        const delBtn = document.createElement('button');
        delBtn.className = 'explorer-btn danger';
        delBtn.textContent = 'Delete Environment';
        delBtn.addEventListener('click', async () => {
            if (!confirm(`Delete environment "${envName}"?`)) return;
            try {
                await fetch(`api/envs/${runtimeId}/${envName}`, { method: 'DELETE' });
                if (this._callbacks.onVenvDeleted) {
                    this._callbacks.onVenvDeleted(envName);
                }
                const envNode = this._tree.findKey(`env:${runtimeId}:${envName}`);
                if (envNode) envNode.remove();
                this._showWelcomeDetail();
            } catch (err) {
                alert(`Error: ${err.message}`);
            }
        });
        actionBar.appendChild(delBtn);
        this._detailEl.appendChild(actionBar);
    }

    async _showEnvPackages(envName, runtimeId) {
        this._detailEl.innerHTML = '';

        const header = this._createDetailHeader(`${envName} — Packages`, 'fa-solid fa-box-open');
        this._detailEl.appendChild(header);

        const backBtn = document.createElement('button');
        backBtn.className = 'explorer-btn small';
        backBtn.textContent = '← Back';
        backBtn.addEventListener('click', () => {
            this._showEnvDetail(envName, runtimeId, this._getDisplayName(runtimeId));
        });
        this._detailEl.appendChild(backBtn);

        // Loading
        const loading = document.createElement('div');
        loading.className = 'venv-loading';
        loading.innerHTML = '<div class="spinner"></div><span>Loading packages...</span>';
        this._detailEl.appendChild(loading);

        const apiBase = `api/envs/${runtimeId}/${envName}/packages`;

        try {
            const resp = await fetch(apiBase);
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.detail || 'Failed to load packages');
            }
            const packages = await resp.json();

            loading.remove();

            // Install area
            const textarea = document.createElement('textarea');
            textarea.className = 'package-install-textarea';
            textarea.rows = 2;
            textarea.placeholder = 'Package names (e.g. numpy pandas)';
            this._detailEl.appendChild(textarea);

            const installRow = document.createElement('div');
            installRow.className = 'package-install-actions';

            const installBtn = document.createElement('button');
            installBtn.className = 'explorer-btn primary';
            installBtn.textContent = 'Install';

            const logArea = document.createElement('div');
            logArea.className = 'package-install-log';

            installBtn.addEventListener('click', () =>
                this._doInstall(textarea, installBtn, logArea, envName, runtimeId)
            );

            textarea.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    installBtn.click();
                }
            });

            const countLabel = document.createElement('span');
            countLabel.className = 'package-count';
            countLabel.textContent = `${packages.length} packages`;

            installRow.append(installBtn, countLabel);
            this._detailEl.appendChild(installRow);
            this._detailEl.appendChild(logArea);

            // Filter
            if (packages.length > 10) {
                const filterInput = document.createElement('input');
                filterInput.type = 'text';
                filterInput.className = 'package-filter-input';
                filterInput.placeholder = 'Filter packages...';
                filterInput.addEventListener('input', () => {
                    const q = filterInput.value.toLowerCase();
                    for (const li of list.children) {
                        const name = li.querySelector('.package-name')?.textContent?.toLowerCase() || '';
                        li.style.display = name.includes(q) ? '' : 'none';
                    }
                });
                this._detailEl.appendChild(filterInput);
            }

            // Package list
            const list = document.createElement('ul');
            list.className = 'package-list';
            for (const pkg of packages) {
                const li = document.createElement('li');
                li.className = 'package-item';

                const name = document.createElement('span');
                name.className = 'package-name';
                name.textContent = pkg.name;

                const version = document.createElement('span');
                version.className = 'package-version';
                version.textContent = pkg.version;

                li.append(name, version);

                const removeBtn = document.createElement('button');
                removeBtn.className = 'package-remove-btn';
                removeBtn.textContent = '\u00d7';
                removeBtn.title = `Uninstall ${pkg.name}`;
                removeBtn.addEventListener('click', async () => {
                    if (!confirm(`Uninstall ${pkg.name}?`)) return;
                    try {
                        const resp = await fetch(apiBase, {
                            method: 'DELETE',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ packages: [pkg.name] })
                        });
                        if (!resp.ok) throw new Error('Failed to uninstall');
                        this._showEnvPackages(envName, runtimeId);
                    } catch (err) {
                        alert(`Uninstall error: ${err.message}`);
                    }
                });
                li.appendChild(removeBtn);

                list.appendChild(li);
            }
            this._detailEl.appendChild(list);

        } catch (err) {
            loading.innerHTML = `<span>Error: ${err.message}</span>`;
        }
    }

    // --- Create actions ---

    async _createProject(nameInput, createBtn, errorEl) {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        errorEl.textContent = '';
        createBtn.disabled = true;
        createBtn.textContent = 'Creating...';
        try {
            const resp = await fetch('api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ project_id: name })
            });
            if (!resp.ok) {
                const err = await resp.json();
                throw new Error(err.detail || 'Failed to create project');
            }
            // Add to tree
            const projectsRoot = this._tree.findKey('root-projects');
            if (projectsRoot) {
                projectsRoot.addChildren([{
                    title: name,
                    key: `project:${name}`,
                    icon: 'fa-solid fa-folder',
                    folder: true,
                    lazy: true,
                }]);
                projectsRoot.setExpanded(true);
            }
            nameInput.value = '';
            // Show the new project's detail
            this._showProjectDetail(name);
            const newNode = this._tree.findKey(`project:${name}`);
            if (newNode) newNode.setActive(true, { noEvents: true });
        } catch (err) {
            errorEl.textContent = err.message;
        } finally {
            createBtn.disabled = false;
            createBtn.textContent = 'Create Project';
        }
    }

    async _createNotebook(projectId, nameInput, createBtn, errorEl) {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        errorEl.textContent = '';
        createBtn.disabled = true;
        createBtn.textContent = 'Creating...';
        try {
            const resp = await fetch(`api/projects/${encodeURIComponent(projectId)}/notebooks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            if (!resp.ok) {
                const err = await resp.json();
                throw new Error(err.detail || 'Failed to create notebook');
            }
            const nbName = name.endsWith('.ipynb') ? name : name + '.ipynb';
            // Add to tree under project
            const projectNode = this._tree.findKey(`project:${projectId}`);
            if (projectNode) {
                projectNode.addChildren([{
                    title: nbName,
                    key: `notebook:${projectId}:${nbName}`,
                    icon: 'fa-solid fa-file',
                }]);
                projectNode.setExpanded(true);
            }
            // Open it
            if (this._callbacks.onNotebookSelect) {
                this._callbacks.onNotebookSelect(projectId, nbName);
            }
            this.close();
        } catch (err) {
            errorEl.textContent = err.message;
        } finally {
            createBtn.disabled = false;
            createBtn.textContent = 'Create Notebook';
        }
    }

    async _createEnv(nameInput, reqInput, runtimeSelect, createBtn, errorEl) {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        const runtimeId = runtimeSelect.value;
        if (!runtimeId) { errorEl.textContent = 'No runtime selected'; return; }
        errorEl.textContent = '';
        const requirements = reqInput.value.trim()
            ? reqInput.value.trim().split('\n').map(s => s.trim()).filter(Boolean)
            : null;

        createBtn.disabled = true;
        createBtn.textContent = 'Creating...';
        try {
            const resp = await fetch('api/envs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ runtime_id: runtimeId, name, requirements })
            });
            if (!resp.ok) {
                const err = await resp.json();
                throw new Error(err.detail || 'Failed to create environment');
            }
            // Find display name from runtimes
            const rt = (this._runtimes || []).find(r => r.runtime_id === runtimeId);
            const displayName = rt ? rt.display_name : runtimeId;
            // Add to tree under the correct runtime node
            const runtimeNode = this._tree.findKey(`runtime:${runtimeId}`);
            if (runtimeNode) {
                runtimeNode.addChildren([{
                    title: name,
                    key: `env:${runtimeId}:${name}`,
                    icon: 'fa-solid fa-cube',
                }]);
                runtimeNode.setExpanded(true);
            }
            nameInput.value = '';
            reqInput.value = '';
            // Show the new env's detail
            this._showEnvDetail(name, runtimeId, displayName);
            const newNode = this._tree.findKey(`env:${runtimeId}:${name}`);
            if (newNode) newNode.setActive(true, { noEvents: true });
        } catch (err) {
            errorEl.textContent = err.message;
        } finally {
            createBtn.disabled = false;
            createBtn.textContent = 'Create Environment';
        }
    }

    // --- Install helper ---

    async _doInstall(textarea, installBtn, logArea, envName, runtimeId) {
        const tokens = this._parseInstallInput(textarea.value);
        if (!tokens.length) return;

        installBtn.disabled = true;
        installBtn.textContent = 'Installing...';
        logArea.className = 'package-install-log visible';
        logArea.textContent = `> pip install ${tokens.join(' ')}\n\nInstalling...`;

        const apiBase = `api/envs/${runtimeId}/${envName}/packages`;

        try {
            const resp = await fetch(apiBase, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ packages: tokens })
            });
            const result = await resp.json();

            if (!resp.ok) {
                logArea.className = 'package-install-log visible error';
                logArea.textContent = `> pip install ${tokens.join(' ')}\n\n${result.detail || 'Install failed'}`;
            } else {
                logArea.className = 'package-install-log visible';
                logArea.textContent = `> pip install ${tokens.join(' ')}\n\n${result.output || 'Done'}`;
                textarea.value = '';
                this._showEnvPackages(envName, runtimeId);
            }
        } catch (err) {
            logArea.className = 'package-install-log visible error';
            logArea.textContent = `Error: ${err.message}`;
        } finally {
            installBtn.disabled = false;
            installBtn.textContent = 'Install';
        }
    }

    _parseInstallInput(text) {
        let cleaned = text.replace(/^\s*(pip3?|python\s+-m\s+pip)\s+install\s+/i, '');
        const tokens = [];
        for (const line of cleaned.split('\n')) {
            const stripped = line.replace(/#.*$/, '').trim();
            if (!stripped) continue;
            if (stripped.startsWith('-r ') || stripped.startsWith('--requirement')) continue;
            tokens.push(...stripped.split(/\s+/));
        }
        return tokens;
    }

    // --- Helpers ---

    _getDisplayName(runtimeId) {
        const rt = (this._runtimes || []).find(r => r.runtime_id === runtimeId);
        return rt ? rt.display_name : runtimeId;
    }

    _createActionBar() {
        const bar = document.createElement('div');
        bar.className = 'explorer-action-bar';
        return bar;
    }

    _createEditableHeader(text, iconClass, onRename) {
        const wrapper = document.createElement('div');
        wrapper.className = 'explorer-detail-header explorer-editable-header';

        if (iconClass) {
            const icon = document.createElement('i');
            icon.className = iconClass;
            wrapper.appendChild(icon);
        }

        const nameSpan = document.createElement('span');
        nameSpan.className = 'explorer-header-name';
        nameSpan.textContent = text;
        wrapper.appendChild(nameSpan);

        const editBtn = document.createElement('i');
        editBtn.className = 'fa-solid fa-pen explorer-rename-icon';
        editBtn.title = 'Rename';
        wrapper.appendChild(editBtn);

        const startEdit = () => {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'explorer-rename-input';
            input.value = text;
            nameSpan.style.display = 'none';
            editBtn.style.display = 'none';
            wrapper.appendChild(input);
            input.focus();
            input.select();

            const commit = async () => {
                const newName = input.value.trim();
                if (!newName || newName === text) {
                    cancel();
                    return;
                }
                try {
                    await onRename(newName);
                } catch (err) {
                    alert(`Rename failed: ${err.message}`);
                    cancel();
                }
            };

            const cancel = () => {
                input.remove();
                nameSpan.style.display = '';
                editBtn.style.display = '';
            };

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); commit(); }
                if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            });
            input.addEventListener('blur', () => {
                // Small delay to allow click events to fire first
                setTimeout(() => { if (input.parentNode) commit(); }, 150);
            });
        };

        editBtn.addEventListener('click', startEdit);

        return wrapper;
    }

    async _renameProject(oldId, newId) {
        const resp = await fetch(`api/projects/${encodeURIComponent(oldId)}/rename`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_id: newId })
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || 'Failed to rename project');
        }
        // Update tree node
        const node = this._tree.findKey(`project:${oldId}`);
        if (node) {
            node.title = newId;
            node.key = `project:${newId}`;
            node.update();
            // Update child notebook keys
            node.visit(child => {
                if (child.key && child.key.startsWith(`notebook:${oldId}:`)) {
                    const nbName = child.key.replace(`notebook:${oldId}:`, '');
                    child.key = `notebook:${newId}:${nbName}`;
                }
            });
        }
        if (this._callbacks.onProjectRenamed) {
            this._callbacks.onProjectRenamed(oldId, newId);
        }
        // Refresh detail with new name
        this._showProjectDetail(newId);
        const newNode = this._tree.findKey(`project:${newId}`);
        if (newNode) newNode.setActive(true, { noEvents: true });
    }

    async _renameNotebook(projectId, oldName, newName) {
        if (!newName.endsWith('.ipynb')) newName += '.ipynb';
        const resp = await fetch(
            `api/projects/${encodeURIComponent(projectId)}/notebooks/${encodeURIComponent(oldName)}/rename`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ new_name: newName })
            }
        );
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || 'Failed to rename notebook');
        }
        // Update tree node
        const node = this._tree.findKey(`notebook:${projectId}:${oldName}`);
        if (node) {
            node.title = newName;
            node.key = `notebook:${projectId}:${newName}`;
            node.update();
        }
        if (this._callbacks.onNotebookRenamed) {
            this._callbacks.onNotebookRenamed(projectId, oldName, newName);
        }
        // Refresh detail with new name
        this._showNotebookDetail(projectId, newName);
        const newNode = this._tree.findKey(`notebook:${projectId}:${newName}`);
        if (newNode) newNode.setActive(true, { noEvents: true });
    }

    _createDetailHeader(text, iconClass = null) {
        const h = document.createElement('div');
        h.className = 'explorer-detail-header';
        if (iconClass) {
            const icon = document.createElement('i');
            icon.className = iconClass;
            h.appendChild(icon);
            h.appendChild(document.createTextNode(text));
        } else {
            h.textContent = text;
        }
        return h;
    }
}
