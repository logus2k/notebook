import { KernelClient } from './KernelClient.js';
import { NotebookEditor } from './NotebookEditor.js';
import { NotebookToolbar } from './NotebookToolbar.js';
import { InfoBar } from './InfoBar.js';
import { IconBar } from './IconBar.js';
import { SidebarPanel } from './SidebarPanel.js';
import { ExplorerPanel } from './panels/ExplorerPanel.js';
import { DisplaySettingsPanel } from './panels/DisplaySettingsPanel.js';
import { NotebookResizer } from './NotebookResizer.js';
import { ChatPanel } from './ChatPanel.js';
import { ChatService } from './ChatService.js';
import { RightPanel } from './RightPanel.js';
import { TabBar } from './TabBar.js';
import { TocPanel } from './TocPanel.js';


/**
 * App - Entry point. Wires together all components.
 */
class App {
    constructor() {
        this._client = new KernelClient();
        this._editor = null;
        this._toolbar = null;
        this._infoBar = null;
        this._iconBar = null;
        this._sidebar = null;
        this._explorerPanel = null;
        this._displaySettingsPanel = null;
        this._currentProject = null;
        this._currentNotebook = null;
        this._activeVenv = null; // { name, runtimeId, displayName } or null
        this._userName = this._generateUserName();
        this._kernelRunning = false;
        this._chatVisible = true;
    }

    async init() {
        // Make panels more opaque while dragging (default 0.8 → 0.95)
        jsPanel.defaults.dragit.opacity = 0.95;

        // Initialize notebook resizer (restores saved width)
        this._notebookResizer = new NotebookResizer();

        // Initialize icon bar (left vertical strip)
        this._iconBar = new IconBar(
            document.getElementById('icon-bar'),
            {
                onIconClick: (key, isActive) => this._onIconBarClick(key, isActive),
            }
        );

        // Initialize sidebar panel (between icon bar and content area)
        this._sidebar = new SidebarPanel({
            onResize: () => this._tocPanel?.refresh(),
            onViewChange: (key) => {
                // Sync icon bar — Workspace view maps to whichever icon was used
                if (key !== 'projects') {
                    this._iconBar.clearActive();
                }
            },
        });

        // Register sidebar views (content will be populated later)
        const projectsView = document.createElement('div');
        projectsView.className = 'sidebar-view-projects';
        this._sidebar.registerView('projects', { tabLabel: 'Workspace', title: 'Assets Management', element: projectsView });

        // TOC panel — lives inside the sidebar as a view
        this._tocPanel = new TocPanel(
            () => this._editor?.cells || [],
            (index) => this._editor?.selection.selectCell(index)
        );
        this._sidebar.registerView('toc', {
            tabLabel: 'Table of Contents',
            title: '',
            element: this._tocPanel.element,
            onActivate: () => this._tocPanel.activate(),
            onDeactivate: () => this._tocPanel.deactivate(),
        });

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

        // Forward wheel events from page margins to notebook container
        const notebookContainer = document.getElementById('notebook-container');
        document.addEventListener('wheel', (e) => {
            if (!notebookContainer.contains(e.target)) {
                notebookContainer.scrollBy(0, e.deltaY);
            }
        }, { passive: true });

        // Initialize editor
        this._editor = new NotebookEditor(
            document.getElementById('notebook-container'),
            this._client
        );

        // Update badges and TOC when cells change
        this._editor.onCellsChanged = () => {
            this._editor.updateNotesBadge(this._toolbar?.countNotes() || 0);
            this._tocPanel?.refresh();
        };

        // Auto-start kernel if stopped but venv is selected
        this._editor.onEnsureKernel = () => {
            if (this._kernelRunning) return Promise.resolve(true);
            if (!this._activeVenv) return Promise.resolve(false);
            return new Promise((resolve) => {
                const onStatus = (data) => {
                    if (data.status === 'idle' || data.status === 'busy') {
                        this._client.off('kernel:status', onStatus);
                        resolve(true);
                    }
                };
                this._client.on('kernel:status', onStatus);
                this._client.startKernel(this._activeVenv.runtimeId, this._activeVenv.name);
            });
        };

        // Initialize toolbar (nav icons + file actions + settings + users)
        this._toolbar = new NotebookToolbar(
            document.getElementById('toolbar'),
            this._client,
            {
                onImport: () => this._onImportNotebook(),
                onSave: () => this._editor.save(),
                onExport: () => this._editor.export(),
                onSettingsToggle: () => this._displaySettingsPanel.toggle(),
                onChatToggle: () => this._toggleChatPanel(),
                getCells: () => this._editor.cells,
                onSelectCell: (index) => this._editor.selection.selectCell(index),
            }
        );

        // Initialize info bar (decorative)
        this._infoBar = new InfoBar(document.getElementById('info-bar'));

        // Initialize tab bar (above notebook, inside center-column)
        this._serviceIframes = {};
        this._tabBar = new TabBar(
            document.getElementById('center-column'),
            {
                onActivateTab: (key) => this._onTabActivated(key),
                onCloseTab: (key) => this._onTabClosed(key),
            }
        );

        // Kernel selector click (in notebook top bar)
        this._editor.setOnKernelClick(() => {
            this._explorerPanel.setActiveVenv(
                this._activeVenv ? this._activeVenv.name : null
            );
            this._explorerPanel.open({
                currentProject: this._currentProject,
                currentNotebook: this._currentNotebook,
                navigateToVenv: this._activeVenv
                    ? `${this._activeVenv.runtimeId}:${this._activeVenv.name}`
                    : null,
                navigateToEnvs: !this._activeVenv,
            });
        });

        // Wire notebook bar callbacks to toolbar panels and file actions
        this._editor.setOnPostItToggle(() => this._toolbar._postItIndex.toggle());
        this._editor.setOnSave(() => this._toolbar._callbacks.onSave?.());
        this._editor.setOnImport(() => this._toolbar._callbacks.onImport?.());
        this._editor.setOnExport(() => this._toolbar._callbacks.onExport?.());

        // Initialize display settings panel (jsPanel)
        this._displaySettingsPanel = new DisplaySettingsPanel();

        // Initialize right panel (chat assistant)
        this._initRightPanel();

        // Initialize unified explorer panel (projects + environments)
        this._explorerPanel = new ExplorerPanel({
            onNotebookSelect: (projectId, notebookName) => this._onNotebookChange(projectId, notebookName),
            onVenvSelect: (venv) => this._onVenvSelect(venv),
            onVenvDeleted: (deletedName) => this._onVenvDeleted(deletedName),
        });

        // Track kernel running state
        this._client.on('kernel:status', (data) => {
            this._kernelRunning = data.status === 'idle' || data.status === 'busy';
            this._explorerPanel.setKernelRunning(this._kernelRunning);
        });

        // Connect Socket.IO
        this._client.connect();

        this._initialConnect = true;
        this._client.on('connected', () => {
            if (this._initialConnect) {
                this._initialConnect = false;
                console.log('Connected to server');
                return;
            }
            console.log('Reconnected to server');
            if (this._currentProject && this._currentNotebook) {
                this._editor.openNotebook(
                    this._currentProject,
                    this._currentNotebook,
                    this._userName
                );
                if (this._activeVenv) {
                    this._client.startKernel(this._activeVenv.runtimeId, this._activeVenv.name);
                }
            }
        });

        this._client.on('disconnected', (data) => {
            console.log('Disconnected:', data.reason);
        });

        this._client.on('error', (data) => {
            console.error('Server error:', data.message, data.code);
        });

        // Keyboard shortcuts (capture phase so they fire before CodeMirror)
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this._editor.save();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'Home') {
                e.preventDefault();
                e.stopPropagation();
                notebookContainer.scrollTo({ top: 0 });
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'End') {
                e.preventDefault();
                e.stopPropagation();
                notebookContainer.scrollTo({ top: notebookContainer.scrollHeight });
            }
            if (e.key === 'PageUp') {
                e.preventDefault();
                e.stopPropagation();
                notebookContainer.scrollBy(0, -notebookContainer.clientHeight);
            }
            if (e.key === 'PageDown') {
                e.preventDefault();
                e.stopPropagation();
                notebookContainer.scrollBy(0, notebookContainer.clientHeight);
            }
        }, true);

        // Show TOC in sidebar by default
        requestAnimationFrame(() => this._sidebar.show('toc'));

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
        this._activeVenv = null;

        this._editor.setProject(projectId);
        this._editor.setNotebook(null);
        this._editor.setVenv(null, null);
    }

    async _onNotebookChange(projectId, notebookName) {
        if (this._currentNotebook) {
            this._editor.closeNotebook();
        }
        if (!projectId || !notebookName) return;

        this._currentProject = projectId;
        this._currentNotebook = notebookName;

        this._editor.setProject(projectId);
        this._editor.setNotebook(notebookName);
        this._tabBar.setNotebookLabel(notebookName);
        this._sidebar.updateViewTitle('toc', notebookName);
        this._editor.openNotebook(projectId, notebookName, this._userName);

        // Restore persisted venv for this notebook, validating against API
        // localStorage format: "runtimeId:name" (e.g. "python/3.12:my-env")
        const savedVenv = localStorage.getItem(`notebook-venv:${projectId}:${notebookName}`);
        let restored = false;
        if (savedVenv) {
            // Parse "runtimeId:name" — runtimeId contains "/" so split on last ":"
            const lastColon = savedVenv.lastIndexOf(':');
            const runtimeId = lastColon > 0 ? savedVenv.substring(0, lastColon) : null;
            const name = lastColon > 0 ? savedVenv.substring(lastColon + 1) : savedVenv;
            try {
                const resp = await fetch('api/envs');
                if (resp.ok) {
                    const envs = await resp.json();
                    const match = envs.find(v => v.name === name && (!runtimeId || v.runtime_id === runtimeId));
                    if (match) {
                        this._activeVenv = { name: match.name, runtimeId: match.runtime_id, displayName: match.display_name };
                        this._editor.setVenv(match.name, match.display_name);
                        this._client.startKernel(match.runtime_id, match.name);
                        restored = true;
                    }
                }
            } catch { /* ignore */ }
            if (!restored) {
                // Stale or invalid — remove it
                localStorage.removeItem(`notebook-venv:${projectId}:${notebookName}`);
            }
        }
        if (!restored) {
            // No saved venv for this notebook — clear any previous state
            this._activeVenv = null;
            this._editor.setVenv(null);
            this._client.stopKernel();
        }

        // Update URL
        const url = new URL(window.location);
        url.searchParams.set('project', projectId);
        url.searchParams.set('notebook', notebookName);
        window.history.replaceState({}, '', url);
    }

    _onVenvSelect(venv) {
        this._activeVenv = venv;
        if (venv) {
            // Derive display name from runtimeId if not provided (e.g. "python/3.12" → "Python 3.12")
            const displayName = venv.displayName
                || (venv.runtimeId ? venv.runtimeId.replace(/^(\w)/, c => c.toUpperCase()).replace('/', ' ') : null);
            venv.displayName = displayName;
            this._editor.setVenv(venv.name, displayName);
            // Persist for this notebook (runtimeId:name)
            if (this._currentProject && this._currentNotebook) {
                localStorage.setItem(
                    `notebook-venv:${this._currentProject}:${this._currentNotebook}`,
                    `${venv.runtimeId}:${venv.name}`
                );
            }
            // Auto-start the kernel with the selected venv (only if a notebook is open)
            if (this._currentNotebook) {
                this._client.startKernel(venv.runtimeId, venv.name);
            }
        } else {
            this._editor.setVenv(null);
            if (this._currentProject && this._currentNotebook) {
                localStorage.removeItem(
                    `notebook-venv:${this._currentProject}:${this._currentNotebook}`
                );
            }
        }
    }

    _onVenvDeleted(deletedName) {
        if (!deletedName || !this._activeVenv) return;
        if (this._activeVenv.name === deletedName) {
            this._client.stopKernel();
            this._activeVenv = null;
            this._editor.setVenv(null);
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
        if (!this._activeVenv) {
            alert('Select a virtual environment first (click the environment area in the info bar)');
            return;
        }
        this._client.startKernel(this._activeVenv.runtimeId, this._activeVenv.name);
    }

    _initRightPanel() {
        const rightPanel = document.getElementById('right-panel');
        this._rightPanel = new RightPanel(rightPanel);

        // Assistant tab
        this._chatPanel = new ChatPanel();
        this._rightPanel.registerView('assistant', {
            tabLabel: 'Assistant',
            title: 'Chat Window',
            element: this._chatPanel.element,
        });

        // Prompts tab
        const promptsEl = document.createElement('div');
        promptsEl.className = 'prompts-view';
        this._rightPanel.registerView('prompts', {
            tabLabel: 'Prompts',
            title: 'LLM Management',
            element: promptsEl,
        });

        // Show Assistant by default
        this._rightPanel.show('assistant');

        this._chatService = new ChatService(this._chatPanel);
        this._chatService.connect().catch(err => {
            console.error('Chat service connection failed:', err);
        });
    }

    _toggleChatPanel() {
        const panel = document.getElementById('right-panel');
        this._chatVisible = !this._chatVisible;
        panel.style.display = this._chatVisible ? 'flex' : 'none';
    }

    _onIconBarClick(key) {
        if (key === 'projects' || key === 'environments') {
            // Both icons toggle the Workspace sidebar view
            const shown = this._sidebar.toggle('projects');
            if (shown) {
                this._explorerPanel.setActiveVenv(this._activeVenv ? this._activeVenv.name : null);
                this._explorerPanel.open({
                    currentProject: this._currentProject,
                    currentNotebook: this._currentNotebook,
                    navigateToEnvs: key === 'environments',
                });
            } else {
                this._explorerPanel.close();
            }
        } else if (key === 'mlflow' || key === 'airflow' || key === 'minio') {
            // Open service as a tab in the center pane
            const title = key.charAt(0).toUpperCase() + key.slice(1);
            this._tabBar.addTab({
                key,
                label: title,
                type: 'service',
                icon: `static/images/${key}.png`,
                closable: true,
            });
            this._iconBar.clearActive();
        } else if (key === 'settings') {
            this._displaySettingsPanel.toggle();
            this._iconBar.clearActive();
        }
    }

    _onTabActivated(key) {
        const notebookContainer = document.getElementById('notebook-container');
        const serviceContainer = document.getElementById('service-tab-container');

        if (key === 'notebook') {
            // Show notebook, hide service iframe
            notebookContainer.style.display = '';
            serviceContainer.style.display = 'none';
        } else {
            // Show service iframe, hide notebook
            notebookContainer.style.display = 'none';
            serviceContainer.style.display = 'block';

            // Create or reuse iframe for this service
            if (!this._serviceIframes[key]) {
                const iframe = document.createElement('iframe');
                iframe.src = `/${key}`;
                iframe.dataset.serviceKey = key;
                this._serviceIframes[key] = iframe;
            }

            // Show only the active service iframe
            serviceContainer.innerHTML = '';
            serviceContainer.appendChild(this._serviceIframes[key]);
        }
    }

    _onTabClosed(key) {
        // Remove cached iframe
        if (this._serviceIframes[key]) {
            this._serviceIframes[key].remove();
            delete this._serviceIframes[key];
        }
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
