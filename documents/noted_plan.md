# noted - Integrated MLOps Platform Plan

## Document Information

| Field         | Value                              |
|---------------|------------------------------------|
| Document      | Development Plan                   |
| Project       | noted - Integrated MLOps Platform  |
| Version       | 1.1                                |
| Date          | 2026-03-08                         |
| Status        | Draft                              |
| Related       | Vision Document v1.1, Scope Document v1.1 |
| Changes       | v1.1: Phase 0 reduced to verification-only (infrastructure already running). All references updated to reflect single-container architecture, existing managers, Airflow 3.0 components, and actual container names. |

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

- Phase 1 delivers experiment tracking and data versioning (the most frequently used MLOps capabilities)
- Phase 2 adds configuration management and orchestration (production workflows)
- Phase 3 adds model governance and serving (deployment lifecycle)
- Phase 4 adds cross-cutting integration polish and the end-to-end experience

### 2.3 Phase Overview

| Phase | Name                              | Primary Tools                   | Key Deliverable                                          |
|-------|-----------------------------------|---------------------------------|----------------------------------------------------------|
| 0     | Infrastructure Verification       | MinIO, PostgreSQL, Docker       | All services verified connectable and interoperable      |
| 1     | Tracking and Data                 | MLflow Tracking, DVC, Git       | Live experiment tracking + versioned data in noted UI    |
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
- MLflow server (`emi-mlflow:5000`)
- Airflow API Server (`airflow-airflow-apiserver-1:8080`)
- MinIO (`airflow-minio:9000`)
- PostgreSQL (`airflow-postgres-1:5432`)

Acceptance: HTTP health checks pass from within the noted container for each service.

**T-0.2: PostgreSQL Database Setup**
Create a dedicated `noted` database within the existing PostgreSQL instance (`airflow-postgres-1`) for noted application metadata. Confirm MLflow's database also exists and is accessible.

Acceptance: noted backend can connect to the `noted` database. MLflow backend store is confirmed operational.

**T-0.3: MinIO Bucket Structure**
Create the base bucket structure in the existing MinIO instance (`airflow-minio`):
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
- `pygit2` (or `git` subprocess) can initialize a bare repo
- `dvc init` succeeds within a test project directory
- `dvc add` on a test file creates a `.dvc` pointer file
- `dvc push` sends the file to MinIO (`noted-dvc` bucket)
- `dvc pull` in a clean directory retrieves the file from MinIO

Acceptance: Round-trip test (add -> push -> delete local -> pull -> verify content) passes.

**T-0.7: Airflow Worker Access to Project Data**
Resolve how the Airflow worker (`airflow-airflow-worker-1`) accesses project files:
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

---

## 4. Phase 1: Tracking and Data

**Goal:** Users can version datasets and track experiments with live metrics - all from within the noted UI.

**Rationale:** Experiment tracking and data versioning are the two highest-value, most frequently used MLOps capabilities. Delivering these first gives immediate value to any user running training code in noted.

### 4.1 Backend Tasks

**T-1.1: ProjectVersionControl Service**
Implement the `ProjectVersionControl` abstraction layer as a new backend manager:
- Interface defining: init, add_file, commit, tag, checkout, get_versions, get_current_hash
- Implementation using pygit2 (or subprocess) + DVC CLI
- Project-level locking for Git operations (extending the existing CollaborationManager's lock pattern)
- Integrated into the existing NotebookManager's project creation flow: new project = new Git repo + DVC init + MinIO remote config

Scope reference: F-DVC-01, F-DVC-02, F-DVC-09

**T-1.2: Data Upload and Tracking Endpoint**
Implement `POST /api/projects/{id}/data/upload`:
- Accepts multipart file upload
- Writes to `data/raw/` in the project directory
- Calls ProjectVersionControl to add, push, commit, and tag
- Returns version info (version number, hash, size)

Scope reference: F-DVC-03

**T-1.3: Data Listing and Version History Endpoints**
Implement:
- `GET /api/projects/{id}/data` - list all tracked files with current version
- `GET /api/projects/{id}/data/{path}/versions` - version history for a file
- `GET /api/projects/{id}/data/{path}/download` - pre-signed URL from MinIO

Scope reference: F-DVC-04, F-MINIO-04

**T-1.4: Data Version Switching Endpoint**
Implement `POST /api/projects/{id}/data/checkout`:
- Accepts a version tag or hash
- Calls ProjectVersionControl to checkout + DVC checkout
- Notifies connected clients via Socket.io (`data:version_created`)

Scope reference: F-DVC-05

**T-1.5: MLflow Integration in Kernel Startup**
Extend the existing KernelManagerService to inject MLflow environment variables when a kernel starts (via the existing `kernel:start` Socket.io event handler):
- `MLFLOW_TRACKING_URI` pointing to MLflow (`emi-mlflow:5000`)
- `MLFLOW_EXPERIMENT_NAME` set from project metadata
- Existing `LD_LIBRARY_PATH` injection for CUDA is preserved
- Ensure `mlflow` is available in the project's environment (via EnvironmentManager as a default dependency)

Scope reference: F-MLF-02, F-MLF-03

**T-1.6: Explicit MLflow Support Verification**
Verify that users can write standard MLflow code in notebook cells:
- `import mlflow` works
- `mlflow.start_run()` connects to the correct experiment
- `mlflow.log_metric()` persists to the MLflow server
- `mlflow.log_artifact()` stores files in MinIO

Scope reference: F-MLF-04

**T-1.7: Auto-Instrumentation Engine**
Implement the automatic MLflow tracking mode by extending the existing ExecutionBridge:
- Project setting: `auto_tracking: bool` in project.json
- Pre-execution hook (in ExecutionBridge): check kernel namespace for active MLflow run; if none and auto_tracking is enabled, inject `mlflow.start_run()`
- Post-execution hook: inspect kernel namespace for known framework objects; activate corresponding autolog
- Detection targets: `torch.nn.Module`, `sklearn.base.BaseEstimator`, `tensorflow.keras.Model`, `xgboost.Booster`, `lightgbm.Booster`
- Tag auto-runs with `instrumentation: auto`
- Back-off logic: if `mlflow.start_run` is detected in cell source code, skip injection

Scope reference: F-MLF-05

**T-1.8: Live Metrics Streaming**
Implement real-time metric forwarding:
- Backend polls MLflow API for active runs in the project's experiment (configurable interval, default 1s)
- When new metric steps are detected, emit `metric:update` via Socket.io (through CollaborationManager's room broadcasting)
- Include run_id, metric_name, step, value, and timestamp in the event payload
- Polling starts when a kernel executes a cell and stops when no active runs remain

Alternative approach (evaluate during implementation): intercept `mlflow.log_metric()` calls at the kernel level via a custom MLflow plugin or monkey-patch, which would eliminate polling latency.

Scope reference: F-MLF-06

**T-1.9: Experiment Runs API**
Implement:
- `GET /api/projects/{id}/experiments/runs` - list runs with filtering (status, date, tags) and sorting (metric, time)
- `GET /api/projects/{id}/experiments/runs/{run_id}` - full run detail (metrics history, params, tags, artifacts list)
- `GET /api/projects/{id}/experiments/runs/{run_id}/artifacts` - list artifacts with pre-signed download URLs
- `POST /api/projects/{id}/experiments/compare` - accepts list of run IDs, returns metric histories and param diffs

Scope reference: F-MLF-07, F-MLF-08, F-MLF-09

**T-1.10: DVC Hash Injection into MLflow Runs**
When an MLflow run starts (explicit or auto), the backend injects the current DVC data hash as a run tag:
- Tag key: `dvc.data_hash`
- Value: computed from `.dvc` file hashes in the project
- For auto mode: runs as part of the ExecutionBridge pre-execution hook
- For explicit mode: injected as a kernel-level environment variable (`MLFLOW_RUN_TAGS`)

Scope reference: F-DVC-07

### 4.2 Frontend Tasks

**T-1.11: Data Panel (Left Sidebar)**
Implement the Data panel as a new UI component (vanilla ES6 module):
- File list showing tracked files with version badge, size, and date
- Upload area (drag-and-drop or file picker) that calls the upload endpoint
- Version history expandable per file
- Version selector (dropdown or timeline) that triggers checkout
- Upload progress indicator
- Real-time updates via `data:version_created` Socket.io events

**T-1.12: Experiments Panel (Right Sidebar)**
Implement the Experiments panel as a new UI component:
- Run list with status indicator (running/completed/failed), key metrics, and timestamp
- Filter bar: status dropdown, date range picker, metric threshold input
- Sort selector: by metric value, start time, duration
- Click a run to expand detail view: full metrics, params, tags
- Live-updating metrics for running experiments (subscribes to `metric:update` events)
- Inline metric chart (small sparkline or line chart per metric)

**T-1.13: Run Comparison View**
Implement comparison as an overlay or expanded panel:
- Checkbox selection on runs (2-5 runs)
- "Compare" button opens comparison view
- Overlaid metric charts (shared axes, one color per run)
- Parameter diff table (highlight cells that differ)
- Data version column showing DVC hash per run

**T-1.14: Artifact Browser**
Within run detail view:
- Tree view of artifacts
- Image artifacts render inline (plots, charts)
- Text artifacts render in a code viewer
- All other artifacts show download link (pre-signed URL)

**T-1.15: Sidebar Layout Infrastructure**
Implement the panel framework extending existing jsPanel/Split.js patterns:
- Left sidebar with accordion behavior (one panel expanded at a time)
- Right sidebar with accordion behavior
- Panels are collapsible, resizable, and state-persistent (localStorage)
- Lazy loading: panel data fetched only when expanded
- Bottom status bar showing kernel status (existing) + storage usage (new)

### 4.3 Exit Criteria

- A user can upload a dataset, see it versioned in the Data panel, switch between versions
- A user can run training code with explicit `mlflow` calls and see metrics appear in the Experiments panel within 2 seconds
- A user can enable auto-tracking and see metrics logged without writing any MLflow code
- A user can compare two runs and see overlaid loss curves and parameter diffs
- Every run has a `dvc.data_hash` tag linking it to the data version
- Two users connected to the same project see each other's runs appear in real-time

---

## 5. Phase 2: Configuration and Orchestration

**Goal:** Users can manage Hydra configurations through the UI and submit pipeline runs to Airflow.

**Rationale:** Once users can track experiments (Phase 1), the natural next step is parameterizing them (Hydra) and running them at scale (Airflow). This phase transitions noted from an interactive tool to a production pipeline manager.

### 5.1 Backend Tasks

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
- Generated DAGs are synced to the Airflow DAGs directory (accessible by `airflow-airflow-dag-processor-1`)

Scope reference: F-AIR-02

**T-2.6: Pipeline Trigger Endpoint**
Implement `POST /api/projects/{id}/pipelines/trigger`:
- Accepts: Hydra config overrides, optional data version tag
- Validates config via the composition endpoint
- Ensures the DAG file exists (generates if needed)
- Calls Airflow API Server (`airflow-airflow-apiserver-1`): trigger DAG run with `conf` containing overrides
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

### 5.2 Frontend Tasks

**T-2.11: Config Panel (Left Sidebar)**
Implement the Config panel component (vanilla ES6 module):
- Dynamic form generated from the schema endpoint
- Config group dropdowns that swap field sets on selection
- Type-appropriate input controls (number, text, select, boolean toggle)
- Validation feedback inline (red borders, error messages)
- "Compose" button that calls the composition endpoint and shows the full YAML preview
- Config hash displayed for reference
- Template selector dropdown and "Save as Template" button

**T-2.12: YAML Preview Panel**
Within the Config panel, a collapsible section showing:
- The composed YAML (read-only, syntax-highlighted)
- Diff view when comparing against a previous config or template

**T-2.13: Sweep Configuration UI**
Extension to the Config panel:
- "Sweep" toggle that switches a field from single-value to multi-value input
- Multi-value inputs accept comma-separated values or range syntax (start:stop:step)
- Combination count displayed (e.g., "24 configurations")
- "Submit Sweep" button that triggers pipeline with sweep parameters

**T-2.14: Pipeline Panel (Main Workspace)**
Implement a Pipeline view that replaces or overlays the notebook area:
- DAG node graph visualization showing task names and dependencies
- Color-coded task nodes: grey (queued), blue (running), green (success), red (failed), yellow (skipped)
- Real-time updates from `pipeline:task_status` Socket.io events
- Click a task node to expand and see its streaming logs
- Log output area that receives `pipeline:task_log` events

**T-2.15: Pipeline History View**
Within the Pipeline panel:
- List of past pipeline runs with status, duration, config summary
- Click a run to replay its node graph state
- Link to corresponding MLflow runs (opens in Experiments panel)

**T-2.16: Pipeline Status in Bottom Bar**
Add to the bottom status bar:
- Active pipeline indicator (running/idle)
- Last pipeline status (success/failed with timestamp)
- Click to jump to Pipeline panel

### 5.3 Exit Criteria

- A user can open the Config panel, select a model architecture, adjust hyperparameters, and see the composed YAML
- Config validation catches type errors before execution
- A user can click "Submit Pipeline" and see a live node graph of the Airflow execution in noted
- Task logs stream into the UI in real-time
- A sweep of 10 configurations runs with correct parallelism
- The pipeline run creates MLflow runs with correct config hash tags
- Pipeline history shows past runs with links to their experiment results

---

## 6. Phase 3: Registry and Serving

**Goal:** Users can promote models and test predictions from within noted.

**Rationale:** After experiments are tracked (Phase 1) and parameterized/orchestrated (Phase 2), the final lifecycle step is governance and deployment. This phase completes the data-to-deployment flow.

### 6.1 Backend Tasks

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
- On startup: loads model from MLflow Registry (`emi-mlflow`) using `@champion` alias
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

### 6.2 Frontend Tasks

**T-3.10: Models Panel (Right Sidebar)**
Implement the Models panel component (vanilla ES6 module):
- List of registered models with version count
- Expand a model to see versions with: version number, alias badge, creation date, key metric
- Alias management: dropdown or drag-and-drop to assign @champion, @staging, @archived
- "Register Model" action accessible from run detail view (cross-panel interaction)
- Real-time updates from `model:registered` and `model:alias_changed` events

**T-3.11: Model Lineage View**
Within model version detail:
- Visual lineage chain: Data (version + hash) -> Config (YAML preview) -> Run (metrics summary) -> Model (version + alias)
- Each node in the chain is clickable, navigating to the corresponding panel/view
- If trained via pipeline, includes the pipeline run link

**T-3.12: Model Comparison View**
Select two versions via checkbox, side-by-side comparison of metrics, config, data version, architecture.

**T-3.13: Try It Panel (Right Sidebar)**
Implement the Serving / Try It panel:
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

### 6.3 Exit Criteria

- A user can register a model from a completed run
- A user can assign @champion alias and see the serving container load the model
- A user can send a prediction request from the Try It panel and see the result
- Model lineage displays the complete chain from data version through config to model
- Hot reload works: promoting a new champion updates the serving container without downtime
- All alias changes propagate to connected clients in real-time

---

## 7. Phase 4: Integration and Polish

**Goal:** Close the integration gaps, add collaboration features, and deliver the end-to-end experience described in the Vision document.

**Rationale:** Phases 1-3 deliver the individual capabilities. Phase 4 connects them into a seamless workflow and adds the collaborative layer that makes noted a team tool.

### 7.1 Backend Tasks

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

### 7.2 Frontend Tasks

**T-4.7: Activity Feed Panel (Right Sidebar)**
Implement the Activity panel (vanilla ES6 module):
- Chronological list of recent events with user name, action description, timestamp
- Click an event to navigate to the relevant panel/view
- Real-time updates from `activity:event` events
- Filter by event type (data, experiment, pipeline, model)

**T-4.8: Cross-Panel Navigation**
Implement contextual links between panels:
- From a run: link to its data version (opens Data panel at that version)
- From a run: link to its config (opens Config panel with those values)
- From a model version: link to its source run (opens Experiments panel)
- From a pipeline run: link to its MLflow runs (opens Experiments panel, filtered)
- From an activity event: link to the relevant entity

**T-4.9: GenAI Trace Visualization**
Within run detail (for LLM project runs):
- Waterfall chart showing trace steps with latency
- Expandable steps showing input/output per step
- Token count and cost summary

**T-4.10: Storage Usage Display**
In the bottom status bar and project settings:
- Total storage used
- Breakdown visualization (data vs artifacts vs models)

**T-4.11: Onboarding and Empty States**
For each panel, implement meaningful empty states:
- Data panel empty: "Upload your first dataset to get started"
- Experiments panel empty: "Run a cell with MLflow tracking to see results here"
- Config panel empty: "Add YAML files to config/ to define your experiment parameters"
- Pipeline panel empty: "Create a train.py entry point in src/ to enable pipeline execution"
- Models panel empty: "Register a model from a completed run to manage versions"
- Serving panel empty: "Promote a model to @champion to enable predictions"

Each empty state guides the user to the next action, implementing the progressive complexity principle.

**T-4.12: UI Performance Optimization**
- Implement virtual scrolling for long run lists (100+ runs)
- Optimize Socket.io event handling to batch UI updates (debounce metric updates at 500ms)
- Implement client-side caching with TTL for panel data
- Lazy-load chart libraries only when comparison view is opened

### 7.3 Exit Criteria

- The full scenario from Vision document Section 6.1 is executable end-to-end without leaving noted
- All cross-panel links work correctly
- Activity feed shows a coherent timeline of all actions
- Two concurrent users experience real-time collaboration across all panels
- Empty states guide new users through the platform's capabilities
- No panel load exceeds 3 seconds under normal conditions

---

## 8. Task Dependency Map

```
Phase 0 (all tasks can run in parallel - verification only)
    |
    v
Phase 1:
    T-1.1 (ProjectVersionControl)
        |
        +-> T-1.2, T-1.3, T-1.4 (Data endpoints)
        |       |
        |       +-> T-1.11 (Data panel UI)
        |
        +-> T-1.10 (DVC hash injection)

    T-1.5 (Kernel MLflow injection - extends KernelManagerService)
        |
        +-> T-1.6 (Explicit verification)
        +-> T-1.7 (Auto-instrumentation - extends ExecutionBridge)
        +-> T-1.8 (Metrics streaming)
                |
                +-> T-1.12, T-1.13 (Experiments UI)

    T-1.9 (Experiments API - queries MLflow directly)
        |
        +-> T-1.12, T-1.13, T-1.14 (Experiments UI)

    T-1.15 (Sidebar layout - can start early, independent)
        |
        +-> All frontend panels depend on layout infrastructure

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
        +-> T-2.14 (Pipeline panel UI)

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
                +-> T-3.13 (Try It UI)

Phase 4:
    All tasks depend on Phases 1-3 being complete
    T-4.1 through T-4.6 can proceed in parallel
    T-4.7 through T-4.12 depend on their respective backend tasks
```

---

## 9. Risk Mitigation Plan

### 9.1 Technical Risks and Responses

**Risk: pygit2 installation or compatibility issues in the noted container**
- Mitigation: Phase 0 tests pygit2. If problematic, use `subprocess` with the `git` CLI
- Impact: Slightly slower Git operations, but functionally equivalent
- Decision deadline: During T-0.6

**Risk: MLflow auto-instrumentation conflicts with user code**
- Mitigation: Conservative detection logic in ExecutionBridge, explicit back-off, `instrumentation: auto` tag
- Fallback: Disable auto-mode for the affected project; user uses explicit mode

**Risk: Docker Compose resource exhaustion (many containers already running)**
- Mitigation: Set resource limits on all containers. Model-server is on-demand only.
- Monitoring: Add basic resource monitoring (container stats)
- Fallback: Reduce worker count, increase swap, or migrate GPU training to a separate host

**Risk: Airflow worker data access**
- Mitigation: Phase 0 tests both volume mount and DVC pull approaches
- Decision: Volume mount preferred (simpler); DVC pull is the fallback

**Risk: Socket.io event ordering across multiple backend services**
- Mitigation: Include monotonic sequence numbers in events; client reconciles ordering
- Fallback: Accept slight out-of-order events in non-critical displays (activity feed)

**Risk: Kernel session model (one per client) vs project-scoped MLflow context**
- Mitigation: MLflow experiment is project-scoped (env vars injected at kernel start). Multiple kernels in the same project share the same experiment but create separate runs. This is correct MLflow behavior.

### 9.2 Scope Risks

**Risk: Feature creep in individual phases**
- Mitigation: Each phase has explicit exit criteria. A phase is complete when exit criteria are met, not when all "nice to have" features are done

**Risk: Hydra config UI complexity explosion**
- Mitigation: Limit initial support to 3 levels of nesting and standard types (int, float, str, bool, list)
- Deferral: Complex types (custom objects, recursive configs) are out of scope

---

## 10. Verification Approach

### 10.1 Per-Phase Verification

| Phase | Verification Activity                                              |
|-------|--------------------------------------------------------------------|
| 0     | Service connectivity checks, API round-trip tests, DVC round-trip  |
| 1     | Manual end-to-end test: upload data, run training, compare runs    |
| 2     | Manual end-to-end test: configure, trigger pipeline, see results   |
| 3     | Manual end-to-end test: register model, promote, predict           |
| 4     | Full scenario test (Vision Section 6.1), concurrent user test      |

### 10.2 Integration Test Suite (Phase 4)

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

## 11. Open Questions

| # | Question                                                    | Affects        | Proposed Answer                         |
|---|-------------------------------------------------------------|----------------|-----------------------------------------|
| 1 | pygit2 or git subprocess?                                   | Phase 0, 1     | pygit2 preferred; subprocess fallback   |
| 2 | Worker data access: volume mount or DVC pull?               | Phase 0, 2     | Volume mount preferred                  |
| 3 | MLflow metric streaming: polling or kernel-level intercept? | Phase 1        | Start with polling; optimize if needed  |
| 4 | Serving container: one per project or shared pool?          | Phase 3        | One per project with inactivity timeout |
| 5 | GPU inference in serving container?                         | Phase 3        | CPU only initially; GPU as future work  |
| 6 | How to handle notebook-to-script extraction for pipelines?  | Phase 2        | Users maintain src/train.py manually    |
| 7 | Authentication model for multi-user access?                 | All phases     | To be designed separately (currently open access) |
| 8 | AI-assisted instrumentation mode scope?                     | Post-Phase 4   | Separate design document                |
| 9 | How to handle projects with no Hydra config?                | Phase 2        | Config panel shows empty state; pipeline trigger requires at least a minimal config.yaml |
| 10| Docker network topology: single network or bridge?          | Phase 0        | Verify connectivity; adjust if needed   |
| 11| External projects: how does Git/DVC metadata coexist with host-linked notebooks? | Phase 1 | Git/DVC metadata in noted's data dir, notebooks may be symlinked from host |

---

## 12. What This Document Does Not Cover

- Detailed API request/response schemas (to be defined during implementation)
- UI wireframes and visual design (to be produced during development)
- CI/CD pipeline for noted itself (to be defined)
- AI-assisted instrumentation mode (separate document)
- Security and authentication design (separate document - currently open access)
- Cost estimation and resource procurement (separate discussion)
- Team assignment and individual workload (separate discussion)
