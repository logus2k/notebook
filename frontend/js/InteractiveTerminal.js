import { getTerminalTheme, onTerminalThemeChange } from './TerminalThemes.js';

/**
 * InteractiveTerminal - A bidirectional xterm.js terminal connected
 * to a server-side PTY via Socket.IO.
 */
export class InteractiveTerminal {

    constructor(container, socket, options = {}) {
        this._container = container;
        this._socket = socket;
        this._sessionId = options.sessionId || crypto.randomUUID();
        this._cmd = options.cmd || ['bash'];
        this._cwd = options.cwd || null;
        this._env = options.env || null;
        this._term = null;
        this._fitObserver = null;
        this._opened = false;
        this._started = false;
        this._onExit = options.onExit || null;

        this._handleOutput = this._handleOutput.bind(this);
        this._handleExit = this._handleExit.bind(this);
    }

    get sessionId() { return this._sessionId; }

    async open() {
        if (this._opened) return;

        // Wait for font
        await Promise.all([
            document.fonts.load('12px "MesloLGS NF"'),
            document.fonts.load('bold 12px "MesloLGS NF"'),
        ]).catch(() => {});

        const theme = getTerminalTheme();
        this._container.style.background = theme.background;

        this._term = new Terminal({
            convertEol: false,
            cursorBlink: true,
            disableStdin: false,
            fontSize: 12,
            fontFamily: '"MesloLGS NF", "JetBrains Mono", "Fira Code", "Consolas", monospace',
            theme,
            scrollback: 10000,
            allowProposedApi: true,
        });

        onTerminalThemeChange((t) => {
            this._term.options.theme = t;
            this._container.style.background = t.background;
        });

        this._term.open(this._container);
        this._opened = true;

        // User input -> Socket.IO -> PTY
        this._term.onData((data) => {
            if (this._started) {
                this._socket.emit('terminal:input', {
                    session_id: this._sessionId,
                    data,
                });
            }
        });

        // Listen for PTY output
        this._socket.on('terminal:output', this._handleOutput);
        this._socket.on('terminal:exit', this._handleExit);

        // Auto-fit on resize
        this._fitObserver = new ResizeObserver(() => this._fit());
        this._fitObserver.observe(this._container);
        this._fit();
    }

    async start() {
        if (this._started) return;

        const cols = this._term?.cols || 120;
        const rows = this._term?.rows || 24;

        this._socket.emit('terminal:start', {
            session_id: this._sessionId,
            cmd: this._cmd,
            cwd: this._cwd,
            env: this._env,
            cols,
            rows,
        });

        this._started = true;
    }

    _handleOutput(payload) {
        if (payload?.session_id !== this._sessionId) return;
        if (payload?.data) {
            this._term.write(payload.data);
        }
    }

    _handleExit(payload) {
        if (payload?.session_id !== this._sessionId) return;
        this._started = false;
        this._term.writeln('\r\n\x1b[2m[Process exited]\x1b[0m');
        if (this._onExit) this._onExit(this._sessionId);
    }

    _fit() {
        if (!this._term || !this._opened) return;
        const core = this._term._core;
        if (!core?._renderService) return;
        const dims = core._renderService.dimensions;
        if (!dims?.css?.cell?.height || !dims?.css?.cell?.width) return;

        const cols = Math.max(20, Math.floor(this._container.clientWidth / dims.css.cell.width));
        const rows = Math.max(1, Math.floor(this._container.clientHeight / dims.css.cell.height));

        if (rows !== this._term.rows || cols !== this._term.cols) {
            this._term.resize(cols, rows);
            // Notify server of resize
            if (this._started) {
                this._socket.emit('terminal:resize', {
                    session_id: this._sessionId,
                    cols,
                    rows,
                });
            }
        }
    }

    write(data) {
        if (this._term) this._term.write(data);
    }

    focus() {
        if (this._term) this._term.focus();
    }

    dispose() {
        if (this._fitObserver) {
            this._fitObserver.disconnect();
            this._fitObserver = null;
        }

        this._socket.off('terminal:output', this._handleOutput);
        this._socket.off('terminal:exit', this._handleExit);

        if (this._started) {
            this._socket.emit('terminal:kill', {
                session_id: this._sessionId,
            });
            this._started = false;
        }

        if (this._term) {
            this._term.dispose();
            this._term = null;
        }

        this._opened = false;
    }
}
