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
import { DocumentViewer } from './panels/DocumentViewer.js';


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
        this._documentViewer = null;
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
                onChatToggle: () => this._toggleChatPanel(),
            }
        );

        // Initialize sidebar panel (between icon bar and content area)
        this._sidebar = new SidebarPanel({
            onResize: () => this._tocPanel?.refresh(),
            onViewChange: (key) => {
                // Sync icon bar with sidebar view
                if (key === 'projects') {
                    this._iconBar.setActive('projects');
                } else {
                    this._iconBar.clearActive();
                }
            },
        });

        // Initialize unified explorer panel (projects + environments)
        this._workspaceTitleEl = null;
        this._workspaceBreadcrumbBar = null;
        this._explorerPanel = new ExplorerPanel({
            onNotebookSelect: (projectId, notebookName) => this._onNotebookChange(projectId, notebookName),
            onVenvSelect: (venv) => this._onVenvSelect(venv),
            onVenvDeleted: (deletedName) => this._onVenvDeleted(deletedName),
            onSectionChange: (section) => this._updateWorkspaceTitle(section),
            onBreadcrumbChange: (crumbs) => this._updateWorkspaceBreadcrumbs(crumbs),
            onActivate: () => this._openWorkspaceTab(),
            onDocumentOpen: (doc) => this._openDocumentTab(doc),
        });

        // Register sidebar views — tree from ExplorerPanel
        this._sidebar.registerView('projects', {
            tabLabel: 'Workspace',
            title: 'Assets Management',
            element: this._explorerPanel.treeElement,
        });

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
                onSave: () => this._editor.save(),
                onSettingsToggle: () => this._openSettingsTab(),
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
            // Open sidebar tree + workspace tab, navigate to env
            this._sidebar.show('projects');
            this._iconBar.setActive('projects');
            this._openWorkspaceTab();
            this._explorerPanel.navigate({
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

        // Initialize display settings panel (jsPanel)
        this._displaySettingsPanel = new DisplaySettingsPanel();

        // Initialize document viewer (for MD/PDF rendering in center pane)
        this._documentViewer = new DocumentViewer();

        // Initialize right panel (chat assistant)
        this._initRightPanel();

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

        // Load workspace tree data (deferred so DOM is ready)
        this._explorerPanel.init();

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
        this._tabBar.activate('notebook');
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
            title: 'Chat',
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
        if (key === 'projects') {
            // Toggle the Workspace sidebar view + workspace tab
            const shown = this._sidebar.toggle('projects');
            if (shown) {
                this._explorerPanel.setActiveVenv(this._activeVenv ? this._activeVenv.name : null);
                this._openWorkspaceTab();
                this._explorerPanel.navigate({
                    currentProject: this._currentProject,
                    currentNotebook: this._currentNotebook,
                });
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
            this._iconBar.setTabIndicator(key, true);
        } else if (key === 'settings') {
            this._openSettingsTab();
            this._iconBar.clearActive();
            this._iconBar.setTabIndicator(key, true);
        }
    }

    _onTabActivated(key) {
        const notebookContainer = document.getElementById('notebook-container');
        const serviceContainer = document.getElementById('service-tab-container');

        // Hide all persistent service wrappers
        for (const wrapper of serviceContainer.querySelectorAll('.service-wrapper')) {
            wrapper.style.display = 'none';
        }

        // Detach reusable elements (workspace, settings, docs) before clearing transient content
        const wsDetail = serviceContainer.querySelector('.explorer-detail-pane');
        if (wsDetail) wsDetail.remove();
        const settingsEl = serviceContainer.querySelector('.settings-panel-wrapper');
        if (settingsEl) settingsEl.remove();
        const docViewer = serviceContainer.querySelector('.document-viewer-wrapper');
        if (docViewer) docViewer.remove();
        // Remove transient bars (workspace/settings/doc bars)
        for (const bar of serviceContainer.querySelectorAll('.service-top-bar:not(.service-wrapper .service-top-bar), .service-second-bar:not(.service-wrapper .service-second-bar)')) {
            bar.remove();
        }

        if (key === 'notebook') {
            // Show notebook, hide service container
            notebookContainer.style.display = '';
            serviceContainer.style.display = 'none';
        } else if (key === 'workspace') {
            // Show workspace detail pane
            notebookContainer.style.display = 'none';
            serviceContainer.style.display = 'flex';
            serviceContainer.appendChild(this._buildWorkspaceBars());
            serviceContainer.appendChild(this._explorerPanel.detailElement);
        } else if (key === 'settings') {
            // Show settings pane
            notebookContainer.style.display = 'none';
            serviceContainer.style.display = 'flex';
            serviceContainer.appendChild(this._buildSettingsBars());
            serviceContainer.appendChild(this._displaySettingsPanel.element);
        } else if (key.startsWith('doc:')) {
            // Show document viewer
            notebookContainer.style.display = 'none';
            serviceContainer.style.display = 'flex';
            serviceContainer.appendChild(this._buildDocumentBars(key));
            serviceContainer.appendChild(this._documentViewer.element);
        } else {
            // Show service iframe (persistent wrapper)
            notebookContainer.style.display = 'none';
            serviceContainer.style.display = 'flex';

            // Create persistent wrapper on first use
            if (!this._serviceIframes[key]) {
                const wrapper = document.createElement('div');
                wrapper.className = 'service-wrapper';
                wrapper.dataset.serviceKey = key;
                wrapper.style.cssText = 'display:flex; flex-direction:column; flex:1; min-height:0;';

                wrapper.appendChild(this._buildServiceBars(key));

                const iframe = document.createElement('iframe');
                iframe.src = `/${key}`;
                wrapper.appendChild(iframe);

                serviceContainer.appendChild(wrapper);
                this._serviceIframes[key] = wrapper;
            }

            // Show the wrapper
            this._serviceIframes[key].style.display = 'flex';
        }
    }

    _buildServiceBars(key) {
        const frag = document.createDocumentFragment();

        const bar = document.createElement('div');
        bar.className = 'service-top-bar';

        const title = document.createElement('span');
        title.className = 'service-top-bar-title';
        const names = { airflow: 'Apache Airflow', mlflow: 'MLflow', minio: 'MinIO' };
        title.textContent = names[key] || key;
        bar.appendChild(title);

        const spacer = document.createElement('span');
        spacer.className = 'service-top-bar-spacer';
        bar.appendChild(spacer);

        const statusLabel = document.createElement('span');
        statusLabel.className = 'service-status-label';
        statusLabel.textContent = 'checking...';
        bar.appendChild(statusLabel);

        const led = document.createElement('span');
        led.className = 'service-status-led';
        bar.appendChild(led);

        // Check connection status
        this._checkServiceStatus(key, led, statusLabel);

        frag.appendChild(bar);
        frag.appendChild(this._buildSecondBar());
        return frag;
    }

    _openWorkspaceTab() {
        this._tabBar.addTab({
            key: 'workspace',
            label: 'Workspace',
            type: 'workspace',
            closable: true,
        });
    }

    _openSettingsTab() {
        this._tabBar.addTab({
            key: 'settings',
            label: 'Settings',
            type: 'settings',
            closable: true,
        });
    }

    _openDocumentTab(doc) {
        const tabKey = `doc:${doc.category}:${doc.name}`;
        this._tabBar.addTab({
            key: tabKey,
            label: doc.name,
            type: 'document',
            closable: true,
        });
        // Load the document into the viewer
        this._documentViewer.show(doc);
    }

    _buildSettingsBars() {
        const frag = document.createDocumentFragment();

        const bar = document.createElement('div');
        bar.className = 'service-top-bar';

        const title = document.createElement('span');
        title.className = 'service-top-bar-title';
        title.textContent = 'Application Settings';
        bar.appendChild(title);

        frag.appendChild(bar);
        frag.appendChild(this._buildSecondBar());
        return frag;
    }

    _buildWorkspaceBars() {
        const frag = document.createDocumentFragment();

        const bar = document.createElement('div');
        bar.className = 'service-top-bar';

        const title = document.createElement('span');
        title.className = 'service-top-bar-title';
        title.textContent = 'Workspace';
        this._workspaceTitleEl = title;
        bar.appendChild(title);

        frag.appendChild(bar);
        this._workspaceBreadcrumbBar = this._buildSecondBar();
        frag.appendChild(this._workspaceBreadcrumbBar);
        return frag;
    }

    _buildDocumentBars(key) {
        const frag = document.createDocumentFragment();

        const bar = document.createElement('div');
        bar.className = 'service-top-bar';

        const title = document.createElement('span');
        title.className = 'service-top-bar-title';
        // Extract document name from key "doc:category:name"
        const parts = key.substring(4).split(':');
        title.textContent = parts.length > 1 ? parts.slice(1).join(':') : key;
        bar.appendChild(title);

        frag.appendChild(bar);

        // Second bar with breadcrumbs
        const secondBar = this._buildSecondBar();
        const category = parts[0] || '';
        const docName = parts.slice(1).join(':') || '';
        const crumbs = ['Documents', category, docName].filter(Boolean);
        crumbs.forEach((text, i) => {
            if (i > 0) {
                const sep = document.createElement('span');
                sep.className = 'breadcrumb-sep';
                sep.textContent = '|';
                secondBar.appendChild(sep);
            }
            const span = document.createElement('span');
            span.className = 'breadcrumb-segment';
            if (i === crumbs.length - 1) span.classList.add('breadcrumb-current');
            span.textContent = text;
            secondBar.appendChild(span);
        });
        frag.appendChild(secondBar);
        return frag;
    }

    _buildSecondBar() {
        const bar = document.createElement('div');
        bar.className = 'service-second-bar';
        return bar;
    }

    _updateWorkspaceTitle(section) {
        if (this._workspaceTitleEl) {
            this._workspaceTitleEl.textContent = section;
        }
    }

    _updateWorkspaceBreadcrumbs(info) {
        if (!this._workspaceBreadcrumbBar) return;
        this._workspaceBreadcrumbBar.innerHTML = '';
        const { crumbs, rootCount } = info;

        // Root level: "Create X" on left, "n X" on right
        if (crumbs.length === 1 && rootCount !== undefined) {
            const section = crumbs[0]; // 'Projects', 'Environments', or 'Documents'
            const singularMap = { Projects: 'Project', Environments: 'Environment', Documents: 'Document' };
            const singular = singularMap[section] || section;
            const actionMap = { Projects: 'Create Project', Environments: 'Create Environment', Documents: 'Upload Document' };
            const actionText = actionMap[section] || `Create ${singular}`;

            const left = document.createElement('div');
            left.className = 'service-second-bar-left';
            const action = document.createElement('span');
            action.className = 'breadcrumb-segment breadcrumb-current';
            action.textContent = actionText;
            left.appendChild(action);

            const right = document.createElement('div');
            right.className = 'service-second-bar-right';
            const count = document.createElement('span');
            count.className = 'breadcrumb-segment';
            count.textContent = `${rootCount} ${rootCount !== 1 ? section : singular}`;
            right.appendChild(count);

            this._workspaceBreadcrumbBar.appendChild(left);
            this._workspaceBreadcrumbBar.appendChild(right);
            return;
        }

        // Deeper levels: breadcrumb trail with separators
        crumbs.forEach((text, i) => {
            if (i > 0) {
                const sep = document.createElement('span');
                sep.className = 'breadcrumb-sep';
                sep.textContent = '|';
                this._workspaceBreadcrumbBar.appendChild(sep);
            }
            const span = document.createElement('span');
            span.className = 'breadcrumb-segment';
            if (i === crumbs.length - 1) span.classList.add('breadcrumb-current');
            span.textContent = text;
            this._workspaceBreadcrumbBar.appendChild(span);
        });
    }

    _checkServiceStatus(key, led, label) {
        fetch(`/${key}/`)
            .then(res => {
                if (res.ok) {
                    led.classList.add('connected');
                    led.classList.remove('disconnected');
                    label.textContent = 'Connected';
                } else {
                    led.classList.add('disconnected');
                    led.classList.remove('connected');
                    label.textContent = 'unreachable';
                }
            })
            .catch(() => {
                led.classList.add('disconnected');
                led.classList.remove('connected');
                label.textContent = 'unreachable';
            });
    }

    _onTabClosed(key) {
        // Clean up document viewer when its tab is closed
        if (key.startsWith('doc:')) {
            this._documentViewer.clear();
        }
        // Hide persistent service wrapper (keep iframe alive)
        if (this._serviceIframes[key]) {
            this._serviceIframes[key].style.display = 'none';
        }
        // Remove accent bar from the service icon
        this._iconBar.setTabIndicator(key, false);
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
