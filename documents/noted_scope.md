# noted - Integrated MLOps Platform Scope

## Document Information

| Field         | Value                              |
|---------------|------------------------------------|
| Document      | Product Scope                      |
| Project       | noted - Integrated MLOps Platform  |
| Version       | 1.1                                |
| Date          | 2026-03-08                         |
| Status        | Draft                              |
| Related       | Vision Document v1.1               |
| Changes       | v1.1: Corrected to reflect actual noted architecture (single container, vanilla ES6 frontend, multi-runtime kernels, existing managers and Socket.io events). Infrastructure section updated to match running services. |

---

## 1. Purpose

This document defines the boundaries of what noted will and will not deliver. It enumerates every feature, integration, and technical component required to realize the vision described in the Vision document. It serves as the authoritative reference for what is "in scope" and what is explicitly excluded or deferred.

---

## 2. Existing Foundation

noted is not being built from scratch. The following capabilities already exist and are the foundation upon which all new work is built.

### 2.1 Current Application State

| Capability                          | Status    | Technology                                      |
|-------------------------------------|-----------|--------------------------------------------------|
| Single-container deployment         | Built     | Docker, FastAPI + Uvicorn serving API + static files |
| Notebook editing (nbformat 4)       | Built     | Vanilla ES6, CodeMirror 6, 7 editor themes       |
| Real-time collaboration             | Built     | Socket.io, cell-level locking with TTL (60s)     |
| Multi-runtime kernel execution      | Built     | jupyter_client, Python 3.10-3.14 + free-threaded |
| GPU acceleration                    | Built     | CUDA runtime, LD_LIBRARY_PATH injection          |
| Environment management              | Built     | Per-runtime venvs, PTY-streaming package install |
| Project organization                | Built     | Hierarchical projects/notebooks, external linking |
| Cell operations                     | Built     | Add, delete, move, copy/cut/paste, multi-select  |
| Markdown cells                      | Built     | Marked, Highlight.js, KaTeX math rendering       |
| Terminal                            | Built     | xterm.js with 10+ color themes, per-environment  |
| UI panels                           | Built     | jsPanel, Wunderbaum tree, Split.js               |

### 2.2 Existing Backend Managers

| Manager                  | Responsibility                                          |
|--------------------------|---------------------------------------------------------|
| NotebookManager          | CRUD for projects and .ipynb files                      |
| KernelManagerService     | Jupyter kernel lifecycle, one per client session, idle timeout (600s) |
| ExecutionBridge          | Socket.io <-> Jupyter ZMQ message bridge                |
| CollaborationManager     | Rooms, cell locks, presence, user join/leave broadcast  |
| EnvironmentManager       | Runtime-aware venv creation, package install/uninstall  |
| ExternalProjectsConfig   | Singleton; parses projects.txt at startup               |

### 2.3 Existing Socket.io Events

The following events are already implemented and form the foundation for new MLOps events:

**Client to Server (existing):**

| Event              | Description                              |
|--------------------|------------------------------------------|
| `notebook:open`    | Join a notebook editing session           |
| `notebook:close`   | Leave a notebook session                  |
| `notebook:save`    | Save notebook to disk                     |
| `cell:lock`        | Acquire editing lock on a cell            |
| `cell:unlock`      | Release cell lock                         |
| `cell:update`      | Broadcast source change to other users    |
| `cell:add`         | Add a new cell                            |
| `cell:delete`      | Delete a cell                             |
| `cell:move`        | Move a cell                               |
| `cell:execute`     | Execute cell code on the kernel           |
| `kernel:start`     | Start a kernel with a specific environment|
| `kernel:stop`      | Stop the active kernel                    |
| `kernel:restart`   | Restart the kernel                        |
| `kernel:interrupt` | Interrupt running execution               |
| `heartbeat`        | Keep-alive (renews locks, prevents timeout)|

**Server to Client (existing):**

| Event                   | Description                              |
|-------------------------|------------------------------------------|
| `notebook:state`        | Full state on notebook open              |
| `notebook:saved`        | Save confirmation                        |
| `cell:updated`          | Another user edited a cell               |
| `cell:added`            | Another user added a cell                |
| `cell:deleted`          | Another user deleted a cell              |
| `cell:moved`            | Another user moved a cell                |
| `cell:output`           | Streaming execution output               |
| `cell:execute_complete` | Execution finished                       |
| `cell:lock_changed`     | Lock state broadcast                     |
| `kernel:status`         | Kernel state change                      |
| `user:joined`           | User joined the notebook                 |
| `user:left`             | User left the notebook                   |
| `error`                 | Error notification                       |

### 2.4 Existing REST API

noted already exposes REST endpoints for projects, notebooks, runtimes, and environments. New MLOps endpoints will follow the same patterns and naming conventions. See PROJECT_STATUS.md for the full existing API surface.

### 2.5 Existing Infrastructure (Running)

| Service                        | Status    | Container Name                  |
|--------------------------------|-----------|---------------------------------|
| noted                          | Running   | noted                           |
| MinIO                          | Running   | airflow-minio                   |
| MLflow 3.x                     | Running   | emi-mlflow                      |
| Airflow API Server (3.0)       | Running   | airflow-airflow-apiserver-1     |
| Airflow Scheduler              | Running   | airflow-airflow-scheduler-1     |
| Airflow Worker                 | Running   | airflow-airflow-worker-1        |
| Airflow Triggerer              | Running   | airflow-airflow-triggerer-1     |
| Airflow DAG Processor          | Running   | airflow-airflow-dag-processor-1 |
| PostgreSQL                     | Running   | airflow-postgres-1              |
| Redis (Airflow-managed)        | Running   | airflow-redis-1                 |
| nginx reverse proxy            | Running   | proxy_server                    |
| GPU (NVIDIA)                   | Available | Host-level, CUDA 13.1           |

---

## 3. Feature Scope by Domain

Each subsection defines a domain of functionality, the specific features within it, acceptance criteria, and the backend tools involved.

---

### 3.1 Object Storage Integration (MinIO)

**Purpose:** Provide persistent, versioned object storage accessible to all platform services.

#### 3.1.1 Features

**F-MINIO-01: Project Bucket Provisioning**
When a new noted project is created, the backend automatically creates a dedicated MinIO bucket (or prefix within a shared bucket) for that project. Bucket naming follows the pattern `noted-{project_id}`.

**F-MINIO-02: Artifact Store Configuration**
MLflow is configured to use MinIO as its artifact store. The backend sets `MLFLOW_ARTIFACT_ROOT` to `s3://noted-mlflow-artifacts/{project_id}/` with MinIO endpoint credentials.

**F-MINIO-03: DVC Remote Configuration**
Each project's DVC configuration points to MinIO as the remote storage backend. The remote URL follows `s3://noted-dvc/{project_id}/`.

**F-MINIO-04: Pre-signed URL Generation**
The backend generates time-limited pre-signed URLs for direct browser downloads of large artifacts (model files, datasets) without proxying the data through the noted API.

**F-MINIO-05: Storage Usage Display**
The UI shows per-project storage consumption (total bytes, object count) retrieved via the MinIO Admin API.

#### 3.1.2 Acceptance Criteria

- MLflow artifacts are retrievable from MinIO using standard S3 clients
- DVC push/pull operates against MinIO without manual credential configuration by the user
- Pre-signed URLs expire after a configurable TTL (default: 1 hour)
- Deleting a project archives (not deletes) its MinIO data with a configurable retention period

#### 3.1.3 Out of Scope

- MinIO cluster management (multi-node, erasure coding configuration)
- Bucket lifecycle policies beyond project-level retention
- Cross-region replication
- MinIO admin UI embedding

---

### 3.2 Data Versioning (DVC + Git)

**Purpose:** Track dataset versions with full lineage, enabling reproducible experiments without exposing Git complexity to users.

#### 3.2.1 Features

**F-DVC-01: Backend Git Repository Management**
Each project is backed by a bare Git repository initialized and managed by the noted backend. Users never interact with Git directly. The backend handles init, add, commit, tag, and branch operations programmatically via pygit2 or subprocess.

**F-DVC-02: DVC Initialization**
When a project is created, the backend runs `dvc init` within the project directory and configures the MinIO remote. DVC configuration files (`.dvc/config`) are committed to the backend Git repo.

**F-DVC-03: Dataset Upload and Tracking**
When a user uploads a file to `data/raw/` via the UI:
1. File is written to the project directory
2. Backend runs `dvc add data/raw/{filename}`
3. Backend runs `dvc push` to store the file in MinIO
4. Backend commits the `.dvc` pointer file and `.gitignore` to Git
5. Backend creates a Git tag (e.g., `data-v1`) for the version

**F-DVC-04: Dataset Version Browser**
The Data panel in the UI displays:
- All tracked files with their current version number
- File size, last modified date, and derived-from lineage (if applicable)
- A version history per file (derived from Git tags/commits)
- Ability to select a specific version for use in the current session

**F-DVC-05: Version Switching**
When a user selects a different dataset version in the UI, the backend runs `git checkout {tag}` followed by `dvc checkout` to materialize the correct file versions in the working directory. The kernel is notified of the change.

**F-DVC-06: Processed Data Tracking**
When notebook cells produce output files in `data/processed/`, the backend can (optionally, user-triggered) run `dvc add` on those outputs, establishing a dependency chain: processed v1 derived from raw v1.

**F-DVC-07: Data Hash Injection into MLflow**
Whenever an MLflow run is created (explicit or automatic mode), the backend injects the current DVC data hash as an MLflow run tag (`dvc.data_hash`). This establishes traceability from model to data version.

**F-DVC-08: Collaborative Conflict Resolution**
When two users modify data simultaneously:
1. The backend uses a project-level lock (extending the existing CollaborationManager's cell-lock pattern) for Git operations
2. DVC operations are serialized per project
3. If a conflict occurs on a `.dvc` file, the backend resolves by accepting the latest push and notifying the other user

**F-DVC-09: ProjectVersionControl Abstraction**
All Git and DVC operations go through a `ProjectVersionControl` service interface. This decouples the rest of the backend from the specific VCS implementation, allowing future migration to `--no-scm` mode or alternative backends.

#### 3.2.2 Acceptance Criteria

- Uploading a 500MB dataset completes within 60 seconds on the target server
- Version switching materializes the correct files without kernel restart
- Every MLflow run has a non-empty `dvc.data_hash` tag
- Two simultaneous uploads to the same project do not corrupt Git or DVC state
- The UI never displays Git concepts (commits, branches, refs) - only version numbers and dates

#### 3.2.3 Out of Scope

- User-facing Git operations (commit messages, branch management, merge UI)
- DVC pipeline definitions (`dvc.yaml`) authored by users in the UI (pipelines are Airflow's domain)
- `dvc repro` triggered from the UI (deferred to future iteration)
- DVC metrics and plots (MLflow handles metrics; DVC is for data only)
- Git hosting or remote push to GitHub/GitLab

---

### 3.3 Experiment Tracking (MLflow)

**Purpose:** Record, compare, and analyze ML experiment results with full provenance.

#### 3.3.1 Features

**F-MLF-01: MLflow Server Configuration**
The existing MLflow 3.x Tracking Server (container `emi-mlflow`) is configured with:
- PostgreSQL as the backend store (metadata) - uses the existing `airflow-postgres-1` instance with a dedicated `mlflow` database
- MinIO as the artifact store (models, plots, data samples)
- Accessible only via the noted backend on the Docker internal network

**F-MLF-02: Experiment-Project Mapping**
Each noted project maps to exactly one MLflow Experiment. The experiment is created when the project is created. The mapping is stored in `project.json`.

**F-MLF-03: Kernel Environment Injection**
When a kernel starts for a project (via the existing `kernel:start` Socket.io event), the KernelManagerService injects environment variables:
- `MLFLOW_TRACKING_URI` - pointing to the MLflow server (Docker internal URL)
- `MLFLOW_EXPERIMENT_NAME` - set from project metadata
- `MLFLOW_RUN_TAGS` - JSON containing project_id, notebook name
- Existing `LD_LIBRARY_PATH` injection for CUDA is preserved

This enables explicit mode without any user configuration.

**F-MLF-04: Explicit Instrumentation Support**
Users write standard MLflow API calls in notebook cells. The backend does not intercept or modify these calls. MLflow is available as a default dependency in ML-oriented environments (installed via the existing EnvironmentManager).

**F-MLF-05: Automatic Instrumentation Mode**
When enabled per project:
1. Before cell execution, the ExecutionBridge checks for an active MLflow run in the kernel
2. If none exists, it opens one via kernel injection
3. It detects ML framework objects in the kernel namespace post-execution
4. It activates the appropriate autolog module (pytorch, sklearn, tensorflow, xgboost, lightgbm)
5. Captured metrics are forwarded via Socket.io to all connected clients viewing the project
6. Auto-runs are tagged `instrumentation: auto`

The backend backs off if an explicit `mlflow.start_run()` is detected.

**F-MLF-06: Live Metrics Streaming**
During training, metrics logged via MLflow are intercepted by the backend (via polling the MLflow API or a callback mechanism) and pushed to the frontend via Socket.io. The Experiments sidebar shows:
- Current run name and status
- Live-updating metric charts (loss, accuracy, MAE, etc.)
- Epoch/step counter

**F-MLF-07: Run List and Filtering**
The Experiments panel displays all runs for the current project with:
- Run name, status (running/completed/failed), start time, duration
- Key metrics (configurable per project)
- Tags including instrumentation mode, data version hash, Hydra config hash
- Filtering by status, date range, metric thresholds, and tags
- Sorting by any metric or timestamp

**F-MLF-08: Run Comparison**
Users can select 2-5 runs and view:
- Overlaid metric charts (e.g., loss curves on the same axes)
- Parameter diff table (highlighting differences)
- Hydra config diff (if both runs have config snapshots)
- Data version comparison (same or different DVC hash)

**F-MLF-09: Artifact Browser**
Within a run's detail view, users can browse artifacts stored in MinIO:
- Model files with download links (pre-signed URLs)
- Plots and images rendered inline
- Log files viewable in a text panel
- Hydra config snapshots viewable as formatted YAML

**F-MLF-10: GenAI Tracing (MLflow 3.x)**
For projects using LLM-based workflows:
- The Experiments panel can display MLflow traces showing prompt-response chains
- Trace visualization includes latency per step, token counts, and retrieval context
- This is a read-only view of data logged by the user via MLflow's tracing API

#### 3.3.2 Acceptance Criteria

- Metrics appear in the UI sidebar within 2 seconds of being logged in the kernel
- Run comparison loads within 3 seconds for runs with up to 10,000 logged metric steps
- Auto-instrumentation correctly detects PyTorch, scikit-learn, and TensorFlow without false positives
- Auto-instrumentation does not interfere with explicit MLflow calls in the same session
- All artifacts are accessible via pre-signed URLs without the user needing MinIO credentials

#### 3.3.3 Out of Scope

- MLflow Projects (noted has its own project model)
- MLflow UI embedding or direct access (all interaction through noted UI)
- MLflow AI Gateway / LLM routing (evaluated separately)
- Custom MLflow plugins
- Multi-experiment views (cross-project comparison)

---

### 3.4 Configuration Management (Hydra + OmegaConf)

**Purpose:** Enable structured, validated, swappable configuration for ML experiments without hardcoding parameters.

#### 3.4.1 Features

**F-HYD-01: Config Directory Convention**
Each project has a `config/` directory following Hydra's config group structure. The directory layout defines the available configuration options:
```
config/
    config.yaml          # defaults list
    model/
        gru.yaml
        transformer.yaml
    data/
        jena.yaml
    training/
        default.yaml
```

**F-HYD-02: Structured Config Validation**
Projects can define Python dataclasses (in `src/`) as OmegaConf Structured Configs. The backend uses these to validate configuration values at the type level before any execution occurs.

**F-HYD-03: Config Editor UI**
The Config panel renders a dynamic form based on the project's Hydra config structure:
- Config groups appear as dropdowns (e.g., model: GRU | Transformer)
- Selecting a group dynamically renders that group's fields
- Numeric fields validate type constraints from Structured Configs
- String fields with known enum values render as selects
- Nested configs render as collapsible sections

The form generates a set of Hydra CLI overrides (e.g., `model=transformer model.n_heads=8`).

**F-HYD-04: Config Composition via Backend**
The backend uses `hydra.compose()` to assemble a complete configuration from the user's selections. This composed config is:
- Validated against Structured Configs
- Displayed as a read-only YAML preview before execution
- Logged as an MLflow artifact when a run starts
- Passed as CLI overrides when triggering Airflow DAGs

**F-HYD-05: Config Versioning**
When a run executes with a specific Hydra config, the exact composed YAML is:
1. Saved in the Hydra `outputs/` directory (automatic Hydra behavior)
2. Logged as an MLflow artifact
3. Hashed and stored as an MLflow run tag (`hydra.config_hash`)
This enables config-to-model traceability.

**F-HYD-06: Config Templates**
Users can save a specific configuration as a named template (stored in `config/templates/`). Templates appear in the Config panel as quick-select options for common experiment setups.

**F-HYD-07: Sweep Configuration**
The Config panel supports defining Hydra multirun sweeps:
- Users specify ranges or lists for parameters (e.g., `learning_rate: 0.001, 0.01, 0.1`)
- The UI previews the total number of combinations
- Sweep configs are passed to Airflow for distributed execution (Phase 3)

#### 3.4.2 Acceptance Criteria

- Config form renders correctly for configs with up to 3 levels of nesting
- Type validation catches mismatches (string in int field) before execution
- Config composition completes within 500ms
- Config hash is deterministic: same selections always produce the same hash
- Changing a config group in the UI updates dependent fields within 200ms

#### 3.4.3 Out of Scope

- Visual config graph editor (connections between config nodes)
- Config inheritance visualization
- Hydra plugin management (Sweeper plugins like Optuna are CLI-configured)
- OmegaConf custom resolvers defined through the UI

---

### 3.5 Pipeline Orchestration (Airflow)

**Purpose:** Execute ML workflows as production-grade, scheduled, monitored pipelines.

#### 3.5.1 Features

**F-AIR-01: Airflow Service Integration**
The existing Airflow 3.0 deployment (already running) consists of:
- API Server (`airflow-airflow-apiserver-1`) - REST API endpoint
- Scheduler (`airflow-airflow-scheduler-1`)
- DAG Processor (`airflow-airflow-dag-processor-1`)
- Celery Worker (`airflow-airflow-worker-1`)
- Triggerer (`airflow-airflow-triggerer-1`)
- PostgreSQL backend (shared with MLflow, `airflow-postgres-1`)
- Redis broker (`airflow-redis-1`, Airflow-managed)

The Airflow web UI remains accessible for admin use only (not exposed to noted users).

**F-AIR-02: DAG Generation from Project**
The backend generates Airflow DAG Python files from project metadata:
- Entry point: `src/train.py` (or user-configured script)
- Parameters: serialized Hydra config overrides
- Data step: `dvc pull` to ensure correct dataset version on the worker
- Training step: execute the entry point with Hydra overrides
- Logging step: handled within the training script via MLflow

Generated DAGs are written to `pipelines/dag_{project_id}.py` and synced to the Airflow DAGs directory.

**F-AIR-03: Pipeline Trigger from UI**
The Pipeline panel provides a "Submit Pipeline" button that:
1. Validates the current Hydra config
2. Generates or updates the DAG file
3. Calls the Airflow API Server to trigger a DAG run with the config as `conf` parameter
4. Returns a run ID for status tracking

**F-AIR-04: Pipeline Status Monitoring**
The Pipeline panel shows:
- A node graph of the DAG's task structure
- Real-time task state updates (queued, running, success, failed, skipped) via Socket.io
- Color-coded nodes matching Airflow's state conventions
- Task duration and timing information
- Ability to expand a task node to see its logs

**F-AIR-05: Task Log Streaming**
When a pipeline task is running, its stdout/stderr is streamed to the noted UI via Socket.io. The backend polls (or subscribes to) the Airflow log endpoint and forwards output to connected clients. This extends the same PTY-streaming pattern already used by the EnvironmentManager for package installation.

**F-AIR-06: Sweep Execution**
When a Hydra multirun sweep is configured (F-HYD-07), the backend generates a DAG with dynamic task mapping:
- Each parameter combination becomes a mapped task instance
- Airflow handles parallelism and retry logic
- The Pipeline panel shows individual sweep run status

**F-AIR-07: Pipeline History**
The Pipeline panel maintains a history of all DAG runs for the project:
- Run ID, trigger time, duration, final status
- Link to the corresponding MLflow runs generated during execution
- Ability to re-trigger a past run with the same or modified configuration

**F-AIR-08: Pipeline Scheduling**
Users can configure recurring schedules for pipelines:
- Cron expression or interval-based scheduling
- Schedule management (pause, resume, delete) from the UI
- Next run time display

#### 3.5.2 Acceptance Criteria

- DAG generation from project metadata completes within 5 seconds
- Pipeline trigger-to-first-task-start latency is under 30 seconds
- Task state updates appear in the UI within 3 seconds of state change
- Log streaming has less than 5 seconds latency from worker to UI
- A sweep of 20 configurations executes with correct parallelism (limited by worker count)
- Failed tasks show clear error messages in the UI without requiring Airflow UI access

#### 3.5.3 Out of Scope

- Custom DAG authoring in the UI (noted generates DAGs; users don't write them)
- Airflow plugin management
- Airflow user/role management (handled at the infrastructure level)
- Cross-project DAG dependencies
- Sensor-based triggers (e.g., waiting for external events beyond MinIO notifications)
- Airflow UI embedding or direct user access

---

### 3.6 Model Registry and Governance (MLflow Registry)

**Purpose:** Version, alias, and govern trained models from experiment to production.

#### 3.6.1 Features

**F-REG-01: Model Registration from Run**
From a completed run's detail view, users can register the run's model artifact:
1. Select the model artifact from the run's artifact browser
2. Assign a model name (or select an existing registered model)
3. The backend calls the MLflow Registry API to create a new model version
4. The version is automatically tagged with the run ID, data hash, and config hash

**F-REG-02: Models Panel**
The Models panel displays all registered models for the project:
- Model name
- All versions with: version number, creation date, source run link, key metrics, current alias
- Alias badges (`@staging`, `@champion`, `@archived`, or custom)
- Model description (editable)

**F-REG-03: Alias Management**
Users can assign or reassign aliases to model versions:
- Drag-and-drop or dropdown-based alias assignment
- Assigning `@champion` to a new version automatically removes it from the previous holder
- Alias changes are logged with timestamp and user for audit purposes
- Alias changes trigger a Socket.io event to notify connected clients

**F-REG-04: Model Lineage View**
For any model version, the UI displays the full lineage:
- Source MLflow run (with link to run detail)
- Hydra config used (with link to config snapshot)
- DVC data version used (with hash and link to data browser at that version)
- Training pipeline run ID (if trained via Airflow)

**F-REG-05: Model Comparison**
Users can select two model versions and compare:
- Metric differences
- Config differences (Hydra diff)
- Data version differences
- Architecture differences (if different model config groups)

**F-REG-06: Model Download**
Users can download any model version's artifacts via pre-signed MinIO URLs.

#### 3.6.2 Acceptance Criteria

- Model registration completes within 5 seconds
- Alias reassignment takes effect within 2 seconds across all connected clients
- Lineage view loads within 3 seconds and displays all four lineage components
- Model versions list loads within 2 seconds for models with up to 100 versions

#### 3.6.3 Out of Scope

- Model approval workflows (multi-stage review gates)
- Model A/B testing infrastructure
- Model performance monitoring in production (drift detection)
- Automated promotion rules (e.g., auto-promote if metric exceeds threshold)
- Model deletion (only archival via alias)

---

### 3.7 Model Serving

**Purpose:** Serve the current champion model via a FastAPI endpoint, testable from within noted.

#### 3.7.1 Features

**F-SRV-01: Serving Container**
A dedicated FastAPI container runs alongside the noted stack:
- On startup, loads the model tagged `@champion` from the MLflow Registry
- Exposes a `/predict` endpoint accepting JSON input
- Validates input against a Pydantic schema derived from the model's signature
- Returns predictions as JSON

**F-SRV-02: Hot Model Reload**
The serving container watches the MLflow Registry for alias changes:
- A background task polls (or receives notification via noted backend) for `@champion` changes
- When a new champion is detected, the container loads the new model
- During reload, the old model continues serving (no downtime)
- Reload completion is broadcast via Socket.io

**F-SRV-03: Try It Panel**
The UI provides an interactive prediction panel:
- Input form generated from the model's Pydantic schema
- "Predict" button sends the request to the serving endpoint via the noted backend proxy
- Response displayed as formatted JSON
- Request/response history maintained for the session

**F-SRV-04: Serving Health Display**
The UI shows:
- Currently loaded model name, version, and alias
- Model load time
- Request count and average latency (basic counters)
- Serving container health status

**F-SRV-05: Multi-Model Serving (Per Project)**
Each project can have its own serving endpoint. The noted backend routes `/projects/{project_id}/predict` to the appropriate serving instance. For resource efficiency, serving containers are started on-demand and stopped after an inactivity timeout.

#### 3.7.2 Acceptance Criteria

- Cold model load completes within 30 seconds for models up to 500MB
- Hot reload completes within 15 seconds with zero dropped requests
- Prediction latency (excluding model inference time) adds less than 50ms overhead
- Try It panel displays results within 1 second of model response

#### 3.7.3 Out of Scope

- GPU-accelerated inference (CPU serving only in initial scope; GPU serving as future work)
- Batch prediction endpoints
- Model serving autoscaling
- External-facing prediction APIs (serving is internal to noted only)
- Serving framework alternatives (TorchServe, TF Serving, Triton)
- Load balancing across multiple serving replicas

---

### 3.8 Collaborative Features (Extensions to Existing)

**Purpose:** Extend noted's existing collaboration model to cover all new MLOps domains.

#### 3.8.1 Features

**F-COL-01: Shared Experiment Visibility**
All collaborators on a project see the same Experiments sidebar. When one user starts a run, all connected users see it appear in real-time. This extends the existing CollaborationManager's room-based broadcasting.

**F-COL-02: Shared Pipeline Status**
Pipeline submissions and task state changes are visible to all connected project collaborators.

**F-COL-03: Shared Model Registry View**
Model registration and alias changes are reflected immediately for all connected users.

**F-COL-04: Activity Feed**
A lightweight activity log showing recent actions across all domains:
- "{User} uploaded dataset v3"
- "{User} started run #42 (GRU, lr=0.01)"
- "{User} promoted JenaForecaster v5 to @champion"
- "{User} triggered pipeline sweep (12 configs)"

**F-COL-05: Concurrent Data Upload Serialization**
When multiple users upload data simultaneously, operations are serialized per project to prevent Git/DVC conflicts. Users see a queue indicator.

#### 3.8.2 Acceptance Criteria

- Events propagate to all connected clients within 2 seconds
- Activity feed displays the 50 most recent actions per project
- No data corruption under concurrent operations from up to 5 simultaneous users

#### 3.8.3 Out of Scope

- Role-based access control (viewer, editor, admin per project)
- Approval workflows for model promotion
- Commenting or annotation on runs, models, or data versions
- Notification system (email, Slack integration for events)

---

### 3.9 UI Layout

**Purpose:** Define the spatial organization of all features within the noted interface.

#### 3.9.1 Layout Structure

The UI extends noted's existing panel-based architecture (jsPanel, Split.js, Wunderbaum) with new sidebar panels:

```
+---------------------------------------------------------------+
|  Top Bar: Project selector | Settings | User                  |
+----------+------------------------------------+---------------+
|          |                                    |               |
| Left     |         Main Workspace             |  Right        |
| Sidebar  |                                    |  Sidebar      |
|          |   Notebook cells (existing)        |               |
| - Data   |   Terminal output (existing)       | - Experiments |
| - Config |   Pipeline node graph (new)        | - Models      |
| - Files  |                                    | - Serving     |
|  (exist) |                                    | - Activity    |
|          |                                    |               |
+----------+------------------------------------+---------------+
|  Bottom Bar: Pipeline status | Kernel status | Storage usage  |
+---------------------------------------------------------------+
```

**Left sidebar** contains input-oriented panels: data management, configuration, file browser (existing Wunderbaum tree).

**Right sidebar** contains output-oriented panels: experiment results, model registry, serving, activity feed.

**Main workspace** contains the notebook editor (existing), terminal output (existing xterm.js), and pipeline visualization (new).

**Bottom bar** provides persistent status indicators.

#### 3.9.2 Panel Behavior

- Panels are collapsible and resizable (extending existing jsPanel/Split.js patterns)
- Only one panel per sidebar is expanded at a time (accordion behavior)
- Panel state (which is open, size) persists per user per project (localStorage, consistent with existing settings persistence)
- Panels load data lazily - only when expanded

#### 3.9.3 Acceptance Criteria

- Panel expansion/collapse animates within 200ms
- Switching between panels does not trigger data refetch if data is fresh (client-side cache with TTL)
- Layout is functional at viewport widths down to 1280px
- All panels are keyboard-navigable

---

## 4. Backend Service APIs

This section defines the API surface that the noted backend adds for MLOps features. All new endpoints follow the existing REST API patterns and are prefixed with `/api/`. Existing endpoints (projects, notebooks, runtimes, environments) remain unchanged.

### 4.1 Data Management

| Method | Endpoint                                          | Purpose                              |
|--------|---------------------------------------------------|--------------------------------------|
| POST   | /api/projects/{id}/data/upload                    | Upload and DVC-track a file          |
| GET    | /api/projects/{id}/data                           | List tracked files with versions     |
| GET    | /api/projects/{id}/data/{path}/versions           | Get version history for a file       |
| POST   | /api/projects/{id}/data/checkout                  | Switch to a specific data version    |
| GET    | /api/projects/{id}/data/{path}/download           | Get pre-signed download URL          |

### 4.2 Configuration

| Method | Endpoint                                          | Purpose                              |
|--------|---------------------------------------------------|--------------------------------------|
| GET    | /api/projects/{id}/config/schema                  | Get config structure for form generation |
| GET    | /api/projects/{id}/config/current                 | Get current composed config          |
| POST   | /api/projects/{id}/config/compose                 | Compose and validate config from overrides |
| GET    | /api/projects/{id}/config/templates               | List saved config templates          |
| POST   | /api/projects/{id}/config/templates               | Save current config as template      |

### 4.3 Experiments

| Method | Endpoint                                          | Purpose                              |
|--------|---------------------------------------------------|--------------------------------------|
| GET    | /api/projects/{id}/experiments/runs               | List runs with filtering/sorting     |
| GET    | /api/projects/{id}/experiments/runs/{run_id}      | Get run detail (metrics, params, tags) |
| GET    | /api/projects/{id}/experiments/runs/{run_id}/artifacts| List run artifacts                |
| POST   | /api/projects/{id}/experiments/compare            | Compare selected runs                |

### 4.4 Pipelines

| Method | Endpoint                                          | Purpose                              |
|--------|---------------------------------------------------|--------------------------------------|
| POST   | /api/projects/{id}/pipelines/trigger              | Trigger a pipeline DAG run           |
| GET    | /api/projects/{id}/pipelines/runs                 | List pipeline run history            |
| GET    | /api/projects/{id}/pipelines/runs/{run_id}/status | Get task-level status                |
| GET    | /api/projects/{id}/pipelines/runs/{run_id}/logs/{task}| Get task logs                    |
| POST   | /api/projects/{id}/pipelines/schedule             | Create or update a schedule          |
| DELETE | /api/projects/{id}/pipelines/schedule             | Remove a schedule                    |

### 4.5 Model Registry

| Method | Endpoint                                          | Purpose                              |
|--------|---------------------------------------------------|--------------------------------------|
| GET    | /api/projects/{id}/models                         | List registered models               |
| POST   | /api/projects/{id}/models/register                | Register a model from a run          |
| GET    | /api/projects/{id}/models/{name}/versions         | List versions of a model             |
| PUT    | /api/projects/{id}/models/{name}/versions/{v}/alias| Set alias on a version              |
| GET    | /api/projects/{id}/models/{name}/versions/{v}/lineage| Get full lineage for a version    |
| POST   | /api/projects/{id}/models/compare                 | Compare two model versions           |

### 4.6 Serving

| Method | Endpoint                                          | Purpose                              |
|--------|---------------------------------------------------|--------------------------------------|
| GET    | /api/projects/{id}/serving/status                 | Get serving container health         |
| POST   | /api/projects/{id}/serving/predict                | Proxy prediction request             |
| GET    | /api/projects/{id}/serving/schema                 | Get input/output schema              |

### 4.7 New Socket.io Events (MLOps)

These events extend the existing Socket.io event vocabulary:

| Event Name                  | Direction       | Payload                                   |
|-----------------------------|-----------------|-------------------------------------------|
| `metric:update`             | Server -> Client| run_id, metric_name, step, value, timestamp |
| `run:status`                | Server -> Client| run_id, status, timestamp                  |
| `pipeline:task_status`      | Server -> Client| pipeline_run_id, task_id, state, timestamp |
| `pipeline:task_log`         | Server -> Client| pipeline_run_id, task_id, log_line         |
| `data:version_created`      | Server -> Client| file_path, version, hash, timestamp        |
| `model:alias_changed`       | Server -> Client| model_name, version, alias, user, timestamp|
| `model:registered`          | Server -> Client| model_name, version, run_id, timestamp     |
| `serving:model_loaded`      | Server -> Client| model_name, version, load_time             |
| `activity:event`            | Server -> Client| user, action, details, timestamp           |

---

## 5. Infrastructure Scope

### 5.1 Docker Services

**Already running (no changes needed):**

| Service                | Container Name                  | Ports (internal) | Notes                         |
|------------------------|---------------------------------|------------------|-------------------------------|
| noted                  | noted                           | 8123             | Single container: API + frontend |
| mlflow-server          | emi-mlflow                      | 5000             | MLflow 3.x, tracking + registry |
| airflow-apiserver      | airflow-airflow-apiserver-1     | 8080             | Airflow 3.0 REST API           |
| airflow-scheduler      | airflow-airflow-scheduler-1     | -                |                                |
| airflow-worker         | airflow-airflow-worker-1        | -                | Celery worker                  |
| airflow-triggerer      | airflow-airflow-triggerer-1     | -                | Airflow 3.0                    |
| airflow-dag-processor  | airflow-airflow-dag-processor-1 | -                | Airflow 3.0                    |
| minio                  | airflow-minio                   | 9000, 9001       |                                |
| postgres               | airflow-postgres-1              | 5432             | Shared: MLflow + Airflow       |
| redis                  | airflow-redis-1                 | 6379             | Airflow-managed Celery broker  |
| nginx                  | proxy_server                    | 80, 443          | SSL termination, routing       |

**To be added:**

| Service                | Purpose                         | Notes                         |
|------------------------|---------------------------------|-------------------------------|
| model-server           | FastAPI model serving           | On-demand, per project        |

### 5.2 Network Architecture

```
[Internet]
    |
[nginx reverse proxy] (SSL termination)
    |
    +-- /noted/         -> noted:8123
    +-- /api/           -> noted:8123
    +-- /ws/            -> noted:8123 (Socket.io)
    +-- /admin/airflow/ -> airflow-apiserver:8080 (admin only)
    +-- /admin/minio/   -> minio:9001 (admin only)
```

All inter-service communication uses the Docker internal network. Only nginx is exposed externally.

### 5.3 Database Schema

PostgreSQL hosts separate databases within the shared instance (`airflow-postgres-1`):
- `noted` - noted application metadata (projects, users, sessions) - to be created
- `mlflow` - MLflow tracking metadata (existing or to be confirmed)
- `airflow` - Airflow metadata (existing)

No cross-database queries. Services own their schemas exclusively.

### 5.4 Resource Requirements

| Service            | CPU   | RAM    | GPU  | Disk             |
|--------------------|-------|--------|------|------------------|
| noted              | 2     | 2GB    | Yes  | 10GB (projects)  |
| mlflow-server      | 1     | 1GB    | No   | Minimal          |
| airflow (all)      | 2     | 4GB    | No   | 5GB              |
| minio              | 1     | 2GB    | No   | Scales with data |
| postgres           | 1     | 2GB    | No   | 20GB             |
| redis              | 0.5   | 512MB  | No   | Minimal          |
| model-server       | 2     | 4GB    | Optional | Minimal       |
| **Total baseline** | **9.5** | **15.5GB** | - | **35GB+**    |

---

## 6. Technical Constraints

### 6.1 Compatibility Requirements

- **Airflow version:** 3.0 (already deployed and running)
- **MLflow version:** 3.x (already deployed and running)
- **DVC version:** 3.x with S3-compatible remote support
- **Hydra version:** 1.3+ with Compose API and Structured Config support
- **Python version:** 3.11+ for noted backend; 3.10-3.14 for project kernels (already supported)
- **Browser support:** Chrome/Edge 120+, Firefox 120+, Safari 17+
- **Frontend:** Vanilla ES6 modules (no build step, no framework)

### 6.2 Performance Constraints

- Socket.io event latency: under 2 seconds end-to-end
- API response time for read operations: under 1 second (p95)
- API response time for write operations: under 5 seconds (p95)
- Concurrent users per project: up to 5
- Concurrent projects with active kernels: up to 10
- Maximum dataset size for DVC tracking: limited by MinIO storage and network bandwidth, not by noted

### 6.3 Security Constraints

- No backend service (MLflow, Airflow, MinIO) is directly accessible from the browser
- All inter-service credentials are managed via Docker secrets or environment variables
- Pre-signed URLs have a maximum TTL of 1 hour
- CORS restricted to the noted frontend origin
- Authentication: currently open access (to be designed separately)

---

## 7. Dependencies and Risks

### 7.1 External Dependencies

| Dependency                | Risk Level | Mitigation                                    |
|---------------------------|------------|-----------------------------------------------|
| Airflow 3.0 API stability | Low        | Already deployed and running                  |
| MLflow 3.x Registry API  | Low        | Already deployed and running                  |
| DVC + pygit2 integration | Medium     | Subprocess fallback if pygit2 is problematic  |
| Hydra Compose API        | Low        | Mature and stable                             |
| MinIO S3 compatibility   | Low        | Battle-tested with MLflow and DVC             |

### 7.2 Technical Risks

| Risk                                      | Impact | Likelihood | Mitigation                                  |
|-------------------------------------------|--------|------------|----------------------------------------------|
| Git corruption in backend-managed repos   | High   | Low        | Regular integrity checks, backup strategy    |
| Airflow worker cannot access project data | High   | Medium     | Shared volume mount or DVC pull in DAG       |
| MLflow autolog conflicts with user code   | Medium | Medium     | Detection logic, graceful fallback to explicit|
| Hydra compose fails on complex configs    | Medium | Low        | Validation layer, error reporting to UI      |
| Docker Compose resource exhaustion        | High   | Medium     | Resource limits per container, monitoring    |
| Socket.io event ordering across services  | Medium | Medium     | Sequence numbers, client-side reconciliation |
| Kernel session model vs project model     | Medium | Medium     | Clear mapping: one kernel per session, MLflow env per project |

---

## 8. Glossary

| Term              | Definition                                                              |
|-------------------|-------------------------------------------------------------------------|
| Artifact          | Any file produced by an ML run: model weights, plots, logs, configs     |
| Alias             | A named tag on a model version (e.g., @champion, @staging)              |
| Config Group      | A Hydra directory containing alternative YAML configs for one component |
| DAG               | Directed Acyclic Graph - Airflow's representation of a pipeline         |
| Data Hash         | The DVC-computed hash of a tracked dataset, used for lineage            |
| Explicit Mode     | MLflow instrumentation where the user writes tracking code manually     |
| Auto Mode         | MLflow instrumentation where the backend detects and logs automatically |
| Lineage           | The traceable chain: data version -> config -> run -> model version     |
| Pointer File      | A `.dvc` file containing the hash of a large file stored in MinIO      |
| Structured Config | A Python dataclass used by OmegaConf for type-validated configuration  |
| Sweep             | A Hydra multirun executing the same script with multiple config combos  |
| ExecutionBridge   | noted's existing Socket.io to Jupyter ZMQ message bridge               |
| CollaborationManager | noted's existing real-time collaboration service                    |
| EnvironmentManager | noted's existing runtime-aware virtual environment service            |

---

## 9. What This Document Does Not Cover

- Phase sequencing, timelines, and task breakdowns (see Plan document)
- Architectural decisions rationale (see Vision document)
- AI-assisted instrumentation mode specification (separate document)
- Detailed UI wireframes and component specifications (to be produced during development)
- Security model, authentication, and authorization design (to be defined - currently open access)
- Testing strategy and quality assurance plan (to be defined)
- Operational runbooks and incident response (to be defined)
