/**
 * VenvPanel - Slide-out panel for managing virtual environments.
 */
export class VenvPanel {
    /**
     * @param {HTMLElement} containerEl
     * @param {object} callbacks - { onVenvCreated, onVenvDeleted }
     */
    constructor(containerEl, callbacks = {}) {
        this._container = containerEl;
        this._callbacks = callbacks;
        this._projectId = null;
        this._isOpen = false;
        this._selectedVenv = null;
        this._selectedVenvType = null;

        this._build();
    }

    _build() {
        this._panel = document.createElement('div');
        this._panel.className = 'venv-panel';

        // Header
        const header = document.createElement('div');
        header.className = 'venv-panel-header';
        const title = document.createElement('h3');
        title.textContent = 'Virtual Environments';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'venv-panel-close';
        closeBtn.textContent = 'x';
        closeBtn.addEventListener('click', () => this.close());
        header.append(title, closeBtn);

        // Display settings
        const settings = document.createElement('div');
        settings.className = 'venv-panel-settings';

        const settingsTitle = document.createElement('div');
        settingsTitle.className = 'venv-section-title';
        settingsTitle.textContent = 'Display';

        const sliderRow = document.createElement('div');
        sliderRow.className = 'settings-slider-row';

        const sliderLabel = document.createElement('label');
        sliderLabel.textContent = 'Cell Width';

        const sliderValue = document.createElement('span');
        sliderValue.className = 'settings-slider-value';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '500';
        slider.step = '10';
        slider.className = 'settings-slider';

        const getMaxWidth = () => {
            const container = document.getElementById('notebook-container');
            return container ? container.clientWidth - 80 : 1800;
        };

        const applyWidth = (val) => {
            const max = parseInt(slider.max, 10);
            const isFull = val >= max;
            sliderValue.textContent = isFull ? 'Full' : `${val}px`;
            document.documentElement.style.setProperty('--notebook-max-width', isFull ? 'none' : `${val}px`);
        };

        slider.max = String(getMaxWidth());

        const saved = localStorage.getItem('notebook-cell-width');
        const initial = saved ? Math.min(parseInt(saved, 10), getMaxWidth()) : 960;
        slider.value = String(initial);
        applyWidth(initial);

        slider.addEventListener('input', () => {
            const val = parseInt(slider.value, 10);
            applyWidth(val);
            localStorage.setItem('notebook-cell-width', String(val));
        });

        window.addEventListener('resize', () => {
            slider.max = String(getMaxWidth());
        });

        sliderRow.append(sliderLabel, sliderValue);
        settings.append(settingsTitle, sliderRow, slider);

        // Body
        this._body = document.createElement('div');
        this._body.className = 'venv-panel-body';

        this._panel.append(header, settings, this._body);
        this._container.appendChild(this._panel);
    }

    get isOpen() { return this._isOpen; }

    setProjectId(projectId) {
        this._projectId = projectId;
    }

    open() {
        this._isOpen = true;
        this._panel.classList.add('open');
        this._refresh();
    }

    close() {
        this._isOpen = false;
        this._panel.classList.remove('open');
    }

    toggle() {
        if (this._isOpen) this.close();
        else this.open();
    }

    async _refresh() {
        this._body.innerHTML = '';

        // Create venv form
        this._body.appendChild(this._buildCreateForm());

        // Loading
        const loading = document.createElement('div');
        loading.className = 'venv-loading';
        loading.innerHTML = '<div class="spinner"></div><span>Loading...</span>';
        this._body.appendChild(loading);

        try {
            // Project venvs
            if (this._projectId) {
                const resp = await fetch(`/api/projects/${this._projectId}/venvs`);
                const projectVenvs = await resp.json();
                loading.remove();
                if (projectVenvs.length > 0) {
                    this._body.appendChild(
                        this._buildVenvSection('Project Environments', projectVenvs, 'project')
                    );
                }
            }

            // Shared venvs
            const resp = await fetch('/api/venvs');
            const sharedVenvs = await resp.json();
            if (this._body.contains(loading)) loading.remove();
            if (sharedVenvs.length > 0) {
                this._body.appendChild(
                    this._buildVenvSection('Shared Environments', sharedVenvs, 'shared')
                );
            }
        } catch (err) {
            loading.innerHTML = `<span>Error loading venvs: ${err.message}</span>`;
        }
    }

    _buildCreateForm() {
        const form = document.createElement('div');
        form.className = 'venv-create-form';

        const nameLabel = document.createElement('label');
        nameLabel.textContent = 'New Environment Name';
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
        typeSelect.innerHTML = `
            <option value="project">Project</option>
            <option value="shared">Shared</option>
        `;

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
                let url;
                if (scope === 'project' && this._projectId) {
                    url = `/api/projects/${this._projectId}/venvs`;
                } else {
                    url = '/api/venvs';
                }
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

    _buildVenvSection(title, venvs, type) {
        const section = document.createElement('div');
        section.className = 'venv-section';

        const titleEl = document.createElement('div');
        titleEl.className = 'venv-section-title';
        titleEl.textContent = title;
        section.appendChild(titleEl);

        for (const v of venvs) {
            const item = document.createElement('div');
            item.className = 'venv-item';
            if (this._selectedVenv === v.name && this._selectedVenvType === type) {
                item.classList.add('active');
            }

            const info = document.createElement('div');
            const nameEl = document.createElement('div');
            nameEl.className = 'venv-item-name';
            nameEl.textContent = v.name;
            info.appendChild(nameEl);

            const actions = document.createElement('div');
            actions.className = 'venv-item-actions';

            const pkgBtn = document.createElement('button');
            pkgBtn.textContent = 'Packages';
            pkgBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._showPackages(v.name, type, item);
            });

            const delBtn = document.createElement('button');
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm(`Delete environment "${v.name}"?`)) return;
                try {
                    let url;
                    if (type === 'project' && this._projectId) {
                        url = `/api/projects/${this._projectId}/venvs/${v.name}`;
                    } else {
                        url = `/api/venvs/${v.name}`;
                    }
                    await fetch(url, { method: 'DELETE' });
                    await this._refresh();
                    if (this._callbacks.onVenvDeleted) this._callbacks.onVenvDeleted();
                } catch (err) {
                    alert(`Error: ${err.message}`);
                }
            });

            actions.append(pkgBtn, delBtn);
            item.append(info, actions);
            section.appendChild(item);
        }

        return section;
    }

    async _showPackages(venvName, type, parentEl) {
        // Toggle - remove if already showing
        const existing = parentEl.querySelector('.package-detail');
        if (existing) {
            existing.remove();
            return;
        }

        const detail = document.createElement('div');
        detail.className = 'package-detail';
        detail.style.width = '100%';
        detail.style.marginTop = '8px';

        const loading = document.createElement('div');
        loading.className = 'venv-loading';
        loading.innerHTML = '<div class="spinner"></div><span>Loading packages...</span>';
        detail.appendChild(loading);
        parentEl.appendChild(detail);

        try {
            let url;
            if (type === 'project' && this._projectId) {
                url = `/api/projects/${this._projectId}/venvs/${venvName}/packages`;
            } else {
                url = `/api/venvs/${venvName}/packages`;
            }
            const resp = await fetch(url);
            const packages = await resp.json();

            detail.innerHTML = '';

            // Install form
            const installForm = document.createElement('div');
            installForm.className = 'package-install-form';
            const installInput = document.createElement('input');
            installInput.type = 'text';
            installInput.placeholder = 'Package name (e.g. numpy)';
            const installBtn = document.createElement('button');
            installBtn.className = 'primary';
            installBtn.textContent = 'Install';
            installBtn.addEventListener('click', async () => {
                const pkg = installInput.value.trim();
                if (!pkg) return;
                installBtn.disabled = true;
                installBtn.textContent = 'Installing...';
                try {
                    let pkgUrl;
                    if (type === 'project' && this._projectId) {
                        pkgUrl = `/api/projects/${this._projectId}/venvs/${venvName}/packages`;
                    } else {
                        pkgUrl = `/api/venvs/${venvName}/packages`;
                    }
                    await fetch(pkgUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ packages: [pkg] })
                    });
                    installInput.value = '';
                    await this._showPackages(venvName, type, parentEl);
                    await this._showPackages(venvName, type, parentEl);
                } catch (err) {
                    alert(`Install error: ${err.message}`);
                } finally {
                    installBtn.disabled = false;
                    installBtn.textContent = 'Install';
                }
            });
            installForm.append(installInput, installBtn);
            detail.appendChild(installForm);

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
                list.appendChild(li);
            }
            detail.appendChild(list);

        } catch (err) {
            detail.innerHTML = `<span>Error: ${err.message}</span>`;
        }
    }
}
