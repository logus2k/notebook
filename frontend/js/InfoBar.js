const S = 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
    runAll:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ${S}><polygon points="5 3 15 12 5 21 5 3"/><line x1="19" y1="3" x2="19" y2="21"/></svg>`,
    play:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ${S}><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    stop:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ${S}><rect x="6" y="6" width="12" height="12" rx="1"/></svg>`,
    restart:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ${S}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
    interrupt: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ${S}><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`,
};

/**
 * InfoBar - Bar below toolbar showing project/notebook breadcrumb,
 * centered kernel controls, and clickable kernel/environment status.
 */
export class InfoBar {
    /**
     * @param {HTMLElement} containerEl
     * @param {import('./KernelClient.js').KernelClient} kernelClient
     * @param {object} callbacks - { onKernelClick, onRunAll, onStartKernel }
     */
    constructor(containerEl, kernelClient, callbacks = {}) {
        this._container = containerEl;
        this._client = kernelClient;
        this._callbacks = callbacks;
        this._venvName = null;
        this._pythonVersion = null;
        this._kernelStatus = 'dead';
        this._build();
        this._client.on('kernel:status', (data) => this._setKernelStatus(data.status));
    }

    _build() {
        this._container.innerHTML = '';
        this._container.id = 'info-bar';

        // Left: breadcrumb
        const leftWrap = document.createElement('div');
        leftWrap.className = 'info-bar-left';

        this._projectLabel = document.createElement('span');
        this._projectLabel.className = 'info-bar-text';
        this._projectLabel.textContent = 'No project selected';

        const sep = document.createElement('span');
        sep.className = 'info-bar-separator';
        sep.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="#202020"><polygon points="8,4 20,12 8,20"/></svg>';

        this._notebookLabel = document.createElement('span');
        this._notebookLabel.className = 'info-bar-text';
        this._notebookLabel.textContent = '';

        leftWrap.append(this._projectLabel, sep, this._notebookLabel);
        this._container.appendChild(leftWrap);

        // Center: kernel controls
        const controls = document.createElement('div');
        controls.className = 'info-bar-controls';

        controls.appendChild(this._iconButton(ICONS.runAll, 'Run All', () => {
            if (this._callbacks.onRunAll) this._callbacks.onRunAll();
        }));
        controls.appendChild(this._iconButton(ICONS.play, 'Start kernel', () => {
            if (this._callbacks.onStartKernel) this._callbacks.onStartKernel();
        }));
        controls.appendChild(this._iconButton(ICONS.stop, 'Stop kernel', () => this._client.stopKernel()));
        const restartBtn = this._iconButton(ICONS.restart, 'Restart kernel', () => this._client.restartKernel());
        restartBtn.classList.add('no-fill');
        controls.appendChild(restartBtn);
        controls.appendChild(this._iconButton(ICONS.interrupt, 'Interrupt kernel', () => this._client.interruptKernel()));

        this._container.appendChild(controls);

        // Right: kernel/environment status (clickable)
        const rightWrap = document.createElement('div');
        rightWrap.className = 'info-bar-right';

        this._kernelItem = document.createElement('div');
        this._kernelItem.className = 'info-bar-kernel';
        this._kernelItem.addEventListener('click', () => {
            if (this._callbacks.onKernelClick) this._callbacks.onKernelClick();
        });

        this._kernelDot = document.createElement('span');
        this._kernelDot.className = 'kernel-status-dot dead';

        this._kernelLabel = document.createElement('span');
        this._kernelLabel.className = 'info-bar-label';
        this._kernelLabel.textContent = 'No Kernel';

        this._kernelItem.append(this._kernelDot, this._kernelLabel);
        rightWrap.appendChild(this._kernelItem);
        this._container.appendChild(rightWrap);
    }

    setProject(name) {
        this._projectLabel.textContent = name || 'No project selected';
        this._projectLabel.classList.toggle('has-value', !!name);
    }

    setNotebook(name) {
        this._notebookLabel.textContent = name || '';
        this._notebookLabel.classList.toggle('has-value', !!name);
    }

    /**
     * @param {string|null} name - venv name
     * @param {string|null} pythonVersion - e.g. "3.12.12"
     */
    setVenv(name, pythonVersion) {
        this._venvName = name;
        this._pythonVersion = pythonVersion;
        // If a venv is selected but kernel hasn't started yet, show standby (gray) instead of dead (red)
        if (name && this._kernelStatus === 'dead') {
            this._kernelDot.className = 'kernel-status-dot standby';
        }
        this._updateKernelLabel();
    }

    _setKernelStatus(status) {
        this._kernelStatus = status;
        this._kernelDot.className = `kernel-status-dot ${status}`;
        this._updateKernelLabel();
    }

    _updateKernelLabel() {
        if (this._venvName) {
            const pyVer = this._pythonVersion
                ? ` (Python ${this._formatVersion(this._pythonVersion)})`
                : '';
            this._kernelLabel.textContent = this._venvName + pyVer;
        } else {
            this._kernelLabel.textContent = 'No Kernel';
        }
    }

    /** Shorten "3.12.12" to "3.12" */
    _formatVersion(v) {
        const parts = v.split('.');
        return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : v;
    }

    // --- Helpers ---

    _iconButton(svgHtml, title, onClick) {
        const btn = document.createElement('button');
        btn.className = 'info-bar-icon-btn';
        btn.innerHTML = svgHtml;
        btn.title = title;
        btn.addEventListener('click', onClick);
        return btn;
    }
}
