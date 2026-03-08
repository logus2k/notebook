# noted

A collaborative Jupyter-compatible notebook platform with real-time multi-user editing, multi-runtime kernel execution, and environment management.

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

The same image works on both GPU and CPU-only hosts -- GPU is auto-detected at runtime.

## Features

- **Real-time collaboration** -- Multiple users can edit the same notebook simultaneously with cell-level locking and live synchronization via Socket.IO
- **Multi-runtime support** -- Python 3.10, 3.11, 3.12, 3.13, and 3.14, including free-threaded (nogil) variants for 3.13 and 3.14
- **Environment management** -- Create isolated virtual environments per runtime version, install/uninstall packages from the UI
- **Kernel execution** -- Run code cells with streaming output, powered by Jupyter kernel protocol (jupyter_client + ipykernel)
- **Markdown cells** -- Write and preview markdown with LaTeX math rendering (KaTeX)
- **Multi-cell selection** -- Keyboard-driven cell navigation, selection, move, copy/cut/paste, and drag-and-drop reordering
- **CodeMirror 6 editor** -- Syntax highlighting, line numbers, multiple themes
- **Notebook import/export** -- Standard `.ipynb` format compatible with Jupyter
- **GPU acceleration** -- CUDA runtime included for frameworks like PyTorch and TensorFlow
- **File explorer** -- Browse projects, notebooks, and environments from a tree-view panel (Wunderbaum)
- **Display settings** -- Configurable editor themes and display preferences via a dedicated panel
- **Split views** -- Resizable panel layout with Split.js

## Development

### Docker Compose

With GPU support (default):

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

## Architecture

```
backend/
  app/
    main.py                 FastAPI + Socket.IO entry point
    config.py               Paths and constants
    managers/
      kernel_manager.py     Jupyter kernel lifecycle
      env_manager.py        Runtime registry and environment management
      venv_manager.py       Virtual environment creation and package ops
      execution_bridge.py   Kernel output streaming
      collaboration.py      Multi-user rooms and cell locking
      notebook_manager.py   .ipynb file storage
      external_projects.py  External projects config singleton
    routers/
      notebooks.py          REST API for projects/notebooks
      venvs.py              REST API for runtimes and environments

frontend/
  index.html                Single-page app shell
  js/
    app.js                  Bootstrap and orchestration
    KernelClient.js         Socket.IO client wrapper
    NotebookEditor.js       Notebook and cell array management
    CellEditor.js           CodeMirror per-cell editor
    CellOutput.js           Output renderer (text, HTML, images, errors)
    InfoBar.js              Kernel status and controls
    NotebookToolbar.js      Project/notebook selectors, user avatars
    panels/
      ExplorerPanel.js      File and environment tree explorer
      BrowserPanel.js       Project/notebook browser
      ProjectPanel.js       Project management
      NotebookPanel.js      Notebook management
      EnvironmentPanel.js   Virtual environment panel
      DisplaySettingsPanel.js  Editor themes and display preferences
  css/
    base.css                Global styles and variables
    toolbar.css             Top toolbar layout
    info-bar.css            Kernel status bar
    panels.css              Shared panel styles
    notebook.css            Notebook container
    cell.css                Cell layout and states
    output.css              Cell output rendering
    venv-panel.css          Environment panel styles
    explorer-panel.css      File explorer styles
    settings-panel.css      Display settings styles

scripts/
  entrypoint.sh             Container entrypoint
  create_runtime_configs.sh Auto-generates runtime descriptors
  link_external_projects.sh Links external notebook directories

data/
  projects/                 Notebooks organized by project
  environments/             Virtual environments grouped by runtime
  runtimes/                 Auto-generated runtime.json descriptors
  projects.txt             External projects config (optional)
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | FastAPI, python-socketio, Uvicorn |
| Kernel | jupyter_client, ipykernel, pyzmq |
| Frontend | Vanilla ES6 modules, CodeMirror 6 |
| Real-time | Socket.IO |
| UI Panels | jsPanel, Wunderbaum, Split.js |
| Icons | Font Awesome |
| Markdown | Marked, Highlight.js, KaTeX |
| Container | Docker, NVIDIA CUDA 13.1 runtime |

## External Projects

You can link existing notebook directories from your host machine into noted. This lets you work on notebooks that live in other projects (e.g. VS Code workspaces) without copying them.

### 1. Mount host directories into the container

Add volume mounts for the directories containing your notebooks:

```bash
docker run -d -p 8123:8123 \
  -v noted_data:/app/data \
  -v ~/projects:/workspace/projects \
  -v ~/courses:/workspace/courses \
  --gpus all --name noted logus2k/noted
```

### 2. Create a config file

Create `data/projects.txt` in your noted data volume. This is an INI-style file where each section is a project name and lines underneath are container-internal paths to scan for `.ipynb` files:

```ini
# My ML research project
[ML Research]
/workspace/projects/ml-research
/workspace/projects/ml-research/experiments/*

# University course notebooks
[Deep Learning Course]
/workspace/courses/dl/notebooks
```

A project can have multiple source paths. Lines starting with `#` are comments. Append `/*` to a path to scan it recursively (all subdirectories); without it, only notebooks in the immediate directory are linked.

### 3. Restart the container

On each startup, noted reads `projects.txt` and symlinks all `.ipynb` files from the configured paths into its project structure. Stale symlinks are cleaned up automatically.

### How it works

- Symlinks are created inside the container, so this works on all host OSes (Linux, macOS, Windows)
- noted never modifies your host directory structure -- it only reads/writes `.ipynb` file contents
- Real (non-symlink) files in a project's notebooks directory are never touched
- If a configured path doesn't exist, it is skipped with a warning
- New notebooks created on the host appear after restarting the container

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
