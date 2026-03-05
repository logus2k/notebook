# noted

A collaborative Jupyter-compatible notebook platform with real-time multi-user editing, integrated Python kernel execution, and virtual environment management.

## Features

- **Real-time collaboration** -- Multiple users can edit the same notebook simultaneously with cell-level locking and live synchronization via Socket.IO
- **Python kernel execution** -- Run code cells with streaming output, powered by Jupyter kernel protocol (jupyter_client + ipykernel)
- **Virtual environment management** -- Create project-scoped or shared Python environments, install/uninstall packages from the UI
- **Markdown cells** -- Write and preview markdown with LaTeX math rendering (KaTeX)
- **Multi-cell selection** -- Keyboard-driven cell navigation, selection, move, copy/cut/paste, and drag-and-drop reordering
- **CodeMirror 6 editor** -- Syntax highlighting, line numbers, multiple themes
- **Notebook import/export** -- Standard `.ipynb` format compatible with Jupyter

## Quick Start

```bash
docker compose up -d
```

Open [http://localhost:8123](http://localhost:8123) in your browser.

## Development

### Prerequisites

- Python 3.12+
- System packages: `gcc`, `libzmq3-dev`

### Run locally

```bash
pip install -r backend/requirements.txt
uvicorn app.main:socket_app --host 0.0.0.0 --port 8123 --app-dir backend
```

## Architecture

```
backend/
  app/
    main.py                 FastAPI + Socket.IO entry point
    kernel_manager.py       Jupyter kernel lifecycle
    execution_bridge.py     Kernel output streaming
    collaboration.py        Multi-user rooms and cell locking
    notebook_manager.py     .ipynb file storage
    venv_manager.py         Virtual environment management
    routers/
      notebooks.py          REST API for projects/notebooks
      venvs.py              REST API for environments

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
  css/                      Stylesheets

data/
  projects/                 Notebooks and project-scoped venvs
  shared_venvs/             Shared virtual environments
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | FastAPI, python-socketio, Uvicorn |
| Kernel | jupyter_client, ipykernel, pyzmq |
| Frontend | Vanilla ES6 modules, CodeMirror 6 |
| Real-time | Socket.IO |
| UI Panels | jsPanel |
| Markdown | Marked, Highlight.js, KaTeX |
| Deploy | Docker |

### Data science libraries included

NumPy, Pandas, Matplotlib, Seaborn, Scikit-learn, SciPy, Plotly, Statsmodels, Pillow

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
