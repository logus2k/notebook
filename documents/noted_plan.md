# noted - Integrated MLOps Platform Plan

## Document Information

| Field         | Value                              |
|---------------|------------------------------------|
| Document      | Development Plan                   |
| Project       | noted - Integrated MLOps Platform  |
| Version       | 1.2                                |
| Date          | 2026-03-10                         |
| Status        | Draft                              |
| Related       | Vision Document v1.2, Scope Document v1.2 |
| Changes       | v1.2: Phase 0 completed. Phase 1 split into 1A (UI layout refactor + MLflow integration) and 1B (DVC data versioning + advanced features). New UI layout infrastructure tasks added: icon bar, Workspace Explorer, tabbed center pane. Python file editing support added. Service UIs moved from floating panels to center tabs. Container names updated to actual consolidated stack. Multi-notebook support deferred. Decisions resolved: git subprocess (not pygit2), volume mount for worker data access, session auth backend (JWT for programmatic API access). |

---

## 1. Purpose

This document defines the phased delivery plan for the noted MLOps platform. It sequences the work based on technical dependencies, incremental value delivery, and risk management. Each phase produces a working, demonstrable increment of the platform.

---

## 2. Phasing Strategy

### 2.1 Dependency Graph

The tools and features have hard technical dependencies that constrain sequencing:

```
MinIO (running)
    |
    +----> DVC (needs remote storage)
    |
    +----> MLflow Tracking (needs artifact store) (running)
               |
               +----> MLflow Registry (needs tracking data)
               |           |
               |           +----> Model Serving (needs registry)
               |
               +----> Hydra (config logged as MLflow artifact)
                          |
                          +----> Airflow (executes with Hydra configs) (running)
```

### 2.2 Value Delivery Principle

Each phase must be independently useful. A user should benefit from Phase 1 even if Phase 4 is never built. This means:

- Phase 1A delivers UI layout infrastructure and basic MLflow experiment tracking
- Phase 1B adds data versioning, auto-instrumentation, and advanced tracking features
- Phase 2 adds configuration management and orchestration (production workflows)
- Phase 3 adds model governance and serving (deployment lifecycle)
- Phase 4 adds cross-cutting integration polish and the end-to-end experience

### 2.3 Phase Overview

| Phase | Name                              | Primary Tools                   | Key Deliverable                                          |
|-------|-----------------------------------|---------------------------------|----------------------------------------------------------|
| 0     | Infrastructure Verification       | MinIO, PostgreSQL, Docker       | All services verified connectable and interoperable      |
| 1A    | UI Layout and MLflow Integration  | MLflow Tracking, CodeMirror     | New layout (icon bar, sidebar, tabs) + MLflow tracking   |
| 1B    | Data Versioning and Advanced Tracking | DVC, Git, MLflow              | Versioned data, auto-tracking, live metrics, comparison  |
| 2     | Configuration and Orchestration   | Hydra, Airflow                  | Config-driven pipeline execution from noted UI           |
| 3     | Registry and Serving              | MLflow Registry, FastAPI serving| Model promotion and live prediction from noted UI        |
| 4     | Integration and Polish            | All                             | Full lineage, collaboration events, end-to-end workflow  |

---

## 3. Phase 0: Infrastructure Verification

**Goal:** Verify that all already-running backend services can communicate with the noted container and with each other as required.

**Rationale:** All core infrastructure is already deployed (MLflow, Airflow 3.0, MinIO, PostgreSQL, Redis). This phase confirms interoperability and creates the bucket/database structures needed by subsequent phases. No new services are deployed.

### 3.1 Tasks

**T-0.1: Docker Network Connectivity**
Verify that the noted container can reach all backend services on the Docker internal network:
- MLflow server (`mlflow:5000`)
- Airflow API Server (`airflow-apiserver:8080`)
- MinIO (`minio:9000`)
- PostgreSQL (`postgres:5432`)

Acceptance: HTTP health checks pass from within the noted container for each service.

**T-0.2: PostgreSQL Database Setup**
Create a dedicated `noted` database within the existing PostgreSQL instance (`postgres`) for noted application metadata. Confirm MLflow's database also exists and is accessible.

Acceptance: noted backend can connect to the `noted` database. MLflow backend store is confirmed operational.

**T-0.3: MinIO Bucket Structure**
Create the base bucket structure in the existing MinIO instance (`minio`):
- `noted-mlflow-artifacts` (MLflow artifact store)
- `noted-dvc` (DVC remote storage)

Acceptance: MLflow can write and read artifacts via S3 protocol to the new bucket. DVC can push and pull to the new bucket.

**T-0.4: MLflow Integration Verification**
Verify MLflow server from the noted container:
- Create an experiment via the MLflow API
- Start a run, log a metric, log a file artifact to MinIO
- Retrieve all via the MLflow API

Acceptance: Full round-trip (create experiment -> log data -> retrieve) succeeds from inside the noted container.

**T-0.5: Airflow API Verification**
Verify Airflow 3.0 API Server from the noted container:
- List existing DAGs via the REST API
- Place a test DAG file in the Airflow DAGs directory
- Trigger it via the API Server
- Confirm execution completes on the Celery worker

Acceptance: Test DAG triggered from noted container executes successfully on the Airflow worker.

**T-0.6: DVC + Git Verification**
Verify DVC with backend-managed Git within the noted container:
- `git` subprocess can initialize a bare repo
- `dvc init` succeeds within a test project directory
- `dvc add` on a test file creates a `.dvc` pointer file
- `dvc push` sends the file to MinIO (`noted-dvc` bucket)
- `dvc pull` in a clean directory retrieves the file from MinIO

Acceptance: Round-trip test (add -> push -> delete local -> pull -> verify content) passes.

**T-0.7: Airflow Worker Access to Project Data**
Resolve how the Airflow worker (`noted-airflow-worker`) accesses project files:
- Option A: Shared volume mount (same `/data/projects` volume mounted read-only on worker)
- Option B: Worker runs `dvc pull` at task start (requires DVC + MinIO access from worker)

Decision required before Phase 2 but the volume mount should be tested here.

Acceptance: Airflow worker can read a file from a noted project directory.

### 3.2 Decision Points

| Decision                                 | Options                          | Deadline       |
|------------------------------------------|----------------------------------|----------------|
| pygit2 vs git subprocess                 | pygit2 preferred, subprocess fallback | Before T-0.6 |
| Worker data access (volume vs DVC pull)  | Volume mount preferred           | Before T-0.7   |

### 3.3 Exit Criteria

All services are verified reachable from the noted container. Bucket structure exists. Test round-trips pass for MLflow, Airflow, and DVC. No user-facing changes.

### 3.4 Phase 0 Results

Phase 0 completed on 2026-03-10. All tasks passed:

| Task | Result | Notes |
|------|--------|-------|
| T-0.1: Docker network connectivity | PASS | All 4 services reachable from noted container |
| T-0.2: PostgreSQL `noted` database | PASS | Database created and accessible |
| T-0.3: MinIO bucket structure | PASS | `noted-mlflow-artifacts` and `noted-dvc` created |
| T-0.4: MLflow round-trip | PASS | Experiment, run, metric, param — full cycle |
| T-0.5: Airflow API | PASS | JWT auth, DAG deploy, trigger, execution on Celery worker |
| T-0.6: DVC + Git | PASS | git subprocess + dvc[s3], round-trip to MinIO |
| T-0.7: Worker data access | PASS | Shared volume mount at /opt/noted/projects:ro |

**Decisions resolved:**
- pygit2 vs git subprocess → **git subprocess** (installed in container, works reliably)
- Worker data access → **shared volume mount** (read-only, tested successfully)
- Airflow API auth → **JWT tokens** via `/auth/token` endpoint (Airflow 3.x), session backend for web UI
- Execution API URL → requires `/airflow` prefix to match `AIRFLOW__API__BASE_URL`

---

## 4. Phase 1A: UI Layout and MLflow Integration

**Goal:** Rebuild the UI layout to support the full MLOps lifecycle, migrate existing features into the new layout, and deliver MLflow experiment tracking as the first integration.

**Rationale:** The current UI (floating modal Explorer, single notebook view, toolbar-triggered service iframes) cannot support the density of features planned for Phases 1-4. Building the layout infrastructure first ensures all subsequent features have a consistent home. MLflow tracking is included because it delivers immediate user value and validates the new layout with real content.

### 4.1 Tasks

**T-1A.1: Icon Bar and Sidebar Shell**
Build the left icon bar and collapsible Workspace Explorer sidebar:
- Icon bar: narrow vertical strip, always visible, one icon per category
- Sidebar: slides in/out on icon click, resizable width via drag handle
- Initial categories: Projects, Environments (migrated from existing Explorer)
- State persistence: sidebar width, collapsed/expanded, active section (localStorage)
- CSS: new sidebar.css module

**T-1A.2: Tabbed Center Pane**
Replace the current fixed notebook container with a tabbed content area:
- Tab bar with close buttons, active tab indicator
- Tab types: notebook (existing editor), iframe (service UIs), placeholder for future types
- Tab lifecycle: create, focus, close, persist across page reload (localStorage)
- The existing notebook editor becomes the content of a notebook tab
- Notebook tab opens automatically when a notebook is selected in the Workspace tree
- TabManager class (frontend/js/TabManager.js) manages all tab operations

**T-1A.3: Workspace Explorer Migration**
Migrate the existing ExplorerPanel (floating jsPanel modal) into the new sidebar:
- Move Projects tree (Wunderbaum) into the sidebar under Projects section
- Move Environments management into the sidebar under Environments section
- Keep the existing tree data and detail pane behavior (split view within sidebar)
- Remove the floating Explorer jsPanel
- Toolbar "Browse" button now toggles the sidebar instead

**T-1A.4: Service UI Tabs**
Move MLflow, Airflow, and MinIO from toolbar-triggered floating panels to center pane tabs:
- Each opens as an iframe tab when clicked in toolbar or Workspace tree
- Singleton behavior: clicking again focuses existing tab
- Tab title shows service name with optional status indicator

**T-1A.5: Python File Tabs**
Support opening Python files from the Workspace tree as editor tabs:
- CodeMirror 6 editor instance per tab (Python mode, same themes as notebook)
- File content loaded via REST API, saved on Ctrl+S
- No execution UI — files share the notebook's kernel via import
- Backend endpoint: GET/PUT /api/projects/{id}/files/{path}

**T-1A.6: MLflow Integration in Kernel Startup**
(Previously T-1.5) Extend KernelManagerService to inject MLflow environment variables:
- `MLFLOW_TRACKING_URI` pointing to `mlflow:5000`
- `MLFLOW_EXPERIMENT_NAME` set from project metadata
- Existing `LD_LIBRARY_PATH` injection for CUDA preserved
- Ensure `mlflow` is installable via EnvironmentManager

**T-1A.7: Explicit MLflow Verification**
(Previously T-1.6) Verify standard MLflow code works in notebook cells.

**T-1A.8: Experiments API**
(Previously T-1.9) Implement REST endpoints proxying to MLflow:
- GET /api/projects/{id}/experiments/runs
- GET /api/projects/{id}/experiments/runs/{run_id}
- GET /api/projects/{id}/experiments/runs/{run_id}/artifacts

**T-1A.9: Experiments Section in Workspace Tree**
Add an Experiments category to the Workspace tree:
- Shows runs for the current project with status icons
- Click a run to open a detail tab in the center pane
- Basic run info: status, start time, key metrics
- Updates via polling initially (live streaming in Phase 1B)

### 4.2 Exit Criteria

- The new 4-column layout (icon bar, sidebar, tabs, chat) is functional
- Existing Projects and Environments work in the new sidebar
- Notebook opens as a tab, Python files open as editor tabs
- MLflow/Airflow/MinIO open as iframe tabs
- A user can run MLflow code in a notebook and see the run in the Workspace tree
- No regressions in existing notebook functionality

---

## 5. Phase 1B: Data Versioning and Advanced Tracking

**Goal:** Add DVC data versioning, auto-instrumentation, live metrics streaming, and comparison views.

**Rationale:** With the layout infrastructure in place and basic MLflow tracking working, Phase 1B adds the deeper integrations that make noted's experiment tracking superior to using MLflow UI directly.

### 5.1 Tasks

**T-1B.1: ProjectVersionControl Service** (previously T-1.1)
Implement the `ProjectVersionControl` abstraction layer as a new backend manager:
- Interface defining: init, add_file, commit, tag, checkout, get_versions, get_current_hash
- Implementation using git subprocess + DVC CLI
- Project-level locking for Git operations (extending the existing CollaborationManager's lock pattern)
- Integrated into the existing NotebookManager's project creation flow: new project = new Git repo + DVC init + MinIO remote config

Scope reference: F-DVC-01, F-DVC-02, F-DVC-09

**T-1B.2: Data Upload and Tracking Endpoint** (previously T-1.2)
Implement `POST /api/projects/{id}/data/upload`:
- Accepts multipart file upload
- Writes to `data/raw/` in the project directory
- Calls ProjectVersionControl to add, push, commit, and tag
- Returns version info (version number, hash, size)

Scope reference: F-DVC-03

**T-1B.3: Data Listing and Version History Endpoints** (previously T-1.3)
Implement:
- `GET /api/projects/{id}/data` - list all tracked files with current version
- `GET /api/projects/{id}/data/{path}/versions` - version history for a file
- `GET /api/projects/{id}/data/{path}/download` - pre-signed URL from MinIO

Scope reference: F-DVC-04, F-MINIO-04

**T-1B.4: Data Version Switching Endpoint** (previously T-1.4)
Implement `POST /api/projects/{id}/data/checkout`:
- Accepts a version tag or hash
- Calls ProjectVersionControl to checkout + DVC checkout
- Notifies connected clients via Socket.io (`data:version_created`)

Scope reference: F-DVC-05

**T-1B.5: Auto-Instrumentation Engine** (previously T-1.7)
Implement the automatic MLflow tracking mode by extending the existing ExecutionBridge:
- Project setting: `auto_tracking: bool` in project.json
- Pre-execution hook (in ExecutionBridge): check kernel namespace for active MLflow run; if none and auto_tracking is enabled, inject `mlflow.start_run()`
- Post-execution hook: inspect kernel namespace for known framework objects; activate corresponding autolog
- Detection targets: `torch.nn.Module`, `sklearn.base.BaseEstimator`, `tensorflow.keras.Model`, `xgboost.Booster`, `lightgbm.Booster`
- Tag auto-runs with `instrumentation: auto`
- Back-off logic: if `mlflow.start_run` is detected in cell source code, skip injection

Scope reference: F-MLF-05

**T-1B.6: Live Metrics Streaming** (previously T-1.8)
Implement real-time metric forwarding:
- Backend polls MLflow API for active runs in the project's experiment (configurable interval, default 1s)
- When new metric steps are detected, emit `metric:update` via Socket.io (through CollaborationManager's room broadcasting)
- Include run_id, metric_name, step, value, and timestamp in the event payload
- Polling starts when a kernel executes a cell and stops when no active runs remain

Alternative approach (evaluate during implementation): intercept `mlflow.log_metric()` calls at the kernel level via a custom MLflow plugin or monkey-patch, which would eliminate polling latency.

Scope reference: F-MLF-06

**T-1B.7: DVC Hash Injection into MLflow Runs** (previously T-1.10)
When an MLflow run starts (explicit or auto), the backend injects the current DVC data hash as a run tag:
- Tag key: `dvc.data_hash`
- Value: computed from `.dvc` file hashes in the project
- For auto mode: runs as part of the ExecutionBridge pre-execution hook
- For explicit mode: injected as a kernel-level environment variable (`MLFLOW_RUN_TAGS`)

Scope reference: F-DVC-07

**T-1B.8: Storage Section in Workspace Tree**
MinIO bucket browser as a tree category in the Workspace Explorer:
- Shows buckets and objects in a navigable tree
- Click an object to view metadata or download

**T-1B.9: Data Section in Workspace Tree**
DVC-tracked files per project as a tree category:
- Shows tracked files with version badges
- Version history expandable per file
- Upload action (drag-and-drop or file picker) that calls the upload endpoint
- Version selector that triggers checkout

**T-1B.10: Run Comparison View** (previously T-1.13)
Opens as a center tab:
- Checkbox selection on runs (2-5 runs)
- Overlaid metric charts (shared axes, one color per run)
- Parameter diff table (highlight cells that differ)
- Data version column showing DVC hash per run

**T-1B.11: Artifact Browser** (previously T-1.14)
Within run detail tab:
- Tree view of artifacts
- Image artifacts render inline (plots, charts)
- Text artifacts render in a code viewer
- All other artifacts show download link (pre-signed URL)

### 5.2 Exit Criteria

- A user can upload a dataset, see it versioned in the Workspace tree, switch between versions
- Auto-tracking works: metrics logged without explicit MLflow code
- Live metrics update in the Experiments detail tab within 2 seconds
- Run comparison opens as a center tab with overlaid charts and param diffs
- Every run has a dvc.data_hash tag
- MinIO buckets are browsable in the Workspace tree

---

## 6. Phase 2: Configuration and Orchestration

**Goal:** Users can manage Hydra configurations through the UI and submit pipeline runs to Airflow.

**Rationale:** Once users can track experiments (Phase 1), the natural next step is parameterizing them (Hydra) and running them at scale (Airflow). This phase transitions noted from an interactive tool to a production pipeline manager.

### 6.1 Backend Tasks

**T-2.1: Hydra Config Schema Endpoint**
Implement `GET /api/projects/{id}/config/schema`:
- Reads the project's `config/` directory structure
- Parses `config.yaml` defaults list to identify config groups
- For each config group directory, lists available options (YAML files)
- If Structured Configs (dataclasses) exist in `src/`, extracts field types and constraints
- Returns a JSON schema suitable for dynamic form generation

**T-2.2: Hydra Config Composition Endpoint**
Implement `POST /api/projects/{id}/config/compose`:
- Accepts a set of Hydra overrides (e.g., `{"model": "transformer", "model.n_heads": 8}`)
- Uses `hydra.compose()` to assemble the complete configuration
- Validates against Structured Configs if available
- Returns the composed config as YAML and a deterministic hash
- Returns validation errors if type constraints are violated

**T-2.3: Config Templates**
Implement:
- `GET /api/projects/{id}/config/templates` - list saved templates
- `POST /api/projects/{id}/config/templates` - save current config as named template
- Templates stored in `config/templates/{name}.yaml` within the project directory
- Templates committed to the backend Git repo via ProjectVersionControl

Scope reference: F-HYD-06

**T-2.4: Config Hash Injection into MLflow**
When a run starts with a Hydra config:
- Compute the config hash from the composed YAML
- Inject as MLflow run tag: `hydra.config_hash`
- Log the composed YAML as an MLflow artifact: `hydra_config.yaml`

Scope reference: F-HYD-05

**T-2.5: Airflow DAG Generator**
Implement a DAGGenerator backend module:
- Input: project metadata (ID, entry point path, environment info)
- Output: a valid Airflow DAG Python file written to `pipelines/dag_{project_id}.py`
- DAG structure:
  1. `pull_data` task: runs `dvc pull` in the project directory
  2. `validate_config` task: runs `hydra.compose()` with provided overrides and validates
  3. `train` task: executes `python src/train.py` with Hydra CLI overrides
  4. Tasks are connected: pull_data >> validate_config >> train
- The DAG file is parameterized: reads overrides from `dag_run.conf`
- Generated DAGs are synced to the Airflow DAGs directory (accessible by `noted-airflow-dag-processor`)

Scope reference: F-AIR-02

**T-2.6: Pipeline Trigger Endpoint**
Implement `POST /api/projects/{id}/pipelines/trigger`:
- Accepts: Hydra config overrides, optional data version tag
- Validates config via the composition endpoint
- Ensures the DAG file exists (generates if needed)
- Calls Airflow API Server (`airflow-apiserver`): trigger DAG run with `conf` containing overrides
- Returns the Airflow DAG run ID
- Emits `pipeline:task_status` via Socket.io with initial "queued" state

Scope reference: F-AIR-03

**T-2.7: Pipeline Status Polling and Streaming**
Implement a PipelineMonitor backend module:
- Polls Airflow API Server for active pipeline run task instances
- Detects state transitions and emits `pipeline:task_status` events via Socket.io (through CollaborationManager rooms)
- For running tasks, fetches logs via Airflow API and emits `pipeline:task_log` events
- Polling interval: 2 seconds for active runs, stops when run completes

Scope reference: F-AIR-04, F-AIR-05

**T-2.8: Pipeline History Endpoint**
Implement `GET /api/projects/{id}/pipelines/runs`:
- Lists all DAG runs for the project from Airflow API Server
- Enriches with: trigger time, duration, final status, config overrides used
- Includes correlation to MLflow runs (matched by config hash and timestamp)

Scope reference: F-AIR-07

**T-2.9: Sweep DAG Generation**
Extend the DAGGenerator for Hydra multirun sweeps:
- When sweep parameters are specified, generate a DAG with Airflow dynamic task mapping
- Each parameter combination becomes a mapped task instance of the `train` task
- The `pull_data` and `validate_config` tasks run once; `train` fans out
- Parallelism controlled by Airflow worker concurrency settings

Scope reference: F-AIR-06, F-HYD-07

**T-2.10: Pipeline Scheduling Endpoints**
Implement:
- `POST /api/projects/{id}/pipelines/schedule` - create or update schedule (cron or interval)
- `DELETE /api/projects/{id}/pipelines/schedule` - remove schedule
- These modify the DAG file's `schedule` parameter and update Airflow via API Server

Scope reference: F-AIR-08

### 6.2 Frontend Tasks

**T-2.11: Config Section in Workspace Tree**
Implement the Config section as a Workspace tree category with detail tabs in the center pane:
- Config tree shows config groups and available options from the schema endpoint
- Click a config group to open a detail tab with a dynamic form
- Type-appropriate input controls (number, text, select, boolean toggle)
- Validation feedback inline (red borders, error messages)
- "Compose" button that calls the composition endpoint and shows the full YAML preview
- Config hash displayed for reference
- Template selector dropdown and "Save as Template" button

**T-2.12: YAML Preview Panel**
Within the Config detail tab, a collapsible section showing:
- The composed YAML (read-only, syntax-highlighted)
- Diff view when comparing against a previous config or template

**T-2.13: Sweep Configuration UI**
Extension to the Config detail tab:
- "Sweep" toggle that switches a field from single-value to multi-value input
- Multi-value inputs accept comma-separated values or range syntax (start:stop:step)
- Combination count displayed (e.g., "24 configurations")
- "Submit Sweep" button that triggers pipeline with sweep parameters

**T-2.14: Pipeline Tab**
Implement a Pipeline view as a center pane tab that opens when a pipeline is triggered or selected from the Workspace tree:
- DAG node graph visualization showing task names and dependencies
- Color-coded task nodes: grey (queued), blue (running), green (success), red (failed), yellow (skipped)
- Real-time updates from `pipeline:task_status` Socket.io events
- Click a task node to expand and see its streaming logs
- Log output area that receives `pipeline:task_log` events

**T-2.15: Pipeline History View**
Within the Pipeline tab:
- List of past pipeline runs with status, duration, config summary
- Click a run to replay its node graph state
- Link to corresponding MLflow runs (opens in Experiments detail tab)

**T-2.16: Pipeline Status in Bottom Bar**
Add to the bottom status bar:
- Active pipeline indicator (running/idle)
- Last pipeline status (success/failed with timestamp)
- Click to jump to Pipeline tab

### 6.3 Exit Criteria

- A user can open the Config detail tab, select a model architecture, adjust hyperparameters, and see the composed YAML
- Config validation catches type errors before execution
- A user can click "Submit Pipeline" and see a live node graph of the Airflow execution in noted
- Task logs stream into the UI in real-time
- A sweep of 10 configurations runs with correct parallelism
- The pipeline run creates MLflow runs with correct config hash tags
- Pipeline history shows past runs with links to their experiment results

---

## 7. Phase 3: Registry and Serving

**Goal:** Users can promote models and test predictions from within noted.

**Rationale:** After experiments are tracked (Phase 1) and parameterized/orchestrated (Phase 2), the final lifecycle step is governance and deployment. This phase completes the data-to-deployment flow.

### 7.1 Backend Tasks

**T-3.1: Model Registration Endpoint**
Implement `POST /api/projects/{id}/models/register`:
- Accepts: run_id, artifact_path (within the run), model_name
- Calls MLflow Registry API to create a registered model (if new) and a new model version
- Tags the version with: source run_id, dvc.data_hash, hydra.config_hash
- Returns version info

**T-3.2: Model Listing and Version Endpoints**
Implement:
- `GET /api/projects/{id}/models` - list registered models for the project
- `GET /api/projects/{id}/models/{name}/versions` - list versions with aliases, metrics, creation date

**T-3.3: Alias Management Endpoint**
Implement `PUT /api/projects/{id}/models/{name}/versions/{v}/alias`:
- Accepts: alias name (e.g., "champion", "staging")
- Calls MLflow Registry API to set the alias
- Emits `model:alias_changed` via Socket.io (through CollaborationManager rooms)
- If alias is "@champion", notifies the serving container

**T-3.4: Model Lineage Endpoint**
Implement `GET /api/projects/{id}/models/{name}/versions/{v}/lineage`:
- Retrieves the version's source run from MLflow
- From the run, extracts: dvc.data_hash, hydra.config_hash, pipeline run ID (if applicable)
- Resolves each hash to its readable form
- Returns the complete lineage chain as a structured response

**T-3.5: Model Comparison Endpoint**
Implement `POST /api/projects/{id}/models/compare`:
- Accepts two version references
- Returns metric diff, config diff, data version diff, architecture diff
- Reuses the run comparison logic from Phase 1

**T-3.6: Model Serving Container**
Build the model-server Docker service (the only new container in the entire plan):
- FastAPI application with Uvicorn
- On startup: loads model from MLflow Registry (`mlflow`) using `@champion` alias
- `/predict` endpoint: accepts JSON, validates against model signature (Pydantic), runs inference, returns JSON
- `/health` endpoint: returns loaded model info, version, load time
- `/schema` endpoint: returns the Pydantic input/output schema as JSON Schema

**T-3.7: Hot Model Reload**
Implement model reloading in the serving container:
- Background async task checks MLflow Registry for alias changes (poll interval: 10 seconds)
- When a new version is detected for the `@champion` alias: load new model, atomic swap, release old model
- During reload, old model continues serving requests
- Emit `serving:model_loaded` via Socket.io (through noted backend)

**T-3.8: Serving Proxy Endpoints**
Implement in noted backend (ServingProxy module):
- `POST /api/projects/{id}/serving/predict` - proxies to the project's model-server `/predict`
- `GET /api/projects/{id}/serving/status` - proxies to `/health`
- `GET /api/projects/{id}/serving/schema` - proxies to `/schema`

**T-3.9: On-Demand Serving Container Management**
Implement lifecycle management for serving containers:
- Containers start when a model is first promoted to `@champion` in a project
- Containers stop after a configurable inactivity timeout (default: 30 minutes)
- noted backend tracks serving container state per project
- Docker API used to start/stop containers programmatically

### 7.2 Frontend Tasks

**T-3.10: Models Section in Workspace Tree**
Implement a Models category in the Workspace tree with detail tabs in the center pane:
- Tree shows registered models with version count as child nodes
- Click a model version to open a detail tab: version number, alias badge, creation date, key metric
- Alias management: dropdown or drag-and-drop to assign @champion, @staging, @archived
- "Register Model" action accessible from run detail view (cross-panel interaction)
- Real-time updates from `model:registered` and `model:alias_changed` events

**T-3.11: Model Lineage View**
Within model version detail tab:
- Visual lineage chain: Data (version + hash) -> Config (YAML preview) -> Run (metrics summary) -> Model (version + alias)
- Each node in the chain is clickable, navigating to the corresponding detail tab
- If trained via pipeline, includes the pipeline run link

**T-3.12: Model Comparison View**
Select two versions via checkbox, side-by-side comparison of metrics, config, data version, architecture.

**T-3.13: Try It Tab**
Implement the Serving / Try It view as a center pane tab that opens from the Models section in the Workspace tree:
- Shows serving status: loaded model name, version, health
- Dynamic input form generated from the `/schema` endpoint
- "Predict" button sends request via the serving proxy
- Response displayed as formatted JSON
- Request/response history (in-memory, session-scoped)
- Inactive state when no champion model is set or serving container is stopped

**T-3.14: Serving Status in Bottom Bar**
Add to the bottom status bar:
- Serving indicator: active (green) / inactive (grey) / loading (yellow)
- Current champion model name and version

### 7.3 Exit Criteria

- A user can register a model from a completed run
- A user can assign @champion alias and see the serving container load the model
- A user can send a prediction request from the Try It tab and see the result
- Model lineage displays the complete chain from data version through config to model
- Hot reload works: promoting a new champion updates the serving container without downtime
- All alias changes propagate to connected clients in real-time

---

## 8. Phase 4: Integration and Polish

**Goal:** Close the integration gaps, add collaboration features, and deliver the end-to-end experience described in the Vision document.

**Rationale:** Phases 1-3 deliver the individual capabilities. Phase 4 connects them into a seamless workflow and adds the collaborative layer that makes noted a team tool.

### 8.1 Backend Tasks

**T-4.1: Activity Feed Service**
Implement an ActivityFeed backend module:
- All significant actions (data upload, run start/end, model registration, alias change, pipeline trigger) are recorded
- Storage: append-only table in the `noted` database (PostgreSQL)
- `GET /api/projects/{id}/activity` endpoint returns recent events
- `activity:event` Socket.io events emitted for real-time feed (via CollaborationManager rooms)

**T-4.2: Cross-Service Event Correlation**
Implement logic to link events across services:
- When an Airflow pipeline run completes, find the MLflow runs created during that pipeline run (match by time window and project)
- Attach pipeline_run_id as a tag on those MLflow runs
- When viewing a pipeline run, show links to its MLflow runs
- When viewing an MLflow run, show whether it was pipeline-triggered

**T-4.3: Processed Data Auto-Tracking**
Implement detection of output files from cell execution:
- After cell execution (extending ExecutionBridge), compare `data/processed/` directory state before and after
- If new or modified files detected, prompt the user (via Socket.io) to version them
- If user accepts, run the DVC add/push/commit cycle via ProjectVersionControl
- Track the derivation relationship: processed file version derived from current raw data version

**T-4.4: GenAI Trace Viewer Backend**
Implement trace retrieval for LLM projects:
- `GET /api/projects/{id}/experiments/runs/{run_id}/traces` - retrieves MLflow 3.x traces
- Returns structured trace data: steps, latencies, token counts, retrieval context

**T-4.5: Storage Usage Endpoint**
Implement `GET /api/projects/{id}/storage`:
- Queries MinIO Admin API for bucket/prefix size
- Returns: total bytes, object count, breakdown by category (data, artifacts, models)

**T-4.6: End-to-End Integration Tests**
Implement automated tests that verify the full workflow:
- Create project -> upload data -> configure model -> run training (explicit + auto) -> compare runs -> trigger pipeline -> register model -> promote to champion -> predict
- Scripted test, not user-facing, but critical for validating the integration

### 8.2 Frontend Tasks

**T-4.7: Activity Feed Panel (Right Sidebar)**
Implement the Activity panel (vanilla ES6 module):
- Chronological list of recent events with user name, action description, timestamp
- Click an event to navigate to the relevant detail tab
- Real-time updates from `activity:event` events
- Filter by event type (data, experiment, pipeline, model)

**T-4.8: Cross-Panel Navigation**
Implement contextual links between detail tabs:
- From a run: link to its data version (opens Data section at that version)
- From a run: link to its config (opens Config detail tab with those values)
- From a model version: link to its source run (opens run detail tab)
- From a pipeline run: link to its MLflow runs (opens Experiments, filtered)
- From an activity event: link to the relevant entity

**T-4.9: GenAI Trace Visualization**
Within run detail tab (for LLM project runs):
- Waterfall chart showing trace steps with latency
- Expandable steps showing input/output per step
- Token count and cost summary

**T-4.10: Storage Usage Display**
In the bottom status bar and project settings:
- Total storage used
- Breakdown visualization (data vs artifacts vs models)

**T-4.11: Onboarding and Empty States**
For each Workspace tree section and detail tab, implement meaningful empty states:
- Data section empty: "Upload your first dataset to get started"
- Experiments section empty: "Run a cell with MLflow tracking to see results here"
- Config section empty: "Add YAML files to config/ to define your experiment parameters"
- Pipeline tab empty: "Create a train.py entry point in src/ to enable pipeline execution"
- Models section empty: "Register a model from a completed run to manage versions"
- Serving tab empty: "Promote a model to @champion to enable predictions"

Each empty state guides the user to the next action, implementing the progressive complexity principle.

**T-4.12: UI Performance Optimization**
- Implement virtual scrolling for long run lists (100+ runs)
- Optimize Socket.io event handling to batch UI updates (debounce metric updates at 500ms)
- Implement client-side caching with TTL for panel data
- Lazy-load chart libraries only when comparison view is opened

### 8.3 Exit Criteria

- The full scenario from Vision document Section 6.1 is executable end-to-end without leaving noted
- All cross-panel links work correctly
- Activity feed shows a coherent timeline of all actions
- Two concurrent users experience real-time collaboration across all panels
- Empty states guide new users through the platform's capabilities
- No panel load exceeds 3 seconds under normal conditions

---

## 9. Task Dependency Map

```
Phase 0 (all tasks can run in parallel - verification only) [COMPLETED]
    |
    v
Phase 1A:
    T-1A.1 (Icon Bar + Sidebar Shell)
        |
        +-> T-1A.3 (Workspace Explorer Migration)
        +-> T-1A.9 (Experiments Section in tree)

    T-1A.2 (Tabbed Center Pane)
        |
        +-> T-1A.4 (Service UI Tabs)
        +-> T-1A.5 (Python File Tabs)

    T-1A.1 + T-1A.2 (layout infrastructure)
        |
        +-> All subsequent frontend tasks depend on layout

    T-1A.6 (Kernel MLflow injection - extends KernelManagerService)
        |
        +-> T-1A.7 (Explicit verification)

    T-1A.8 (Experiments API - queries MLflow directly)
        |
        +-> T-1A.9 (Experiments Section in tree)

Phase 1B:
    T-1B.1 (ProjectVersionControl)
        |
        +-> T-1B.2, T-1B.3, T-1B.4 (Data endpoints)
        |       |
        |       +-> T-1B.9 (Data Section in tree)
        |
        +-> T-1B.7 (DVC hash injection)

    T-1B.5 (Auto-instrumentation - extends ExecutionBridge)

    T-1B.6 (Live Metrics Streaming)
        |
        +-> Updates Experiments detail tabs in real-time

    T-1B.8 (Storage Section in tree)

    T-1B.10 (Run Comparison View)
    T-1B.11 (Artifact Browser)

Phase 2:
    T-2.1, T-2.2, T-2.3 (Hydra endpoints)
        |
        +-> T-2.11, T-2.12 (Config UI)
        +-> T-2.4 (Config hash injection)
        +-> T-2.5 (DAGGenerator)
                |
                +-> T-2.6 (Pipeline trigger)
                +-> T-2.9 (Sweep DAG)
                        |
                        +-> T-2.13 (Sweep UI)

    T-2.7 (PipelineMonitor)
        |
        +-> T-2.14 (Pipeline tab)

    T-2.8 (Pipeline history)
        |
        +-> T-2.15 (History UI)

Phase 3:
    T-3.1 through T-3.5 (Registry endpoints)
        |
        +-> T-3.10, T-3.11, T-3.12 (Registry UI)

    T-3.6, T-3.7 (Serving container - only new container)
        |
        +-> T-3.8 (ServingProxy)
        +-> T-3.9 (Container lifecycle)
                |
                +-> T-3.13 (Try It tab)

Phase 4:
    All tasks depend on Phases 1A, 1B, 2, 3 being complete
    T-4.1 through T-4.6 can proceed in parallel
    T-4.7 through T-4.12 depend on their respective backend tasks
```

---

## 10. Risk Mitigation Plan

### 10.1 Technical Risks and Responses

**Risk: MLflow auto-instrumentation conflicts with user code**
- Mitigation: Conservative detection logic in ExecutionBridge, explicit back-off, `instrumentation: auto` tag
- Fallback: Disable auto-mode for the affected project; user uses explicit mode

**Risk: Docker Compose resource exhaustion (many containers already running)**
- Mitigation: Set resource limits on all containers. Model-server is on-demand only.
- Monitoring: Add basic resource monitoring (container stats)
- Fallback: Reduce worker count, increase swap, or migrate GPU training to a separate host

**Risk: Socket.io event ordering across multiple backend services**
- Mitigation: Include monotonic sequence numbers in events; client reconciles ordering
- Fallback: Accept slight out-of-order events in non-critical displays (activity feed)

**Risk: Kernel session model (one per client) vs project-scoped MLflow context**
- Mitigation: MLflow experiment is project-scoped (env vars injected at kernel start). Multiple kernels in the same project share the same experiment but create separate runs. This is correct MLflow behavior.

### 10.2 Scope Risks

**Risk: Feature creep in individual phases**
- Mitigation: Each phase has explicit exit criteria. A phase is complete when exit criteria are met, not when all "nice to have" features are done

**Risk: Hydra config UI complexity explosion**
- Mitigation: Limit initial support to 3 levels of nesting and standard types (int, float, str, bool, list)
- Deferral: Complex types (custom objects, recursive configs) are out of scope

---

## 11. Verification Approach

### 11.1 Per-Phase Verification

| Phase | Verification Activity                                              |
|-------|--------------------------------------------------------------------|
| 0     | Service connectivity checks, API round-trip tests, DVC round-trip  |
| 1A    | Layout functional test: sidebar, tabs, MLflow tracking end-to-end  |
| 1B    | Manual end-to-end test: upload data, run training, compare runs    |
| 2     | Manual end-to-end test: configure, trigger pipeline, see results   |
| 3     | Manual end-to-end test: register model, promote, predict           |
| 4     | Full scenario test (Vision Section 6.1), concurrent user test      |

### 11.2 Integration Test Suite (Phase 4)

A scripted test that automates the Vision scenario:
1. Create project via API
2. Upload dataset via data endpoint
3. Verify DVC tracking and version
4. Start kernel, execute training cell with auto-tracking
5. Verify MLflow run with correct tags (data hash, config hash)
6. Compose Hydra config, trigger Airflow pipeline
7. Verify pipeline completes and creates MLflow runs
8. Register model from best run
9. Promote to @champion
10. Send prediction request, verify response
11. Verify all Socket.io events were emitted correctly
12. Verify activity feed contains all actions

---

## 12. Open Questions

| # | Question                                                    | Affects        | Status / Answer                         |
|---|-------------------------------------------------------------|----------------|-----------------------------------------|
| 1 | pygit2 or git subprocess?                                   | Phase 0, 1     | RESOLVED: git subprocess (installed in container, works reliably) |
| 2 | Worker data access: volume mount or DVC pull?               | Phase 0, 2     | RESOLVED: volume mount (/opt/noted/projects:ro) |
| 3 | MLflow metric streaming: polling or kernel-level intercept? | Phase 1B       | Start with polling; optimize if needed  |
| 4 | Serving container: one per project or shared pool?          | Phase 3        | One per project with inactivity timeout |
| 5 | GPU inference in serving container?                         | Phase 3        | CPU only initially; GPU as future work  |
| 6 | How to handle notebook-to-script extraction for pipelines?  | Phase 2        | Users maintain src/train.py manually    |
| 7 | Authentication model for multi-user access?                 | All phases     | To be designed separately (currently open access) |
| 8 | AI-assisted instrumentation mode scope?                     | Post-Phase 4   | Separate design document                |
| 9 | How to handle projects with no Hydra config?                | Phase 2        | Config section shows empty state; pipeline trigger requires at least a minimal config.yaml |
| 10| Docker network topology: single network or bridge?          | Phase 0        | RESOLVED: single default network via services/docker-compose.yml |
| 11| External projects: how does Git/DVC metadata coexist with host-linked notebooks? | Phase 1B | Git/DVC metadata in noted's data dir, notebooks may be symlinked from host |

---

## 13. What This Document Does Not Cover

- Detailed API request/response schemas (to be defined during implementation)
- UI wireframes and visual design (to be produced during development)
- CI/CD pipeline for noted itself (to be defined)
- AI-assisted instrumentation mode (separate document)
- Security and authentication design (separate document - currently open access)
- Cost estimation and resource procurement (separate discussion)
- Team assignment and individual workload (separate discussion)
