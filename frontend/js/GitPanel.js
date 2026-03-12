/**
 * GitPanel — Sidebar "Source Control" view.
 * Sections: Author · Repository (branches) · Changes (commit) · History
 */
export class GitPanel {
    constructor() {
        this._projectId = null;
        this._status = null;
        this._branches = null;
        this._onCommitOpen = null;

        // Persist section open/close across refreshes
        this._authorOpen   = true;
        this._repoOpen     = true;
        this._changesOpen  = true;
        this._historyOpen  = true;

        // Author inputs — instance-level so the commit action can read them
        this._nameInput  = null;
        this._emailInput = null;

        this._el = document.createElement('div');
        this._el.className = 'git-panel';
        this._build();
    }

    get element() { return this._el; }
    get titleElement() { return this._topbar; }

    setOnCommitOpen(cb) { this._onCommitOpen = cb; }

    setProject(projectId) {
        if (this._projectId === projectId) return;
        this._projectId = projectId;
        this._render();
    }

    activate() { if (this._projectId) this._refresh(); }
    refresh()   { if (this._projectId) this._refresh(); }

    // --- Skeleton ---

    _build() {
        this._topbar = document.createElement('div');
        this._topbar.className = 'git-panel-topbar';

        this._projectLabel = document.createElement('span');
        this._projectLabel.className = 'git-panel-project-label';
        this._projectLabel.textContent = 'No project open';

        this._topbar.append(this._projectLabel);

        this._body = document.createElement('div');
        this._body.className = 'git-panel-body';

        // _topbar is exposed via titleElement — sidebar injects it into the title bar
        this._el.appendChild(this._body);
    }

    // --- Rendering ---

    _render() {
        if (!this._projectId) {
            this._projectLabel.textContent = 'No project open';
            this._body.innerHTML = '';
            return;
        }
        this._projectLabel.innerHTML =
            `<span class="git-panel-project-name">${_esc(this._projectId)}</span>`;
        this._refresh();
    }

    async _refresh() {
        if (!this._projectId) return;
        try {
            const [statusRes, branchRes] = await Promise.all([
                fetch(`api/projects/${encodeURIComponent(this._projectId)}/git/status`),
                fetch(`api/projects/${encodeURIComponent(this._projectId)}/git/branches`),
            ]);
            if (!statusRes.ok) throw new Error(`HTTP ${statusRes.status}`);
            this._status   = await statusRes.json();
            this._branches = branchRes.ok ? await branchRes.json() : { branches: [], current: null };
        } catch (e) {
            this._renderError(e.message);
            return;
        }
        this._renderBody();
    }

    _renderBody() {
        this._body.innerHTML = '';

        if (!this._status.initialized) {
            this._renderNotInit();
            return;
        }

        this._body.append(
            this._buildAuthorSection(),
            this._buildRepositorySection(),
            this._buildChangesSection(),
            this._buildHistorySection(),
        );
    }

    _renderNotInit() {
        const msg = document.createElement('div');
        msg.className = 'git-panel-empty';
        msg.textContent = 'This project is not a git repository.';

        const btn = document.createElement('button');
        btn.className = 'git-init-btn';
        btn.textContent = 'Initialize Repository';
        btn.addEventListener('click', () => this._initRepo());

        msg.appendChild(btn);
        this._body.appendChild(msg);
    }

    _renderError(msg) {
        this._body.innerHTML = '';
        const el = document.createElement('div');
        el.className = 'git-panel-empty';
        el.textContent = `Error: ${msg}`;
        this._body.appendChild(el);
    }

    // --- Section builder helper ---

    _buildSection(title, openKey, contentBuilder) {
        const wrap = document.createElement('div');

        const header = document.createElement('div');
        header.className = 'git-section-header';
        const chevron = document.createElement('span');
        chevron.className = `git-section-chevron ${this[openKey] ? 'open' : ''}`;
        chevron.textContent = '▶';
        header.append(chevron, title);

        const body = document.createElement('div');
        body.className = 'git-section-body';
        body.style.display = this[openKey] ? '' : 'none';
        contentBuilder(body);

        header.addEventListener('click', () => {
            this[openKey] = !this[openKey];
            chevron.classList.toggle('open', this[openKey]);
            body.style.display = this[openKey] ? '' : 'none';
        });

        wrap.append(header, body);
        return wrap;
    }

    // --- 3.1 Author ---

    _buildAuthorSection() {
        return this._buildSection('Author', '_authorOpen', (body) => {
            body.className += ' git-author-section';

            this._nameInput = document.createElement('input');
            this._nameInput.className = 'git-author-input';
            this._nameInput.type = 'text';
            this._nameInput.placeholder = 'Name';
            this._nameInput.spellcheck = false;
            this._nameInput.value = localStorage.getItem('git_author_name') || '';
            this._nameInput.addEventListener('change', () =>
                localStorage.setItem('git_author_name', this._nameInput.value.trim()));

            this._emailInput = document.createElement('input');
            this._emailInput.className = 'git-author-input';
            this._emailInput.type = 'text';
            this._emailInput.placeholder = 'Email';
            this._emailInput.spellcheck = false;
            this._emailInput.value = localStorage.getItem('git_author_email') || '';
            this._emailInput.addEventListener('change', () =>
                localStorage.setItem('git_author_email', this._emailInput.value.trim()));

            const row = document.createElement('div');
            row.className = 'git-author-row';
            row.append(this._nameInput, this._emailInput);
            body.appendChild(row);
        });
    }

    // --- 3.2 Repository ---

    _buildRepositorySection() {
        return this._buildSection('Repositories', '_repoOpen', (body) => {
            body.className += ' git-repo-section';

            const branches = this._branches?.branches || [];
            const current  = this._branches?.current  || this._status?.branch || '';

            // Branch row: selector + new-branch toggle
            const branchRow = document.createElement('div');
            branchRow.className = 'git-branch-row';

            const branchIcon = document.createElement('span');
            branchIcon.className = 'git-branch-icon';
            branchIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`;

            const branchSelect = document.createElement('select');
            branchSelect.className = 'git-branch-select';
            if (branches.length === 0) {
                const opt = document.createElement('option');
                opt.textContent = current || 'main';
                branchSelect.appendChild(opt);
            } else {
                for (const b of branches) {
                    const opt = document.createElement('option');
                    opt.value = b;
                    opt.textContent = b;
                    if (b === current) opt.selected = true;
                    branchSelect.appendChild(opt);
                }
            }
            branchSelect.addEventListener('change', () => this._checkout(branchSelect.value, branchSelect));

            const newBtn = document.createElement('button');
            newBtn.className = 'git-new-branch-btn';
            newBtn.title = 'New branch';
            newBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;

            branchRow.append(branchIcon, branchSelect, newBtn);
            body.appendChild(branchRow);

            // Inline new-branch form (hidden by default)
            const newForm = document.createElement('div');
            newForm.className = 'git-new-branch-form';
            newForm.style.display = 'none';

            const newInput = document.createElement('input');
            newInput.className = 'git-author-input';
            newInput.type = 'text';
            newInput.placeholder = 'Branch name…';
            newInput.spellcheck = false;

            const createBtn = document.createElement('button');
            createBtn.className = 'git-commit-btn';
            createBtn.textContent = 'Create';

            newForm.append(newInput, createBtn);
            body.appendChild(newForm);

            newBtn.addEventListener('click', () => {
                const visible = newForm.style.display !== 'none';
                newForm.style.display = visible ? 'none' : '';
                if (!visible) newInput.focus();
            });

            createBtn.addEventListener('click', () =>
                this._createBranch(newInput.value.trim(), newInput, createBtn, newForm));

            newInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this._createBranch(newInput.value.trim(), newInput, createBtn, newForm);
                if (e.key === 'Escape') { newForm.style.display = 'none'; newInput.value = ''; }
            });
        });
    }

    // --- 3.3 Changes ---

    _buildChangesSection() {
        const files = this._status?.files || [];
        const wrap = this._buildSection(`Changes (${files.length})`, '_changesOpen', (body) => {
            body.className += ' git-changes-section';

            // Commit message
            const msgInput = document.createElement('textarea');
            msgInput.className = 'git-commit-input';
            msgInput.placeholder = 'Commit message…';
            msgInput.spellcheck = false;

            // Commit button
            const commitBtn = document.createElement('button');
            commitBtn.className = 'git-commit-btn';
            commitBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;vertical-align:-2px"><polyline points="20 6 9 17 4 12"/></svg>Commit`;
            commitBtn.style.width = '100%';
            commitBtn.disabled = true;

            msgInput.addEventListener('input', () => {
                commitBtn.disabled = !msgInput.value.trim();
            });

            commitBtn.addEventListener('click', () =>
                this._doCommit(msgInput, commitBtn));

            body.append(msgInput, commitBtn);

            // File list
            const list = document.createElement('div');
            list.className = 'git-files-list';
            if (files.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'git-panel-empty';
                empty.style.padding = '8px 16px';
                empty.textContent = 'No changes';
                list.appendChild(empty);
            } else {
                for (const f of files) list.appendChild(this._buildFileItem(f));
            }
            body.appendChild(list);
        });

        // Add refresh button to the Changes section header
        const header = wrap.firstElementChild;
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'git-panel-refresh-btn';
        refreshBtn.title = 'Refresh';
        refreshBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
        refreshBtn.addEventListener('click', (e) => { e.stopPropagation(); this._refresh(); });
        refreshBtn.style.marginLeft = 'auto';
        header.appendChild(refreshBtn);

        return wrap;
    }

    _buildFileItem(f) {
        const item = document.createElement('div');
        item.className = 'git-file-item';

        const iconEl = document.createElement('i');
        iconEl.className = `git-file-icon ${_fileIcon(f.path)}`;

        const pathEl = document.createElement('span');
        pathEl.className = 'git-file-path';
        pathEl.textContent = f.path;
        pathEl.title = f.path;

        const statusEl = document.createElement('span');
        statusEl.className = `git-file-status ${f.label}`;
        statusEl.textContent = _statusChar(f);
        statusEl.title = f.label;

        item.append(iconEl, pathEl, statusEl);
        return item;
    }

    // --- 3.4 History ---

    _buildHistorySection() {
        return this._buildSection('History', '_historyOpen', (body) => {
            body.className += ' git-history-section';
            this._loadHistory(body);
        });
    }

    async _loadHistory(container) {
        try {
            const res = await fetch(
                `api/projects/${encodeURIComponent(this._projectId)}/git/log`
            );
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();

            if (data.commits.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'git-panel-empty';
                empty.style.padding = '8px 16px';
                empty.textContent = 'No commits yet';
                container.appendChild(empty);
                return;
            }
            const list = document.createElement('div');
            list.className = 'git-history-list';
            for (const commit of data.commits) list.appendChild(this._buildCommitItem(commit));
            container.appendChild(list);
        } catch {
            const err = document.createElement('div');
            err.className = 'git-panel-empty';
            err.style.padding = '8px 16px';
            err.textContent = 'Failed to load history';
            container.appendChild(err);
        }
    }

    _buildCommitItem(commit) {
        const item = document.createElement('div');
        item.className = 'git-commit-item';

        const hash = document.createElement('span');
        hash.className = 'git-commit-hash';
        hash.textContent = commit.short_hash;

        const msg = document.createElement('span');
        msg.className = 'git-commit-msg';
        msg.textContent = commit.message;
        msg.title = commit.message;

        const meta = document.createElement('span');
        meta.className = 'git-commit-meta';
        meta.textContent = commit.date_relative;
        meta.title = commit.date;

        const row = document.createElement('div');
        row.className = 'git-commit-row';
        row.append(hash, msg, meta);
        item.appendChild(row);

        item.addEventListener('click', () => this._onCommitOpen?.(this._projectId, commit));
        return item;
    }

    // --- Actions ---

    async _doCommit(msgInput, commitBtn) {
        const msg = msgInput.value.trim();
        if (!msg) return;
        commitBtn.disabled = true;
        commitBtn.textContent = 'Committing…';
        try {
            const res = await fetch(
                `api/projects/${encodeURIComponent(this._projectId)}/git/commit`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: msg,
                        author_name:  this._nameInput?.value.trim()  || null,
                        author_email: this._emailInput?.value.trim() || null,
                    }),
                }
            );
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || res.statusText);
            }
            msgInput.value = '';
            commitBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;vertical-align:-2px"><polyline points="20 6 9 17 4 12"/></svg>Committed!`;
            setTimeout(() => { commitBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;vertical-align:-2px"><polyline points="20 6 9 17 4 12"/></svg>Commit`; }, 1500);
            this._refresh();
        } catch (e) {
            commitBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;vertical-align:-2px"><polyline points="20 6 9 17 4 12"/></svg>Commit`;
            commitBtn.disabled = false;
            alert(`Commit failed: ${e.message}`);
        }
    }

    async _checkout(branch, select) {
        try {
            const res = await fetch(
                `api/projects/${encodeURIComponent(this._projectId)}/git/checkout`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ branch }),
                }
            );
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || res.statusText);
            }
            this._refresh();
        } catch (e) {
            alert(`Checkout failed: ${e.message}`);
            // Revert select to current value
            if (this._branches?.current) select.value = this._branches.current;
        }
    }

    async _createBranch(name, input, btn, form) {
        if (!name) { input.focus(); return; }
        btn.disabled = true;
        btn.textContent = 'Creating…';
        try {
            const res = await fetch(
                `api/projects/${encodeURIComponent(this._projectId)}/git/branches`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ branch: name }),
                }
            );
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || res.statusText);
            }
            input.value = '';
            form.style.display = 'none';
            this._refresh();
        } catch (e) {
            btn.disabled = false;
            btn.textContent = 'Create';
            alert(`Create branch failed: ${e.message}`);
        }
    }

    async _initRepo() {
        try {
            const res = await fetch(
                `api/projects/${encodeURIComponent(this._projectId)}/git/init`,
                { method: 'POST' }
            );
            if (!res.ok) throw new Error(await res.text());
            this._refresh();
        } catch (e) {
            alert(`Init failed: ${e.message}`);
        }
    }
}

// --- Helpers ---

function _esc(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _statusChar(f) {
    if (f.label === 'untracked') return '?';
    if (f.label === 'added')     return 'A';
    if (f.label === 'deleted')   return 'D';
    if (f.label === 'renamed')   return 'R';
    if (f.label === 'modified')  return 'M';
    return '~';
}

function _fileIcon(path) {
    const name = path.split('/').pop();
    const ext  = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    if (name === '.gitignore' || name === '.gitattributes') return 'fa-solid fa-file-lines';
    switch (ext) {
        case 'py':                          return 'fa-brands fa-python';
        case 'ipynb':                       return 'fa-solid fa-book';
        case 'md': case 'txt': case 'rst':  return 'fa-solid fa-file-lines';
        case 'pdf':                         return 'fa-solid fa-file-pdf';
        case 'json': case 'yaml': case 'yml':
        case 'js': case 'ts': case 'css':
        case 'html': case 'htm': case 'sh': return 'fa-solid fa-file-code';
        case 'png': case 'jpg': case 'jpeg':
        case 'gif': case 'svg': case 'webp': return 'fa-solid fa-file-image';
        default:                            return 'fa-solid fa-file';
    }
}
