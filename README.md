# noted

A collaborative Jupyter-compatible notebook platform with real-time multi-user editing, environment management, per-project git version control, and MLOps integrations.

## Quick Start

### With GPU support

Requires an NVIDIA GPU and the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).

```bash
docker run -d -p 8123:8123 -v noted_data:/app/data --gpus all --name noted logus2k/noted
```

### CPU only

```bash
docker run -d -p 8123:8123 -v noted_data:/app/data --name noted logus2k/noted
```

Open [http://localhost:8123](http://localhost:8123) in your browser.

## Features

- **Real-time collaboration** — Multiple users can edit the same notebook simultaneously with cell-level locking and live cursor sync via Socket.IO
- **Multi-runtime support** — Python 3.10, 3.11, 3.12, 3.13, and 3.14, including free-threaded (nogil) variants
- **Environment management** — Create isolated virtual environments per runtime, install/uninstall packages with `uv` or `pip` from the UI with live terminal output
- **Git version control** — Per-project local git repositories: init, stage, commit, browse history, and view diffs in a dedicated CodeMirror diff viewer
- **Python source files** — Edit `.py` files in `src/` alongside notebooks; `PYTHONPATH` is injected into kernels so notebooks can `import` from them directly
- **Document viewer** — Browse and render Markdown and PDF documents from the workspace
- **MLflow integration** — Kernels auto-connect to the platform MLflow instance; `MLFLOW_TRACKING_URI` and `MLFLOW_EXPERIMENT_NAME` are injected automatically
- **Kernel execution** — Run code cells with streaming output, powered by the Jupyter kernel protocol (`jupyter_client` + `ipykernel`)
- **Markdown cells** — Write and preview markdown with LaTeX math rendering (KaTeX)
- **CodeMirror 6 editor** — Syntax highlighting, line numbers, multiple themes, for cells, Python files, and the git diff viewer
- **Notebook import/export** — Standard `.ipynb` format compatible with Jupyter
- **GPU acceleration** — CUDA runtime included for frameworks like PyTorch and TensorFlow
- **AI assistant** — Built-in chat panel connected to an external LLM agent

## UI Layout

noted uses a VS Code-inspired four-column layout:

```
┌──────┬──────────┬───────────────────────┬────────────┐
│ Icon │ Sidebar  │   Center (tabs)       │   Chat     │
│ Bar  │          │                       │   Panel    │
│      │ Workspace│  Notebook             │            │
│      │ ToC      │  Workspace detail     │            │
│      │ Git      │  Python file editor   │            │
│      │          │  Git History diff     │            │
│      │          │  Service iframes      │            │
└──────┴──────────┴───────────────────────┴────────────┘
```

- **Icon Bar** — Switch between sidebar views; links to MLflow, Airflow, MinIO
- **Sidebar** — Collapsible; contains Workspace tree, Table of Contents, Git panel
- **Center tabs** — Notebook, workspace detail, Python files, git commit diffs, service iframes
- **Chat panel** — AI assistant (collapsible)

## Development

### Docker Compose

With GPU support:

```bash
docker compose up -d --build
```

CPU only:

```bash
docker compose -f docker-compose.cpu.yml up -d --build
```

### Run locally

Prerequisites: Python 3.12+, `gcc`, `libzmq3-dev`

```bash
pip install -r backend/requirements.txt
uvicorn app.main:socket_app --host 0.0.0.0 --port 8123 --app-dir backend
```

### Rebuilding the CodeMirror bundle

The frontend uses a pre-built CodeMirror 6 ESM bundle committed at `frontend/vendor/codemirror/codemirror.bundle.js`. **You do not need to rebuild it for normal development** — just pull and go.

Rebuild only when you need to:
- Update CodeMirror to a newer version
- Add a new export to the bundle (e.g. a new extension or language pack)

```bash
cd scripts/build-codemirror
npm install
npm run build
```

Then commit the updated `frontend/vendor/codemirror/codemirror.bundle.js`.

To add a new export, edit `scripts/build-codemirror/bundle-entry.js`, then rebuild.

## Architecture

```
backend/
  app/
    main.py                   FastAPI + Socket.IO entry point
    config.py                 Paths and constants
    managers/
      kernel_manager.py       Jupyter kernel lifecycle + PYTHONPATH/env injection
      env_manager.py          Runtime registry and environment management
      venv_manager.py         Virtual environment creation and package ops
      execution_bridge.py     Kernel output streaming
      collaboration.py        Multi-user rooms and cell locking
      notebook_manager.py     .ipynb file storage
      git_manager.py          Per-project git operations (init/status/commit/log/diff)
      source_file_manager.py  Python source file CRUD (src/ per project)
      document_manager.py     Markdown and PDF document catalog
    routers/
      notebooks.py            REST API for projects/notebooks
      venvs.py                REST API for runtimes and environments
      git.py                  REST API for git operations
      source_files.py         REST API for Python source files
      documents.py            REST API for documents

frontend/
  index.html                  Single-page app shell
  js/
    app.js                    Bootstrap and orchestration
    KernelClient.js           Socket.IO client wrapper
    NotebookEditor.js         Notebook and cell array management
    CellEditor.js             CodeMirror per-cell editor
    CellOutput.js             Output renderer (text, HTML, images, errors)
    GitPanel.js               Sidebar git panel (status, commit form, history)
    GitCommitViewer.js        CodeMirror-based commit diff viewer (center tab)
    PythonFileEditor.js       CodeMirror editor for .py source files
    IconBar.js                Left icon bar
    SidebarPanel.js           Collapsible sidebar with named views
    TabBar.js                 Center-area tab bar
    TocPanel.js               Table of contents sidebar view
    InfoBar.js                Decorative info bar
    NotebookToolbar.js        Toolbar (connected users)
    NotebookEditor.js         Notebook bars, breadcrumbs, kernel selector
    ChatService.js            AI assistant WebSocket client
    RightPanel.js             Chat panel container
    Notify.js                 Toast notification wrapper (Notyf)
    panels/
      ExplorerPanel.js        Workspace tree (projects, envs, docs, src files)
      DocumentViewer.js       Markdown/PDF document renderer
      DisplaySettingsPanel.js Editor themes and display preferences
  css/
    base.css                  Global styles, CSS variables, scrollbars
    icon-bar.css              Left icon bar
    sidebar.css               Sidebar panel
    tab-bar.css               Center tab bar
    notebook.css              Notebook container and bars
    cell.css                  Cell layout and states
    output.css                Cell output rendering
    panels.css                jsPanel floating windows
    git-panel.css             Git sidebar panel + commit diff viewer
    python-file-editor.css    Python file editor
    right-panel.css           Chat panel
    chat-panel.css            Chat message styles
    explorer-panel.css        Workspace tree styles
    venv-panel.css            Environment panel styles
    settings-panel.css        Display settings styles

scripts/
  entrypoint.sh               Container entrypoint
  create_runtime_configs.sh   Auto-generates runtime descriptors
  link_external_projects.sh   Links external notebook directories
  build-codemirror/
    bundle-entry.js           CodeMirror bundle entry (all exports)
    package.json              npm dependencies for the bundle builder
    build.sh                  Linux/macOS build convenience script
    .gitignore                Excludes node_modules from git

data/
  projects/                   Notebooks and source files by project
  environments/               Virtual environments grouped by runtime
  runtimes/                   Auto-generated runtime.json descriptors
  projects.txt                External projects config (optional)
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | FastAPI, python-socketio, Uvicorn |
| Kernel | jupyter_client, ipykernel, pyzmq |
| Frontend | Vanilla ES6 modules, CodeMirror 6 |
| Real-time | Socket.IO |
| UI Panels | jsPanel, Wunderbaum, Split.js |
| Notifications | Notyf |
| Icons | Font Awesome |
| Markdown | Marked, Highlight.js, KaTeX |
| PDF | pdf.js (ESM) |
| Package install | uv (default), pip |
| Version control | git (subprocess) |
| MLOps | MLflow, Airflow, MinIO (via Docker Compose stack) |
| Container | Docker, NVIDIA CUDA 13.1 runtime |

## External Projects

You can link existing notebook directories from your host machine into noted. This lets you work on notebooks that live in other projects without copying them.

### 1. Mount host directories into the container

```bash
docker run -d -p 8123:8123 \
  -v noted_data:/app/data \
  -v ~/projects:/workspace/projects \
  --gpus all --name noted logus2k/noted
```

### 2. Create a config file

Create `data/projects.txt` (INI-style, each section is a project name):

```ini
[ML Research]
/workspace/projects/ml-research
/workspace/projects/ml-research/experiments/*

[Deep Learning Course]
/workspace/courses/dl/notebooks
```

Append `/*` to a path to scan subdirectories recursively. Lines starting with `#` are comments.

### 3. Restart the container

On startup, noted reads `projects.txt` and symlinks all `.ipynb` files into its project structure. Stale symlinks are cleaned up automatically.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+S | Save notebook |
| Shift+Enter | Run cell |
| Ctrl+Enter | Run cell |
| Escape | Enter command mode |
| Enter | Enter edit mode |
| Arrow Up/Down | Navigate cells (command mode) |
| Shift+Arrow | Extend cell selection |
| Alt+Arrow | Move selected cells |
| Ctrl+C/X/V | Copy/cut/paste cells (command mode) |
| Delete | Delete selected cells (command mode) |

## License

[Apache License 2.0](LICENSE.md)
