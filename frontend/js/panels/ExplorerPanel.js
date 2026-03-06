/**
 * ExplorerPanel - Unified jsPanel with Wunderbaum tree (left) and detail pane (right).
 * Two root branches: Projects (with notebooks) and Environments.
 */
export class ExplorerPanel {
    /**
     * @param {object} callbacks
     *   onNotebookSelect(projectId, notebookName)
     *   onVenvSelect({ name, pythonVersion })
     *   onVenvDeleted(name)
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
     */
    open(opts = {}) {
        const { currentProject = null, currentNotebook = null, navigateToVenv = null } = opts;
        this._currentProject = currentProject;
        this._currentNotebook = currentNotebook;
        this._navigateToVenvName = navigateToVenv;

        if (this._panel) {
            this._panel.front();
            if (navigateToVenv) {
                this._navigateToVenv(navigateToVenv);
            } else {
                this._navigateToCurrentNotebook();
            }
            return;
        }

        this._panel = jsPanel.create({
            id: 'explorer-panel',
            headerTitle: 'Explorer',
            theme: 'none',
            borderRadius: '8px',
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
        closeBtn.className = 'explorer-btn explorer-close-btn';
        closeBtn.textContent = 'Close';
        closeBtn.addEventListener('click', () => this.close());
        right.appendChild(closeBtn);

        this._showWelcomeDetail();

        container.append(left, right);

        // Initialize resizable splitter
        Split([left, right], {
            sizes: [36, 64],
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
        // Fetch both projects and environments in parallel
        const [projectsResp, envsResp] = await Promise.all([
            fetch('api/projects'),
            fetch('api/venvs')
        ]);

        const projects = await projectsResp.json();
        const envs = await envsResp.json();

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
                children: envs.map(v => ({
                    title: v.name,
                    key: `env:${v.name}`,
                    icon: 'fa-solid fa-cube',
                    data: { pythonVersion: v.python_version },
                }))
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
                            title: nb.name.replace(/\.ipynb$/, ''),
                            key: `notebook:${projectId}:${nb.name}`,
                            icon: 'fa-solid fa-file-code',
                        }));
                    } catch {
                        return [];
                    }
                }
                return [];
            },
            click: (e) => {
                const node = e.node;
                const key = node.key || '';

                if (e.targetType === 'expander') return;

                // Root nodes: toggle expand + show detail
                if (key === 'root-projects') {
                    node.setExpanded(!node.isExpanded());
                    node.setActive(true, { noEvents: true });
                    this._showProjectsRootDetail();
                    return false;
                }
                if (key === 'root-envs') {
                    node.setExpanded(!node.isExpanded());
                    node.setActive(true, { noEvents: true });
                    this._showEnvsRootDetail();
                    return false;
                }

                // Project node: toggle expand (lazy-loads notebooks)
                if (key.startsWith('project:')) {
                    node.setExpanded(!node.isExpanded());
                    const projectId = key.replace('project:', '');
                    this._showProjectDetail(projectId);
                    node.setActive(true, { noEvents: true });
                    return false;
                }

                // Notebook node: select it
                if (key.startsWith('notebook:')) {
                    const parts = key.replace('notebook:', '').split(':');
                    const projectId = parts[0];
                    const notebookName = parts.slice(1).join(':');
                    node.setActive(true, { noEvents: true });
                    this._showNotebookDetail(projectId, notebookName);
                    if (this._autoLoad && this._callbacks.onNotebookSelect) {
                        this._callbacks.onNotebookSelect(projectId, notebookName);
                    }
                    return false;
                }

                // Environment node: show detail
                if (key.startsWith('env:')) {
                    const envName = key.replace('env:', '');
                    node.setActive(true, { noEvents: true });
                    this._showEnvDetail(envName, node.data?.pythonVersion);
                    return false;
                }
            }
        });

        if (this._navigateToVenvName) {
            this._navigateToVenv(this._navigateToVenvName);
        } else {
            this._navigateToCurrentNotebook();
        }
    }

    _navigateToVenv(envName) {
        if (!this._tree) return;
        const envsRoot = this._tree.findKey('root-envs');
        if (envsRoot && !envsRoot.isExpanded()) {
            envsRoot.setExpanded(true);
        }
        const envNode = this._tree.findKey(`env:${envName}`);
        if (envNode) {
            envNode.setActive(true, { noEvents: true });
            this._showEnvDetail(envName, envNode.data?.pythonVersion);
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

    // --- Detail views ---

    _showProjectsRootDetail() {
        this._detailEl.innerHTML = '';

        const header = this._createDetailHeader('Projects');
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

        const header = this._createDetailHeader('Environments');
        this._detailEl.appendChild(header);

        const form = document.createElement('div');
        form.className = 'explorer-create-form';

        const nameLabel = document.createElement('label');
        nameLabel.textContent = 'New Environment';
        form.appendChild(nameLabel);

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
        createBtn.addEventListener('click', () => this._createEnv(nameInput, reqInput, createBtn, errorEl));
        form.appendChild(createBtn);

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') createBtn.click();
        });

        this._detailEl.appendChild(form);
        nameInput.focus();
    }

    _showProjectDetail(projectId) {
        this._detailEl.innerHTML = '';

        const header = this._createDetailHeader(`📁 ${projectId}`);
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
        nameInput.focus();
    }

    async _showNotebookDetail(projectId, notebookName) {
        this._detailEl.innerHTML = '';

        const displayName = notebookName.replace(/\.ipynb$/, '');
        const header = this._createDetailHeader(`📓 ${displayName}`);
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

            // Description preview (first markdown cell)
            if (summary.description) {
                const descEl = document.createElement('div');
                descEl.className = 'explorer-nb-description';
                descEl.textContent = summary.description;
                this._detailEl.appendChild(descEl);
            }
        } catch {
            // Summary is optional — fail silently
        }
    }

    _showEnvDetail(envName, pythonVersion) {
        this._detailEl.innerHTML = '';

        const header = this._createDetailHeader(`🔧 ${envName}`);
        this._detailEl.appendChild(header);

        if (pythonVersion) {
            const parts = pythonVersion.split('.');
            const meta = document.createElement('div');
            meta.className = 'explorer-detail-meta';
            meta.textContent = `Python ${parts.length >= 2 ? parts[0] + '.' + parts[1] : pythonVersion}`;
            this._detailEl.appendChild(meta);
        }

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
                    this._callbacks.onVenvSelect({ name: envName, pythonVersion });
                }
                this._showEnvDetail(envName, pythonVersion);
            });
            actions.appendChild(selectBtn);
        }

        const pkgBtn = document.createElement('button');
        pkgBtn.className = 'explorer-btn';
        pkgBtn.textContent = 'Manage Packages';
        pkgBtn.addEventListener('click', () => {
            this._showEnvPackages(envName);
        });
        actions.appendChild(pkgBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'explorer-btn danger';
        delBtn.textContent = 'Delete Environment';
        delBtn.addEventListener('click', async () => {
            if (!confirm(`Delete environment "${envName}"?`)) return;
            try {
                await fetch(`api/venvs/${envName}`, { method: 'DELETE' });
                if (this._callbacks.onVenvDeleted) {
                    this._callbacks.onVenvDeleted(envName);
                }
                // Remove from tree
                const envNode = this._tree.findKey(`env:${envName}`);
                if (envNode) envNode.remove();
                this._showWelcomeDetail();
            } catch (err) {
                alert(`Error: ${err.message}`);
            }
        });
        actions.appendChild(delBtn);

        this._detailEl.appendChild(actions);
    }

    async _showEnvPackages(envName) {
        this._detailEl.innerHTML = '';

        const header = this._createDetailHeader(`📦 ${envName} — Packages`);
        this._detailEl.appendChild(header);

        const backBtn = document.createElement('button');
        backBtn.className = 'explorer-btn small';
        backBtn.textContent = '← Back';
        backBtn.addEventListener('click', () => {
            const envNode = this._tree.findKey(`env:${envName}`);
            const pv = envNode?.data?.pythonVersion || null;
            this._showEnvDetail(envName, pv);
        });
        this._detailEl.appendChild(backBtn);

        // Loading
        const loading = document.createElement('div');
        loading.className = 'venv-loading';
        loading.innerHTML = '<div class="spinner"></div><span>Loading packages...</span>';
        this._detailEl.appendChild(loading);

        try {
            const resp = await fetch(`api/venvs/${envName}/packages`);
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
                this._doInstall(textarea, installBtn, logArea, envName)
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
                        const resp = await fetch(`api/venvs/${envName}/packages`, {
                            method: 'DELETE',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ packages: [pkg.name] })
                        });
                        if (!resp.ok) throw new Error('Failed to uninstall');
                        this._showEnvPackages(envName);
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
                    title: nbName.replace(/\.ipynb$/, ''),
                    key: `notebook:${projectId}:${nbName}`,
                    icon: 'fa-solid fa-file-code',
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

    async _createEnv(nameInput, reqInput, createBtn, errorEl) {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        errorEl.textContent = '';
        const requirements = reqInput.value.trim()
            ? reqInput.value.trim().split('\n').map(s => s.trim()).filter(Boolean)
            : null;

        createBtn.disabled = true;
        createBtn.textContent = 'Creating...';
        try {
            const resp = await fetch('api/venvs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, requirements })
            });
            if (!resp.ok) {
                const err = await resp.json();
                throw new Error(err.detail || 'Failed to create environment');
            }
            // Add to tree
            const envsRoot = this._tree.findKey('root-envs');
            if (envsRoot) {
                envsRoot.addChildren([{
                    title: name,
                    key: `env:${name}`,
                    icon: 'fa-solid fa-cube',
                    data: { pythonVersion: null },
                }]);
                envsRoot.setExpanded(true);
            }
            nameInput.value = '';
            reqInput.value = '';
            // Show the new env's detail
            this._showEnvDetail(name, null);
            const newNode = this._tree.findKey(`env:${name}`);
            if (newNode) newNode.setActive(true, { noEvents: true });
        } catch (err) {
            errorEl.textContent = err.message;
        } finally {
            createBtn.disabled = false;
            createBtn.textContent = 'Create Environment';
        }
    }

    // --- Install helper ---

    async _doInstall(textarea, installBtn, logArea, envName) {
        const tokens = this._parseInstallInput(textarea.value);
        if (!tokens.length) return;

        installBtn.disabled = true;
        installBtn.textContent = 'Installing...';
        logArea.className = 'package-install-log visible';
        logArea.textContent = `> pip install ${tokens.join(' ')}\n\nInstalling...`;

        try {
            const resp = await fetch(`api/venvs/${envName}/packages`, {
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
                this._showEnvPackages(envName);
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

    _createDetailHeader(text) {
        const h = document.createElement('div');
        h.className = 'explorer-detail-header';
        h.textContent = text;
        return h;
    }
}
