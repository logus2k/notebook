/**
 * EnvironmentPanel - Unified jsPanel for selecting and managing virtual environments.
 * Combines environment selection (clicking to activate) with management (packages, create, delete).
 */
export class EnvironmentPanel {
    /**
     * @param {object} callbacks - { onVenvSelect(venvRef), onVenvCreated(), onVenvDeleted() }
     */
    constructor(callbacks = {}) {
        this._callbacks = callbacks;
        this._panel = null;
        this._projectId = null;
        this._activeVenv = null; // "type:name" string
    }

    setProjectId(projectId) {
        this._projectId = projectId;
    }

    /**
     * @param {string|null} activeVenv - "type:name" key of the currently active venv
     */
    open(activeVenv) {
        this._activeVenv = activeVenv || this._activeVenv;

        if (this._panel) {
            this._panel.front();
            this._refresh();
            return;
        }

        this._panel = jsPanel.create({
            id: 'environment-panel',
            headerTitle: 'Environments',
            theme: 'none',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            boxShadow: 3,
            position: 'center',
            panelSize: { width: 500, height: 550 },
            headerControls: { minimize: 'remove', smallify: 'remove', normalize: 'remove', maximize: 'remove' },
            onclosed: () => { this._panel = null; },
            callback: (panel) => {
                this._panel = panel;
                panel.content.style.overflowY = 'auto';
                panel.content.style.padding = '0';
                this._refresh();
            }
        });
    }

    close() {
        if (this._panel) {
            this._panel.close();
            this._panel = null;
        }
    }

    async _refresh() {
        if (!this._panel) return;
        const content = this._panel.content;
        content.innerHTML = '';

        // Loading
        const loading = document.createElement('div');
        loading.className = 'venv-loading';
        loading.innerHTML = '<div class="spinner"></div><span>Loading...</span>';
        content.appendChild(loading);

        try {
            let projectVenvs = [];
            let sharedVenvs = [];
            let defaultEnv = null;

            const fetches = [fetch('api/venvs')];
            if (this._projectId) {
                fetches.unshift(fetch(`api/projects/${this._projectId}/venvs`));
            }
            const responses = await Promise.all(fetches);

            let allShared;
            if (this._projectId) {
                projectVenvs = await responses[0].json();
                allShared = await responses[1].json();
            } else {
                allShared = await responses[0].json();
            }

            // Separate default from shared
            for (const v of allShared) {
                if (v.type === 'default') {
                    defaultEnv = v;
                } else {
                    sharedVenvs.push(v);
                }
            }

            loading.remove();

            // Venv list (selectable)
            const listSection = document.createElement('div');
            listSection.style.padding = '0';

            // Default environment
            if (defaultEnv) {
                listSection.appendChild(this._buildVenvItem(defaultEnv, 'default'));
            }

            // Project environments
            if (projectVenvs.length > 0) {
                const header = document.createElement('div');
                header.className = 'panel-section-header';
                header.textContent = 'Project';
                listSection.appendChild(header);
                for (const v of projectVenvs) {
                    listSection.appendChild(this._buildVenvItem(v, 'project'));
                }
            }

            // Shared environments
            if (sharedVenvs.length > 0) {
                const header = document.createElement('div');
                header.className = 'panel-section-header';
                header.textContent = 'Shared';
                listSection.appendChild(header);
                for (const v of sharedVenvs) {
                    listSection.appendChild(this._buildVenvItem(v, 'shared'));
                }
            }

            content.appendChild(listSection);

            // Divider + Create form (collapsible)
            const createToggle = document.createElement('div');
            createToggle.className = 'env-create-toggle';
            createToggle.innerHTML = '<span>+ New Environment</span>';
            content.appendChild(createToggle);

            const formWrapper = document.createElement('div');
            formWrapper.className = 'env-create-wrapper collapsed';
            formWrapper.appendChild(this._buildCreateForm());
            content.appendChild(formWrapper);

            createToggle.addEventListener('click', () => {
                formWrapper.classList.toggle('collapsed');
                createToggle.classList.toggle('expanded');
            });

        } catch (err) {
            loading.innerHTML = `<span>Error loading environments: ${err.message}</span>`;
        }
    }

    _buildVenvItem(venv, type) {
        const ref = `${type}:${venv.name}`;
        const isActive = this._activeVenv === ref;

        const item = document.createElement('div');
        item.className = 'env-item' + (isActive ? ' active' : '');
        item.style.flexWrap = 'wrap';

        // Main row (clickable for selection)
        const mainRow = document.createElement('div');
        mainRow.className = 'env-item-main';
        mainRow.addEventListener('click', () => this._onSelect({
            type, name: venv.name, pythonVersion: venv.python_version || null
        }));

        const info = document.createElement('div');
        info.className = 'env-item-info';

        const nameEl = document.createElement('span');
        nameEl.className = 'env-item-name';
        nameEl.textContent = venv.name;
        info.appendChild(nameEl);

        if (venv.python_version) {
            const meta = document.createElement('span');
            meta.className = 'env-item-meta';
            const parts = venv.python_version.split('.');
            meta.textContent = `Python ${parts.length >= 2 ? parts[0] + '.' + parts[1] : venv.python_version}`;
            info.appendChild(meta);
        }

        if (isActive) {
            const badge = document.createElement('span');
            badge.className = 'env-active-badge';
            badge.textContent = 'Active';
            info.appendChild(badge);
        }

        mainRow.appendChild(info);

        // Action buttons
        const actions = document.createElement('div');
        actions.className = 'env-item-actions';

        const pkgBtn = document.createElement('button');
        pkgBtn.textContent = 'Packages';
        pkgBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._togglePackages(venv.name, type, venv.readonly, item);
        });
        actions.appendChild(pkgBtn);

        if (!venv.readonly) {
            const delBtn = document.createElement('button');
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm(`Delete environment "${venv.name}"?`)) return;
                try {
                    const url = (type === 'project' && this._projectId)
                        ? `api/projects/${this._projectId}/venvs/${venv.name}`
                        : `api/venvs/${venv.name}`;
                    await fetch(url, { method: 'DELETE' });
                    await this._refresh();
                    if (this._callbacks.onVenvDeleted) this._callbacks.onVenvDeleted({ type, name: venv.name });
                } catch (err) {
                    alert(`Error: ${err.message}`);
                }
            });
            actions.appendChild(delBtn);
        }

        mainRow.appendChild(actions);
        item.appendChild(mainRow);
        return item;
    }

    _onSelect(venvRef) {
        const ref = `${venvRef.type}:${venvRef.name}`;
        this._activeVenv = ref;
        if (this._callbacks.onVenvSelect) {
            this._callbacks.onVenvSelect(venvRef);
        }
        this._refresh(); // Re-render to update active indicator
    }

    _buildCreateForm() {
        const form = document.createElement('div');
        form.className = 'venv-create-form';

        const nameLabel = document.createElement('label');
        nameLabel.textContent = 'Name';
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = 'e.g. ml-env';

        const reqLabel = document.createElement('label');
        reqLabel.textContent = 'Requirements (one per line, optional)';
        const reqInput = document.createElement('textarea');
        reqInput.placeholder = 'numpy\npandas\nmatplotlib';

        const typeLabel = document.createElement('label');
        typeLabel.textContent = 'Scope';
        const typeSelect = document.createElement('select');
        const hasProject = !!this._projectId;
        typeSelect.innerHTML = hasProject
            ? '<option value="project">Project</option><option value="shared">Shared</option>'
            : '<option value="project" disabled>Project (no project open)</option><option value="shared" selected>Shared</option>';

        const createBtn = document.createElement('button');
        createBtn.className = 'primary';
        createBtn.textContent = 'Create Environment';
        createBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            if (!name) return;
            const requirements = reqInput.value.trim()
                ? reqInput.value.trim().split('\n').map(l => l.trim()).filter(Boolean)
                : null;
            const scope = typeSelect.value;

            createBtn.disabled = true;
            createBtn.textContent = 'Creating...';

            try {
                const url = (scope === 'project' && this._projectId)
                    ? `api/projects/${this._projectId}/venvs`
                    : 'api/venvs';
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, requirements })
                });
                if (!resp.ok) {
                    const err = await resp.json();
                    throw new Error(err.detail || 'Failed to create venv');
                }
                nameInput.value = '';
                reqInput.value = '';
                await this._refresh();
                if (this._callbacks.onVenvCreated) this._callbacks.onVenvCreated();
            } catch (err) {
                alert(`Error: ${err.message}`);
            } finally {
                createBtn.disabled = false;
                createBtn.textContent = 'Create Environment';
            }
        });

        form.append(nameLabel, nameInput, reqLabel, reqInput, typeLabel, typeSelect, createBtn);
        return form;
    }

    // --- Package Management ---

    async _togglePackages(venvName, type, readonly, parentEl) {
        const existing = parentEl.querySelector('.package-detail');
        if (existing) {
            existing.remove();
            return;
        }

        const detail = document.createElement('div');
        detail.className = 'package-detail';
        parentEl.appendChild(detail);

        await this._renderPackages(detail, venvName, type, readonly);
    }

    async _renderPackages(detail, venvName, type, readonly) {
        detail.innerHTML = '';

        const loading = document.createElement('div');
        loading.className = 'venv-loading';
        loading.innerHTML = '<div class="spinner"></div><span>Loading packages...</span>';
        detail.appendChild(loading);

        try {
            const url = (type === 'project' && this._projectId)
                ? `api/projects/${this._projectId}/venvs/${venvName}/packages`
                : `api/venvs/${venvName}/packages`;
            const resp = await fetch(url);
            if (!resp.ok) {
                const err = await resp.json();
                throw new Error(err.detail || 'Failed to load packages');
            }
            const packages = await resp.json();

            detail.innerHTML = '';

            // Install textarea
            const textarea = document.createElement('textarea');
            textarea.className = 'package-install-textarea';
            textarea.rows = 3;
            textarea.placeholder = 'Package names, pip args, or paste requirements\ne.g. numpy pandas\ne.g. torch --index-url https://download.pytorch.org/whl/cu130';
            textarea.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    installBtn.click();
                }
            });
            detail.appendChild(textarea);

            // Action row
            const actionsRow = document.createElement('div');
            actionsRow.className = 'package-install-actions';

            const installBtn = document.createElement('button');
            installBtn.className = 'primary';
            installBtn.textContent = 'Install';
            installBtn.addEventListener('click', () => this._doInstall(textarea, installBtn, logArea, detail, venvName, type, readonly));

            const uploadBtn = document.createElement('button');
            uploadBtn.textContent = 'Upload requirements.txt';
            uploadBtn.addEventListener('click', () => {
                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.accept = '.txt,.pip';
                fileInput.addEventListener('change', async () => {
                    const file = fileInput.files[0];
                    if (!file) return;
                    textarea.value = await file.text();
                });
                fileInput.click();
            });

            const countLabel = document.createElement('span');
            countLabel.className = 'package-count';
            countLabel.textContent = `${packages.length} packages installed`;

            actionsRow.append(installBtn, uploadBtn, countLabel);
            detail.appendChild(actionsRow);

            // Log area (hidden by default)
            const logArea = document.createElement('div');
            logArea.className = 'package-install-log';
            detail.appendChild(logArea);

            // Filter input (shown when >10 packages)
            let filterInput = null;
            if (packages.length > 10) {
                filterInput = document.createElement('input');
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
                detail.appendChild(filterInput);
            }

            // Package list
            const list = document.createElement('ul');
            list.className = 'package-list';
            this._populatePackageList(list, packages, venvName, type, readonly, detail);
            detail.appendChild(list);

        } catch (err) {
            detail.innerHTML = `<span>Error: ${err.message}</span>`;
        }
    }

    _populatePackageList(list, packages, venvName, type, readonly, detail) {
        list.innerHTML = '';
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

            if (!readonly) {
                const removeBtn = document.createElement('button');
                removeBtn.className = 'package-remove-btn';
                removeBtn.textContent = '\u00d7';
                removeBtn.title = `Uninstall ${pkg.name}`;
                removeBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (!confirm(`Uninstall ${pkg.name}?`)) return;
                    try {
                        const url = (type === 'project' && this._projectId)
                            ? `api/projects/${this._projectId}/venvs/${venvName}/packages`
                            : `api/venvs/${venvName}/packages`;
                        const resp = await fetch(url, {
                            method: 'DELETE',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ packages: [pkg.name] })
                        });
                        if (!resp.ok) throw new Error('Failed to uninstall');
                        await this._renderPackages(detail, venvName, type, readonly);
                    } catch (err) {
                        alert(`Uninstall error: ${err.message}`);
                    }
                });
                li.appendChild(removeBtn);
            }

            list.appendChild(li);
        }
    }

    _parseInstallInput(text) {
        // Strip pip/pip3 install prefix
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

    async _doInstall(textarea, installBtn, logArea, detail, venvName, type, readonly) {
        const tokens = this._parseInstallInput(textarea.value);
        if (!tokens.length) return;

        installBtn.disabled = true;
        installBtn.textContent = 'Installing...';
        logArea.className = 'package-install-log visible';
        logArea.textContent = `> pip install ${tokens.join(' ')}\n\nInstalling...`;

        try {
            const url = (type === 'project' && this._projectId)
                ? `api/projects/${this._projectId}/venvs/${venvName}/packages`
                : `api/venvs/${venvName}/packages`;
            const resp = await fetch(url, {
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
                await this._renderPackages(detail, venvName, type, readonly);
            }
        } catch (err) {
            logArea.className = 'package-install-log visible error';
            logArea.textContent = `> pip install ${tokens.join(' ')}\n\nError: ${err.message}`;
        } finally {
            installBtn.disabled = false;
            installBtn.textContent = 'Install';
        }
    }
}
