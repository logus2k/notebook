const S = 'stroke="#555" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const CTRL_ICONS = {
    runAll:    `<svg width="12" height="12" viewBox="0 0 24 24" fill="#555" ${S}><polygon points="6,3 20,12 6,21"/></svg>`,
    restart:   `<svg width="12" height="12" viewBox="0 2 24 24" fill="none" ${S}><polygon points="5,4 5,10 11,10" fill="#555"/><path d="M3.5 16a9 9 0 1 0 6-10" stroke-width="2.8"/></svg>`,
    stop:      `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" ${S}><path d="M6.34 6.34a9 9 0 1 0 11.32 0" stroke-width="2.8"/><line x1="12" y1="2" x2="12" y2="12" stroke-width="2.8"/></svg>`,
    interrupt: `<svg width="12" height="12" viewBox="0 0 24 24" fill="#555" ${S}><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`,
    clearAll:  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" ${S}><path d="M3 6h16" stroke-width="2.2"/><path d="M3 12h16" stroke-width="2.2"/><path d="M3 18h16" stroke-width="2.2"/><polygon points="19,1 23,6 19,11" fill="#555" stroke="none"/></svg>`,
};

/**
 * InfoBar - Bar below toolbar showing project/notebook breadcrumb,
 * centered kernel controls, and clickable kernel/environment status.
 */
export class InfoBar {
    /**
     * @param {HTMLElement} containerEl
     * @param {import('./KernelClient.js').KernelClient} kernelClient
     * @param {object} callbacks - { onKernelClick, onRunAll, onClearAllOutputs, onStartKernel }
     */
    constructor(containerEl, kernelClient, callbacks = {}) {
        this._container = containerEl;
        this._client = kernelClient;
        this._callbacks = callbacks;
        this._build();
    }

    _build() {
        this._container.innerHTML = '';
        this._container.id = 'info-bar';

        // Center: kernel controls
        const controls = document.createElement('div');
        controls.className = 'info-bar-controls';

        controls.appendChild(this._textButton(CTRL_ICONS.runAll, 'Run All', () => {
            if (this._callbacks.onRunAll) this._callbacks.onRunAll();
        }));
        controls.appendChild(this._textButton(CTRL_ICONS.restart, 'Restart', () => this._client.restartKernel()));
        controls.appendChild(this._textButton(CTRL_ICONS.stop, 'Stop', () => this._client.stopKernel()));
        controls.appendChild(this._textButton(CTRL_ICONS.interrupt, 'Interrupt', () => this._client.interruptKernel()));
        controls.appendChild(this._textButton(CTRL_ICONS.clearAll, 'Clear All Outputs', () => {
            if (this._callbacks.onClearAllOutputs) this._callbacks.onClearAllOutputs();
        }));

        this._container.appendChild(controls);
    }

    // --- Helpers ---

    _textButton(icon, label, onClick) {
        const btn = document.createElement('button');
        btn.className = 'info-bar-text-btn';
        btn.innerHTML = icon + `<span class="info-bar-btn-label">${label}</span>`;
        btn.title = label;
        btn.addEventListener('click', onClick);
        return btn;
    }
}
