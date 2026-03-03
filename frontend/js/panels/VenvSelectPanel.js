/**
 * VenvSelectPanel - jsPanel floating panel for virtual environment selection.
 */
export class VenvSelectPanel {
    /**
     * @param {object} callbacks - { onVenvSelect(venvRef), onManageClick() }
     */
    constructor(callbacks = {}) {
        this._callbacks = callbacks;
        this._panel = null;
        this._projectId = null;
        this._activeVenv = null; // "type:name" string
    }

    async open(projectId, activeVenv) {
        this._projectId = projectId;
        this._activeVenv = activeVenv;

        if (this._panel) {
            this._panel.front();
            this._refresh();
            return;
        }

        this._panel = jsPanel.create({
            id: 'venv-select-panel',
            headerTitle: 'Environments',
            theme: 'none',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            boxShadow: 3,
            position: { my: 'right-top', at: 'right-top', offsetX: -20, offsetY: 100 },
            panelSize: { width: 320, height: 400 },
            headerControls: { minimize: 'remove', smallify: 'remove', normalize: 'remove', maximize: 'remove' },
            onclosed: () => { this._panel = null; },
            callback: (panel) => {
                this._panel = panel;
                panel.content.innerHTML = '<div class="panel-loading">Loading...</div>';
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

        let projectVenvs = [];
        let sharedVenvs = [];

        try {
            const fetches = [fetch('api/venvs')];
            if (this._projectId) {
                fetches.unshift(fetch(`api/projects/${this._projectId}/venvs`));
            }
            const responses = await Promise.all(fetches);
            if (this._projectId) {
                projectVenvs = await responses[0].json();
                sharedVenvs = await responses[1].json();
            } else {
                sharedVenvs = await responses[0].json();
            }
        } catch (err) {
            content.innerHTML = `<div class="panel-error">Failed to load environments</div>`;
            return;
        }

        content.innerHTML = '';

        const list = document.createElement('div');
        list.className = 'panel-list';

        // No-env option
        const noEnvItem = document.createElement('div');
        noEnvItem.className = 'panel-list-item';
        if (!this._activeVenv) noEnvItem.classList.add('active');
        noEnvItem.addEventListener('click', () => this._onSelect(null));
        const noEnvName = document.createElement('span');
        noEnvName.className = 'panel-item-name muted';
        noEnvName.textContent = 'No environment';
        noEnvItem.appendChild(noEnvName);
        list.appendChild(noEnvItem);

        // Project venvs
        if (projectVenvs.length > 0) {
            const header = document.createElement('div');
            header.className = 'panel-section-header';
            header.textContent = 'Project';
            list.appendChild(header);

            for (const v of projectVenvs) {
                list.appendChild(this._buildVenvItem(v, 'project'));
            }
        }

        // Shared venvs
        if (sharedVenvs.length > 0) {
            const header = document.createElement('div');
            header.className = 'panel-section-header';
            header.textContent = 'Shared';
            list.appendChild(header);

            for (const v of sharedVenvs) {
                list.appendChild(this._buildVenvItem(v, 'shared'));
            }
        }

        if (projectVenvs.length === 0 && sharedVenvs.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'panel-empty';
            empty.textContent = 'No environments available';
            list.appendChild(empty);
        }

        content.appendChild(list);

        // Manage link
        const footer = document.createElement('div');
        footer.className = 'panel-footer';
        const manageLink = document.createElement('button');
        manageLink.className = 'panel-footer-link';
        manageLink.textContent = 'Manage environments...';
        manageLink.addEventListener('click', () => {
            if (this._callbacks.onManageClick) this._callbacks.onManageClick();
            this.close();
        });
        footer.appendChild(manageLink);
        content.appendChild(footer);
    }

    _buildVenvItem(venv, type) {
        const ref = `${type}:${venv.name}`;
        const item = document.createElement('div');
        item.className = 'panel-list-item';
        if (this._activeVenv === ref) item.classList.add('active');
        item.addEventListener('click', () => this._onSelect({
            type, name: venv.name, pythonVersion: venv.python_version || null
        }));

        const name = document.createElement('span');
        name.className = 'panel-item-name';
        name.textContent = venv.name;

        item.appendChild(name);

        if (venv.python_version) {
            const meta = document.createElement('span');
            meta.className = 'panel-item-meta';
            const parts = venv.python_version.split('.');
            meta.textContent = `Python ${parts.length >= 2 ? parts[0] + '.' + parts[1] : venv.python_version}`;
            item.appendChild(meta);
        }
        return item;
    }

    _onSelect(venvRef) {
        if (this._callbacks.onVenvSelect) {
            this._callbacks.onVenvSelect(venvRef);
        }
        this.close();
    }
}
