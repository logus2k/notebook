import { KernelClient } from './KernelClient.js';
import { NotebookEditor } from './NotebookEditor.js';
import { NotebookToolbar } from './NotebookToolbar.js';
import { InfoBar } from './InfoBar.js';
import { BrowserPanel } from './panels/BrowserPanel.js';
import { DisplaySettingsPanel } from './panels/DisplaySettingsPanel.js';
import { EnvironmentPanel } from './panels/EnvironmentPanel.js';

/**
 * App - Entry point. Wires together all components.
 */
class App {
    constructor() {
        this._client = new KernelClient();
        this._editor = null;
        this._toolbar = null;
        this._infoBar = null;
        this._browserPanel = null;
        this._displaySettingsPanel = null;
        this._environmentPanel = null;
        this._currentProject = null;
        this._currentNotebook = null;
        this._activeVenvRef = null; // { type, name, pythonVersion } or null
        this._userName = this._generateUserName();
    }

    async init() {
        // Restore saved cell width
        const savedWidth = localStorage.getItem('notebook-cell-width');
        if (savedWidth) {
            document.documentElement.style.setProperty('--notebook-max-width', `${savedWidth}px`);
        }

        // Restore display toggles
        const toggleMap = {
            'show-cell-titles': 'hide-cell-titles',
            'show-cell-borders': 'hide-cell-borders',
            'show-cell-bg': 'hide-cell-bg',
            'show-code-cells': 'hide-code-cells',
            'show-line-numbers': 'hide-line-numbers',
            'show-output': 'hide-output',
            'show-table-stripes': 'hide-table-stripes',
            'show-add-cell-areas': 'hide-add-cell-areas',
            'show-bg-image': 'hide-bg-image',
            'show-bg-color': 'hide-bg-color',
        };
        for (const [key, cls] of Object.entries(toggleMap)) {
            if (localStorage.getItem(`notebook-${key}`) === '0') {
                document.body.classList.add(cls);
            }
        }

        // Initialize editor
        this._editor = new NotebookEditor(
            document.getElementById('notebook-container'),
            this._client
        );

        // Initialize toolbar (nav icons + file actions + settings + users)
        this._toolbar = new NotebookToolbar(
            document.getElementById('toolbar'),
            this._client,
            {
                onBrowse: () => this._browserPanel.open(),
                onImport: () => this._onImportNotebook(),
                onSave: () => this._editor.save(),
                onExport: () => this._editor.export(),
                onSettingsToggle: () => this._displaySettingsPanel.toggle(),
            }
        );

        // Initialize info bar (breadcrumb + kernel controls + kernel/env status)
        this._infoBar = new InfoBar(
            document.getElementById('info-bar'),
            this._client,
            {
                onRunAll: () => this._editor.runAll(),
                onClearAllOutputs: () => this._editor.clearAllOutputs(),
                onStartKernel: () => this._onStartKernel(),
                onKernelClick: () => {
                    if (!this._currentProject) {
                        alert('Select a project first');
                        return;
                    }
                    const activeKey = this._activeVenvRef
                        ? `${this._activeVenvRef.type}:${this._activeVenvRef.name}`
                        : null;
                    this._environmentPanel.open(activeKey);
                },
            }
        );

        // Initialize jsPanel-based selection panels
        this._browserPanel = new BrowserPanel({
            onSelect: (projectId, notebookName) => this._onNotebookChange(projectId, notebookName),
        });

        // Initialize display settings panel (jsPanel)
        this._displaySettingsPanel = new DisplaySettingsPanel();

        // Initialize unified environment panel (select + manage in one window)
        this._environmentPanel = new EnvironmentPanel({
            onVenvSelect: (venvRef) => this._onVenvSelect(venvRef),
            onVenvCreated: () => {},
            onVenvDeleted: () => {},
        });

        // Connect Socket.IO
        this._client.connect();

        this._client.on('connected', () => {
            console.log('Connected to server');
            if (this._currentProject && this._currentNotebook) {
                console.log('Reconnecting to notebook...');
                this._editor.openNotebook(
                    this._currentProject,
                    this._currentNotebook,
                    this._userName
                );
                // Re-start kernel if a venv was selected
                if (this._activeVenvRef) {
                    this._client.startKernel(this._activeVenvRef);
                }
            }
        });

        this._client.on('disconnected', (data) => {
            console.log('Disconnected:', data.reason);
        });

        this._client.on('error', (data) => {
            console.error('Server error:', data.message, data.code);
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this._editor.save();
            }
        });

        // Check URL params for auto-open, or open Welcome notebook
        const params = new URLSearchParams(window.location.search);
        const projectId = params.get('project');
        const notebook = params.get('notebook');
        if (projectId) {
            await this._onProjectChange(projectId);
            if (notebook) {
                this._onNotebookChange(projectId, notebook);
            }
        } else {
            // Open the Welcome notebook by default
            this._onNotebookChange('Examples', 'Welcome.ipynb');
        }
    }

    async _onProjectChange(projectId) {
        if (this._currentNotebook) {
            this._editor.closeNotebook();
        }
        this._currentProject = projectId;
        this._currentNotebook = null;
        this._activeVenvRef = null;

        this._infoBar.setProject(projectId);
        this._infoBar.setNotebook(null);
        this._infoBar.setVenv(null, null);

        this._environmentPanel.setProjectId(projectId);
    }

    async _onNotebookChange(projectId, notebookName) {
        if (this._currentNotebook) {
            this._editor.closeNotebook();
        }
        if (!projectId || !notebookName) return;

        this._currentProject = projectId;
        this._currentNotebook = notebookName;

        this._infoBar.setProject(projectId);
        this._infoBar.setNotebook(notebookName);
        this._environmentPanel.setProjectId(projectId);

        this._editor.openNotebook(projectId, notebookName, this._userName);

        // Restore persisted venv for this notebook (type:name or type:name:pythonVersion)
        const savedVenv = localStorage.getItem(`notebook-venv:${projectId}:${notebookName}`);
        if (savedVenv) {
            const parts = savedVenv.split(':');
            const [type, name] = parts;
            const pythonVersion = parts[2] || null;
            this._activeVenvRef = { type, name, pythonVersion };
            this._infoBar.setVenv(name, pythonVersion);
            this._client.startKernel(this._activeVenvRef);
        } else {
            // Auto-select the first available venv
            await this._autoSelectVenv();
        }

        // Update URL
        const url = new URL(window.location);
        url.searchParams.set('project', projectId);
        url.searchParams.set('notebook', notebookName);
        window.history.replaceState({}, '', url);
    }

    async _autoSelectVenv() {
        try {
            // Fetch shared/default venvs — Default is always first
            const resp = await fetch('api/venvs');
            if (!resp.ok) return;
            const venvs = await resp.json();
            // Prefer the Default env
            const defaultEnv = venvs.find(v => v.type === 'default');
            if (defaultEnv) {
                const venvRef = { type: 'default', name: defaultEnv.name, pythonVersion: defaultEnv.python_version || null };
                this._onVenvSelect(venvRef);
                return;
            }
            // Fallback to first available
            if (venvs.length > 0) {
                const v = venvs[0];
                this._onVenvSelect({ type: v.type, name: v.name, pythonVersion: v.python_version || null });
            }
        } catch (err) {
            console.warn('Auto-select venv failed:', err);
        }
    }

    _onVenvSelect(venvRef) {
        this._activeVenvRef = venvRef;
        if (venvRef) {
            this._infoBar.setVenv(venvRef.name, venvRef.pythonVersion);
            // Persist for this notebook (type:name:pythonVersion)
            if (this._currentProject && this._currentNotebook) {
                const val = venvRef.pythonVersion
                    ? `${venvRef.type}:${venvRef.name}:${venvRef.pythonVersion}`
                    : `${venvRef.type}:${venvRef.name}`;
                localStorage.setItem(
                    `notebook-venv:${this._currentProject}:${this._currentNotebook}`,
                    val
                );
            }
            // Auto-start the kernel with the selected venv (only if a notebook is open)
            if (this._currentNotebook) {
                this._client.startKernel(venvRef);
            }
        } else {
            this._infoBar.setVenv(null);
            if (this._currentProject && this._currentNotebook) {
                localStorage.removeItem(
                    `notebook-venv:${this._currentProject}:${this._currentNotebook}`
                );
            }
        }
    }

    _onImportNotebook() {
        if (!this._currentProject) {
            alert('Select a project first');
            return;
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.ipynb';
        input.addEventListener('change', async () => {
            const file = input.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const content = JSON.parse(text);
                if (!content.cells || !Array.isArray(content.cells)) {
                    throw new Error('Invalid notebook: missing cells array');
                }
                const name = file.name.replace(/\.ipynb$/, '');
                const resp = await fetch(`api/projects/${this._currentProject}/notebooks`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, content })
                });
                if (!resp.ok) {
                    const err = await resp.json();
                    throw new Error(err.detail || 'Failed to import notebook');
                }
                const nbName = name.endsWith('.ipynb') ? name : name + '.ipynb';
                this._onNotebookChange(this._currentProject, nbName);
            } catch (err) {
                alert(`Import error: ${err.message}`);
            }
        });
        input.click();
    }

    _onStartKernel() {
        if (!this._activeVenvRef) {
            alert('Select a virtual environment first (click the environment area in the info bar)');
            return;
        }
        this._client.startKernel(this._activeVenvRef);
    }

    _generateUserName() {
        const adjectives = [
            'Swift', 'Bright', 'Calm', 'Dark', 'Eager',
            'Fair', 'Grand', 'Happy', 'Iron', 'Keen'
        ];
        const nouns = [
            'Fox', 'Owl', 'Bear', 'Wolf', 'Hawk',
            'Lynx', 'Crow', 'Deer', 'Hare', 'Dove'
        ];
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        return `${adj}${noun}`;
    }
}

// --- Bootstrap ---
const app = new App();
app.init().catch(err => console.error('App init failed:', err));
