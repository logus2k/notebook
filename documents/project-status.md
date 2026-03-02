# Notebook Collaboration Platform - Project Status

## Current State

The PoC is functional with the core execution loop working end-to-end.

### Working Features

**Backend**

- FastAPI + Socket.IO server running on uvicorn
- Project CRUD via REST API (create, list)
- Notebook CRUD via REST API (create, list, get, update, delete)
- Venv management via REST API (create, delete, list packages, install, uninstall)
- Support for both project-scoped and shared venvs
- Kernel lifecycle management via jupyter_client (start, stop, restart, interrupt)
- Execution bridge: ZMQ to Socket.IO streaming of cell outputs
- Collaboration manager with Socket.IO rooms and cell-level locking with lease TTL
- Heartbeat-based idle kernel timeout and lock renewal
- Automatic cleanup on client disconnect (locks released, kernel stopped, room left)

**Frontend**

- Project selector with inline create button
- Notebook selector with inline create button
- CodeMirror 6 code editor per cell with Python syntax highlighting and oneDark theme
- Cell execution via Shift+Enter or Ctrl+Enter or Run button
- Streamed output rendering (stdout, stderr, execute_result, display_data, errors)
- Kernel controls (Start, Stop, Restart, Interrupt) with status indicator
- Venv selector dropdown (grouped by project/shared)
- Venv management slide-out panel (create venv, view/install packages)
- Add Code / Add Markdown cell buttons
- Markdown cell rendering with edit/preview toggle (click rendered markdown to edit)
- Cell delete functionality
- Connected users display (avatar circles)
- URL-based auto-open (project and notebook params)
- Ctrl+S save shortcut
- Socket.IO heartbeat every 30 seconds

### Bug Fixes Applied

- Fixed async enter_room/leave_room calls in collaboration manager
- Fixed kernel spec lookup failure by injecting a minimal KernelSpec directly
- Fixed CodeMirror duplicate @codemirror/state instances via esm.sh ?deps pinning
- Fixed double notebook open on page load (suppress toolbar events during init, async project change)

---

## What Is Missing

### Phase 4 Gaps - Cell Editing (partially done)

- **Cell reordering via drag and drop**: drag handle is styled but not wired up
- **Cell move via keyboard**: no up/down cell movement shortcuts
- **Save persists outputs**: currently toJSON() saves cell source but uses stale outputs from the original data rather than capturing outputs produced during the session
- **Markdown preview on Shift+Enter**: running a markdown cell should render it instead of sending to kernel
- **Cell type switching**: no way to change a cell from code to markdown or vice versa

### Phase 5 Gaps - Collaboration (partially done)

- **Cell locking UI feedback for self**: when you lock a cell, there is no visual confirmation on your own client
- **Lock denial feedback**: if lock is denied, the error is logged to console but no toast/notification is shown
- **Concurrent editing tested**: rooms and broadcasting are implemented but not yet tested with multiple browser tabs
- **Conflict edge cases**: lock expiry during active editing could lead to overwrites (last-write-wins is the accepted MVP behavior)

### General Missing Features

- **Notebook save on cell change**: changes are broadcast to other clients but not auto-saved to disk; only manual Ctrl+S or Save button persists
- **Auto-save / dirty indicator**: no visual indicator that unsaved changes exist
- **Error toasts/notifications**: server errors are logged to console only, no user-facing feedback
- **Delete project / delete notebook UI**: only creatable from the toolbar, no delete buttons in the UI (available via REST API)
- **Import existing .ipynb**: no upload/import functionality; notebooks must be manually copied to the data directory or created empty via UI
- **Notebook download/export**: no way to download the .ipynb file from the UI
- **Cell output persistence on save**: outputs generated during execution should be captured and saved with the notebook
- **Run All behavior**: currently fires all cells simultaneously; should run sequentially (wait for each cell to complete before running the next)
- **Execution count display**: execution count updates on complete but resets on page reload since outputs are not persisted
- **Cell selection / focus management**: no concept of "active cell" for keyboard navigation between cells
- **Undo at notebook level**: CodeMirror has per-cell undo, but no notebook-level undo for cell add/delete/move
- **Loading states**: no loading indicators during project/notebook/venv creation or kernel startup
- **Reconnection handling**: Socket.IO reconnects automatically but does not re-open the notebook or restore state after reconnection
- **Favicon**: 404 on favicon.ico

### Deferred (per spec)

- Authentication (clients identified by Socket.IO SID only)
- File upload (drag and drop notebook import)
- Terminal access (web terminal to venv)
- Git integration (version control for notebooks)
- Resource limits (CPU/RAM caps per kernel)
- Export (notebooks as HTML/PDF)
- Autocomplete (Python autocomplete via kernel introspection)

---

## File Inventory

### Backend (backend/app/)

| File | Lines | Purpose |
|------|-------|---------|
| config.py | 16 | Paths, constants, defaults |
| main.py | 210 | FastAPI + Socket.IO app, all event handlers |
| managers/notebook_manager.py | 120 | Notebook file CRUD |
| managers/venv_manager.py | 130 | Venv lifecycle + packages |
| managers/kernel_manager.py | 170 | Kernel process management |
| managers/execution_bridge.py | 110 | ZMQ to Socket.IO bridge |
| managers/collaboration.py | 205 | Rooms, locks, broadcast |
| routers/notebooks.py | 65 | REST endpoints for notebooks |
| routers/venvs.py | 95 | REST endpoints for venvs |

### Frontend (frontend/)

| File | Lines | Purpose |
|------|-------|---------|
| index.html | 31 | Entry point, CDN imports |
| js/app.js | 145 | Bootstrap, wiring, URL routing |
| js/KernelClient.js | 195 | Socket.IO wrapper |
| js/NotebookEditor.js | 325 | Cell array management, remote sync |
| js/CellEditor.js | 345 | CodeMirror per cell, lock/focus/run |
| js/CellOutput.js | 141 | Output renderer |
| js/NotebookToolbar.js | 340 | Toolbar with selectors and controls |
| js/VenvPanel.js | 324 | Venv management panel |
| css/base.css | 121 | Reset, variables, scrollbar |
| css/toolbar.css | 100 | Toolbar layout |
| css/notebook.css | 95 | Notebook container |
| css/cell.css | 206 | Cell styling, CodeMirror overrides |
| css/output.css | 150 | Output rendering |
| css/venv-panel.css | 199 | Venv panel |

**Total: ~3500 lines across 23 files**
