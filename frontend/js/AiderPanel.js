import { InteractiveTerminal } from './InteractiveTerminal.js';

/**
 * AiderPanel - Embeds an Aider coding assistant terminal in a container.
 * Manages the terminal lifecycle and provides start/stop controls.
 */
export class AiderPanel {

    constructor(containerElement, socket, options = {}) {
        this._container = containerElement;
        this._socket = socket;
        this._options = options;
        this._terminal = null;
        this._started = false;
        this._build();
    }

    _build() {
        const panel = document.createElement('div');
        panel.className = 'aider-panel';

        // Header
        const header = document.createElement('div');
        header.className = 'toc-header';
        const title = document.createElement('div');
        title.className = 'toc-title';
        title.textContent = 'Aider';
        header.appendChild(title);

        // Start/stop button in header
        this._toggleBtn = document.createElement('button');
        this._toggleBtn.className = 'aider-toggle-btn';
        this._toggleBtn.title = 'Start Aider';
        this._toggleBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="#5da602" stroke="#202020" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
        this._toggleBtn.addEventListener('click', () => {
            if (this._started) this.stop();
            else this.start(this._options);
        });
        header.appendChild(this._toggleBtn);
        panel.appendChild(header);

        // Terminal container
        this._termContainer = document.createElement('div');
        this._termContainer.className = 'aider-terminal-container';
        panel.appendChild(this._termContainer);

        this._container.appendChild(panel);
    }

    async start(options = {}) {
        if (this._started) return;

        const sessionId = `aider-${crypto.randomUUID().slice(0, 8)}`;

        // Build aider command
        const cmd = ['python3.12', '-m', 'aider',
            '--no-auto-commits',
            '--no-gitignore',
            '--no-fancy-input',
            '--dark-mode',
            '--no-detect-urls',
        ];

        if (options.model) {
            cmd.push('--model', options.model);
        }
        if (options.noGit) {
            cmd.push('--no-git');
        }
        if (options.yesAlways) {
            cmd.push('--yes-always');
        }
        if (options.extraArgs) {
            cmd.push(...options.extraArgs);
        }

        // Working directory — default to current project data dir
        const cwd = options.cwd || '/app/data/projects';

        // Environment variables — Aider reads these natively
        const env = {};
        if (options.apiBase) {
            env.OPENAI_API_BASE = options.apiBase;
        }
        if (options.apiKey) {
            env.OPENAI_API_KEY = options.apiKey;
        }
        if (options.env) {
            Object.assign(env, options.env);
        }

        this._terminal = new InteractiveTerminal(this._termContainer, this._socket, {
            sessionId,
            cmd,
            cwd,
            env: Object.keys(env).length ? env : null,
            onExit: () => this._onProcessExit(),
        });

        await this._terminal.open();
        await this._terminal.start();
        this._terminal.focus();

        this._started = true;
        this._updateToggleBtn();
    }

    stop() {
        if (!this._started) return;
        if (this._terminal) {
            this._terminal.dispose();
            this._terminal = null;
        }
        this._termContainer.innerHTML = '';
        this._started = false;
        this._updateToggleBtn();
    }

    _onProcessExit() {
        this._started = false;
        this._updateToggleBtn();
    }

    _updateToggleBtn() {
        if (this._started) {
            this._toggleBtn.title = 'Stop Aider';
            this._toggleBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="#d84a33" stroke="#202020" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>';
        } else {
            this._toggleBtn.title = 'Start Aider';
            this._toggleBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="#5da602" stroke="#202020" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
        }
    }

    focus() {
        if (this._terminal) this._terminal.focus();
    }

    get isStarted() {
        return this._started;
    }
}
