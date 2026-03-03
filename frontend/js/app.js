import { KernelClient } from './KernelClient.js';
import { NotebookEditor } from './NotebookEditor.js';
import { NotebookToolbar } from './NotebookToolbar.js';
import { VenvPanel } from './VenvPanel.js';

/**
 * App - Entry point. Wires together all components.
 */
class App {
    constructor() {
        this._client = new KernelClient();
        this._editor = null;
        this._toolbar = null;
        this._venvPanel = null;
        this._currentProject = null;
        this._currentNotebook = null;
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

        // Initialize components
        this._editor = new NotebookEditor(
            document.getElementById('notebook-container'),
            this._client
        );

        this._suppressToolbarEvents = false;

        this._toolbar = new NotebookToolbar(
            document.getElementById('toolbar'),
            this._client,
            {
                onSave: () => this._editor.save(),
                onRunAll: () => this._editor.runAll(),
                onVenvPanelToggle: () => this._venvPanel.toggle(),
                onProjectChange: (projectId) => this._onProjectChange(projectId),
                onNotebookChange: (projectId, notebookName) => {
                    if (!this._suppressToolbarEvents) {
                        this._onNotebookChange(projectId, notebookName);
                    }
                }
            }
        );

        this._venvPanel = new VenvPanel(
            document.getElementById('venv-panel'),
            {
                onVenvCreated: () => {
                    if (this._currentProject) {
                        this._toolbar.loadVenvs(this._currentProject);
                    }
                },
                onVenvDeleted: () => {
                    if (this._currentProject) {
                        this._toolbar.loadVenvs(this._currentProject);
                    }
                }
            }
        );

        // Connect Socket.IO
        this._client.connect();

        this._client.on('connected', () => {
            console.log('Connected to server');
            // Re-establish notebook context on reconnection
            if (this._currentProject && this._currentNotebook) {
                console.log('Reconnecting to notebook...');
                this._editor.openNotebook(
                    this._currentProject,
                    this._currentNotebook,
                    this._userName
                );
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

        // Load projects
        await this._toolbar.loadProjects();

        // Check URL params for auto-open
        const params = new URLSearchParams(window.location.search);
        const projectId = params.get('project');
        const notebook = params.get('notebook');
        if (projectId) {
            this._suppressToolbarEvents = true;
            this._toolbar.setProject(projectId);
            await this._onProjectChange(projectId);
            if (notebook) {
                this._toolbar.setNotebook(notebook);
                this._onNotebookChange(projectId, notebook);
            }
            this._suppressToolbarEvents = false;
        }
    }

    async _onProjectChange(projectId) {
        if (this._currentNotebook) {
            this._editor.closeNotebook();
        }
        this._currentProject = projectId;
        this._currentNotebook = null;
        this._venvPanel.setProjectId(projectId);

        if (projectId) {
            await this._toolbar.loadNotebooks(projectId);
            await this._toolbar.loadVenvs(projectId);
        }
    }

    _onNotebookChange(projectId, notebookName) {
        if (this._currentNotebook) {
            this._editor.closeNotebook();
        }
        if (!projectId || !notebookName) return;

        this._currentProject = projectId;
        this._currentNotebook = notebookName;
        this._editor.openNotebook(projectId, notebookName, this._userName);

        // Update URL
        const url = new URL(window.location);
        url.searchParams.set('project', projectId);
        url.searchParams.set('notebook', notebookName);
        window.history.replaceState({}, '', url);
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
