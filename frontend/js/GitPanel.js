/**
 * GitPanel — Sidebar view for per-project git version control.
 * Shows changed files, commit form, and commit history.
 */
export class GitPanel {
    constructor() {
        this._projectId = null;
        this._status = null;
        this._historyOpen = true;
        this._changesOpen = true;
        this._expandedCommit = null;

        this._el = document.createElement('div');
        this._el.className = 'git-panel';
        this._build();
    }

    get element() { return this._el; }

    // Called by app.js when the active project changes
    setProject(projectId) {
        if (this._projectId === projectId) return;
        this._projectId = projectId;
        this._expandedCommit = null;
        this._render();
    }

    // Called by SidebarPanel when this view is activated
    activate() {
        if (this._projectId) this._refresh();
    }

    // Called externally to force a status refresh (e.g. after save, create, delete)
    refresh() {
        if (this._projectId) this._refresh();
    }

    // --- Build skeleton ---

    _build() {
        // Top bar
        this._topbar = document.createElement('div');
        this._topbar.className = 'git-panel-topbar';

        this._projectLabel = document.createElement('span');
        this._projectLabel.className = 'git-panel-project-label';
        this._projectLabel.textContent = 'No project open';

        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'git-panel-refresh-btn';
        refreshBtn.title = 'Refresh';
        refreshBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
        refreshBtn.addEventListener('click', () => this._refresh());

        this._topbar.append(this._projectLabel, refreshBtn);

        // Scrollable body
        this._body = document.createElement('div');
        this._body.className = 'git-panel-body';

        this._el.append(this._topbar, this._body);
    }

    // --- Rendering ---

    _render() {
        if (!this._projectId) {
            this._projectLabel.innerHTML = 'No project open';
            this._body.innerHTML = '';
            return;
        }
        this._projectLabel.innerHTML = `<span class="git-panel-project-name">${_esc(this._projectId)}</span>`;
        this._refresh();
    }

    async _refresh() {
        if (!this._projectId) return;
        const url = `api/projects/${encodeURIComponent(this._projectId)}/git/status`;
        try {
            const res = await fetch(url);
            const text = await res.text();
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
            this._status = JSON.parse(text);
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

        // Changes section
        this._body.appendChild(this._buildChangesSection());

        // Commit form
        this._body.appendChild(this._buildCommitForm());

        // History section
        this._body.appendChild(this._buildHistorySection());
    }

    _renderNotInit() {
        const msg = document.createElement('div');
        msg.className = 'git-panel-empty';
        msg.innerHTML = `This project is not a git repository.`;

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

    // --- Changes section ---

    _buildChangesSection() {
        const files = this._status.files || [];
        const wrap = document.createElement('div');

        const header = document.createElement('div');
        header.className = 'git-section-header';
        const chevron = document.createElement('span');
        chevron.className = `git-section-chevron ${this._changesOpen ? 'open' : ''}`;
        chevron.textContent = '▶';
        header.append(chevron, `Changes (${files.length})`);
        header.addEventListener('click', () => {
            this._changesOpen = !this._changesOpen;
            chevron.classList.toggle('open', this._changesOpen);
            list.style.display = this._changesOpen ? '' : 'none';
        });

        const list = document.createElement('div');
        list.className = 'git-files-list';
        list.style.display = this._changesOpen ? '' : 'none';

        if (files.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'git-panel-empty';
            empty.style.padding = '8px 16px';
            empty.textContent = 'No changes';
            list.appendChild(empty);
        } else {
            for (const f of files) {
                list.appendChild(this._buildFileItem(f));
            }
        }

        wrap.append(header, list);
        return wrap;
    }

    _buildFileItem(f) {
        const item = document.createElement('div');
        item.className = 'git-file-item';

        const statusEl = document.createElement('span');
        statusEl.className = `git-file-status ${f.label}`;
        statusEl.textContent = _statusChar(f);
        statusEl.title = f.label;

        const pathEl = document.createElement('span');
        pathEl.className = 'git-file-path';
        pathEl.textContent = f.path;
        pathEl.title = f.path;

        item.append(statusEl, pathEl);
        return item;
    }

    // --- Commit form ---

    _buildCommitForm() {
        const form = document.createElement('div');
        form.className = 'git-commit-form';

        // Author fields (persisted in localStorage)
        const authorRow = document.createElement('div');
        authorRow.className = 'git-author-row';

        const nameInput = document.createElement('input');
        nameInput.className = 'git-author-input';
        nameInput.type = 'text';
        nameInput.placeholder = 'Name';
        nameInput.spellcheck = false;
        nameInput.value = localStorage.getItem('git_author_name') || '';

        const emailInput = document.createElement('input');
        emailInput.className = 'git-author-input';
        emailInput.type = 'text';
        emailInput.placeholder = 'Email';
        emailInput.spellcheck = false;
        emailInput.value = localStorage.getItem('git_author_email') || '';

        nameInput.addEventListener('change', () => localStorage.setItem('git_author_name', nameInput.value.trim()));
        emailInput.addEventListener('change', () => localStorage.setItem('git_author_email', emailInput.value.trim()));

        authorRow.append(nameInput, emailInput);

        const input = document.createElement('textarea');
        input.className = 'git-commit-input';
        input.placeholder = 'Commit message…';
        input.spellcheck = false;

        const btn = document.createElement('button');
        btn.className = 'git-commit-btn';
        btn.textContent = 'Commit All';
        btn.disabled = true;

        input.addEventListener('input', () => {
            btn.disabled = !input.value.trim();
        });

        btn.addEventListener('click', async () => {
            const msg = input.value.trim();
            if (!msg) return;
            btn.disabled = true;
            btn.textContent = 'Committing…';
            const authorName = nameInput.value.trim();
            const authorEmail = emailInput.value.trim();
            try {
                const res = await fetch(
                    `api/projects/${encodeURIComponent(this._projectId)}/git/commit`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            message: msg,
                            author_name: authorName || null,
                            author_email: authorEmail || null,
                        }),
                    }
                );
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.detail || res.statusText);
                }
                input.value = '';
                btn.textContent = 'Committed!';
                setTimeout(() => { btn.textContent = 'Commit All'; }, 1500);
                this._expandedCommit = null;
                this._refresh();
            } catch (e) {
                btn.textContent = 'Commit All';
                btn.disabled = false;
                alert(`Commit failed: ${e.message}`);
            }
        });

        form.append(authorRow, input, btn);
        return form;
    }

    // --- History section ---

    _buildHistorySection() {
        const wrap = document.createElement('div');

        const header = document.createElement('div');
        header.className = 'git-section-header';
        const chevron = document.createElement('span');
        chevron.className = `git-section-chevron ${this._historyOpen ? 'open' : ''}`;
        chevron.textContent = '▶';
        header.append(chevron, 'History');
        header.addEventListener('click', () => {
            this._historyOpen = !this._historyOpen;
            chevron.classList.toggle('open', this._historyOpen);
            list.style.display = this._historyOpen ? '' : 'none';
        });

        const list = document.createElement('div');
        list.className = 'git-history-list';
        list.style.display = this._historyOpen ? '' : 'none';

        this._loadHistory(list);
        wrap.append(header, list);
        return wrap;
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

            for (const commit of data.commits) {
                container.appendChild(this._buildCommitItem(commit));
            }
        } catch (e) {
            const err = document.createElement('div');
            err.className = 'git-panel-empty';
            err.style.padding = '8px 16px';
            err.textContent = `Failed to load history`;
            container.appendChild(err);
        }
    }

    _buildCommitItem(commit) {
        const item = document.createElement('div');
        item.className = 'git-commit-item';
        if (this._expandedCommit === commit.hash) item.classList.add('expanded');

        const row = document.createElement('div');
        row.className = 'git-commit-row';

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

        row.append(hash, msg, meta);
        item.appendChild(row);

        // Diff area (lazy loaded on click)
        let diffEl = null;

        item.addEventListener('click', async () => {
            if (this._expandedCommit === commit.hash) {
                // Collapse
                this._expandedCommit = null;
                item.classList.remove('expanded');
                if (diffEl) { diffEl.remove(); diffEl = null; }
                return;
            }
            this._expandedCommit = commit.hash;
            item.classList.add('expanded');

            if (!diffEl) {
                diffEl = document.createElement('div');
                diffEl.className = 'git-commit-diff';
                diffEl.textContent = 'Loading…';
                item.appendChild(diffEl);

                try {
                    const res = await fetch(
                        `api/projects/${encodeURIComponent(this._projectId)}/git/show/${commit.hash}`
                    );
                    if (!res.ok) throw new Error(await res.text());
                    const data = await res.json();
                    diffEl.innerHTML = _colorDiff(data.diff);
                } catch (e) {
                    diffEl.textContent = `Error: ${e.message}`;
                }
            }
        });

        return item;
    }

    // --- Actions ---

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
    if (f.label === 'added') return 'A';
    if (f.label === 'deleted') return 'D';
    if (f.label === 'renamed') return 'R';
    if (f.label === 'modified') return 'M';
    return '~';
}

function _colorDiff(raw) {
    return raw
        .split('\n')
        .map(line => {
            const esc = _esc(line);
            if (line.startsWith('+++') || line.startsWith('---')) {
                return `<span>${esc}</span>`;
            }
            if (line.startsWith('+')) {
                return `<span class="diff-add">${esc}</span>`;
            }
            if (line.startsWith('-')) {
                return `<span class="diff-del">${esc}</span>`;
            }
            if (line.startsWith('@@')) {
                return `<span class="diff-hunk">${esc}</span>`;
            }
            return `<span>${esc}</span>`;
        })
        .join('\n');
}
