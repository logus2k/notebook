/**
 * KernelClient - Socket.IO communication layer.
 * Wraps all socket events and provides an event emitter interface.
 */
export class KernelClient {
    constructor() {
        this._socket = null;
        this._listeners = {};
        this._heartbeatInterval = null;
        this._connected = false;
    }

    connect(url = '') {
        // Derive Socket.IO path from page URL so it works behind subpath proxies
        const basePath = new URL('.', window.location.href).pathname;

        this._socket = io(url, {
            path: basePath + 'socket.io',
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 10
        });

        this._socket.on('connect', () => {
            this._connected = true;
            this._startHeartbeat();
            this._emit('connected');
        });

        this._socket.on('disconnect', (reason) => {
            this._connected = false;
            this._stopHeartbeat();
            this._emit('disconnected', { reason });
        });

        this._socket.on('connect_error', (err) => {
            this._emit('connection_error', { error: err.message });
        });

        // Notebook events
        this._socket.on('notebook:state', (data) => this._emit('notebook:state', data));
        this._socket.on('notebook:saved', (data) => this._emit('notebook:saved', data));

        // Cell events
        this._socket.on('cell:updated', (data) => this._emit('cell:updated', data));
        this._socket.on('cell:added', (data) => this._emit('cell:added', data));
        this._socket.on('cell:deleted', (data) => this._emit('cell:deleted', data));
        this._socket.on('cell:moved', (data) => this._emit('cell:moved', data));
        this._socket.on('cell:output', (data) => this._emit('cell:output', data));
        this._socket.on('cell:execute_complete', (data) => this._emit('cell:execute_complete', data));
        this._socket.on('cell:lock_changed', (data) => this._emit('cell:lock_changed', data));

        // Kernel events
        this._socket.on('kernel:status', (data) => this._emit('kernel:status', data));

        // Collaboration events
        this._socket.on('user:joined', (data) => this._emit('user:joined', data));
        this._socket.on('user:left', (data) => this._emit('user:left', data));

        // Errors
        this._socket.on('error', (data) => this._emit('error', data));
    }

    get connected() { return this._connected; }
    get sid() { return this._socket ? this._socket.id : null; }
    get socket() { return this._socket; }

    // --- Notebook ---

    openNotebook(projectId, notebookPath, userName = 'Anonymous') {
        this._socket.emit('notebook:open', {
            project_id: projectId,
            notebook_path: notebookPath,
            user_name: userName
        });
    }

    closeNotebook(projectId, notebookPath) {
        this._socket.emit('notebook:close', {
            project_id: projectId,
            notebook_path: notebookPath
        });
    }

    saveNotebook(content) {
        this._socket.emit('notebook:save', { content });
    }

    // --- Cells ---

    lockCell(cellIndex) {
        this._socket.emit('cell:lock', { cell_index: cellIndex });
    }

    unlockCell(cellIndex) {
        this._socket.emit('cell:unlock', { cell_index: cellIndex });
    }

    updateCell(cellIndex, source) {
        this._socket.emit('cell:update', {
            cell_index: cellIndex,
            source: source
        });
    }

    addCell(cellIndex, cellType = 'code', cellId = null) {
        this._socket.emit('cell:add', {
            cell_index: cellIndex,
            cell_type: cellType,
            cell_id: cellId
        });
    }

    deleteCell(cellIndex) {
        this._socket.emit('cell:delete', { cell_index: cellIndex });
    }

    moveCell(fromIndex, toIndex) {
        this._socket.emit('cell:move', {
            from_index: fromIndex,
            to_index: toIndex
        });
    }

    executeCell(cellIndex, code) {
        this._socket.emit('cell:execute', {
            cell_index: cellIndex,
            code: code
        });
    }

    // --- Kernel ---

    startKernel(runtimeId, envName) {
        this._socket.emit('kernel:start', {
            runtime_id: runtimeId,
            env_name: envName,
        });
    }

    stopKernel() {
        this._socket.emit('kernel:stop', {});
    }

    restartKernel() {
        this._socket.emit('kernel:restart', {});
    }

    interruptKernel() {
        this._socket.emit('kernel:interrupt', {});
    }

    // --- Event emitter ---

    on(event, callback) {
        if (!this._listeners[event]) {
            this._listeners[event] = [];
        }
        this._listeners[event].push(callback);
    }

    off(event, callback) {
        if (!this._listeners[event]) return;
        this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
    }

    _emit(event, data = {}) {
        const callbacks = this._listeners[event] || [];
        for (const cb of callbacks) {
            try {
                cb(data);
            } catch (err) {
                console.error(`Error in ${event} listener:`, err);
            }
        }
    }

    // --- Heartbeat ---

    _startHeartbeat() {
        this._stopHeartbeat();
        this._heartbeatInterval = setInterval(() => {
            if (this._connected) {
                this._socket.emit('heartbeat', {});
            }
        }, 30000);
    }

    _stopHeartbeat() {
        if (this._heartbeatInterval) {
            clearInterval(this._heartbeatInterval);
            this._heartbeatInterval = null;
        }
    }

    disconnect() {
        this._stopHeartbeat();
        if (this._socket) {
            this._socket.disconnect();
        }
    }
}
