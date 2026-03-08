# noted - Integrated MLOps Platform Vision

## Document Information

| Field         | Value                              |
|---------------|------------------------------------|
| Document      | Product Vision                     |
| Project       | noted - Integrated MLOps Platform  |
| Version       | 1.1                                |
| Date          | 2026-03-08                         |
| Status        | Draft                              |
| Changes       | v1.1: Corrected to reflect actual noted architecture (single container, vanilla ES6 frontend, multi-runtime kernels, existing environment management). Incorporated PROJECT_STATUS.md as authoritative source for current capabilities. |

---

## 1. Purpose

This document defines the product vision for **noted** - a collaborative, web-based MLOps platform that evolves from an interactive notebook environment into a unified interface for the full machine learning lifecycle: data management, experimentation, orchestration, tracking, model governance, and deployment.

The vision is grounded in tools and infrastructure that already exist, both as open-source projects and as components already built within the noted application. The goal is integration, not invention.

---

## 2. Problem Statement

Modern MLOps requires practitioners to operate across a fragmented landscape of tools:

- **Data versioning** happens in DVC or ad-hoc file naming
- **Configuration management** lives in scattered YAML files or hardcoded values
- **Experiment tracking** requires switching to the MLflow UI
- **Orchestration** requires switching to the Airflow UI
- **Model serving** requires manual deployment pipelines
- **Object storage** is managed through MinIO console or CLI

Each tool has its own interface, its own authentication model, and its own mental model. Practitioners spend significant time context-switching between browser tabs, terminals, and dashboards. Configuration drift between what was experimented with and what gets deployed is a persistent source of production failures.

There is no unified interface that lets a practitioner go from raw data to deployed model within a single, coherent experience while maintaining full traceability.

---

## 3. Vision Statement

**noted** is a collaborative, web-based platform where ML practitioners interact with their full MLOps stack through a single, integrated interface. It combines the interactive exploration of a notebook environment with production-grade data versioning, experiment tracking, pipeline orchestration, configuration management, and model deployment - all accessible without leaving the application.

The underlying tools (MinIO, DVC, MLflow, Airflow, Hydra) remain the engines. noted is the cockpit.

---

## 4. Target Users

### 4.1 Primary: ML Engineers and Data Scientists

Practitioners who develop, train, evaluate, and deploy machine learning models. They currently work across Jupyter notebooks, terminal commands, and multiple web UIs. They need a single workspace that supports both exploration and production workflows.

### 4.2 Secondary: MLOps / Platform Engineers

Engineers responsible for maintaining the infrastructure. They need visibility into pipeline health, storage utilization, and model registry state. noted gives them a unified dashboard without requiring direct access to each service's admin interface.

### 4.3 Tertiary: Technical Leads and Reviewers

People who need to review experiment results, approve model promotions, or audit the lineage between a dataset version and a production model. They need read access and governance controls without needing to understand the underlying tool APIs.

---

## 5. Core Principles

### 5.1 Integration Over Aggregation

noted is not a dashboard that embeds iframes of other tools' UIs. It is a purpose-built interface that communicates with backend services through their APIs, presenting a unified experience where actions in one domain (e.g., promoting a model) are immediately reflected in others (e.g., the deployment panel).

### 5.2 Backend Services Stay Canonical

MLflow remains the source of truth for experiments and model registry. Airflow remains the source of truth for pipeline execution. MinIO remains the source of truth for object storage. DVC remains the source of truth for data versioning. noted reads from and writes to these services but never duplicates their state into its own database (except for UI metadata like layout preferences).

### 5.3 Progressive Complexity

A new user can open noted, create a notebook, write Python, and execute cells - exactly like Google Colab. As their needs grow, they discover data versioning, experiment tracking, and orchestration features organically. The UI does not front-load complexity.

### 5.4 Explicit Over Magical

When noted performs an action on the user's behalf (e.g., committing a DVC pointer file, triggering an Airflow DAG, logging an MLflow metric), the user can see exactly what happened. No hidden side effects. Automatic instrumentation is opt-in and transparent.

### 5.5 Collaboration as Default

Building on noted's existing collaborative editing foundation (cell-level locking, TTL leases, Socket.io presence), every MLOps feature is designed for multi-user scenarios: shared experiment views, collaborative model review, team-visible pipeline status.

---

## 6. The End-State Experience

The following narrative describes the target user experience when all phases are complete. It is aspirational but architecturally grounded in the tools and integrations defined in this document.

### 6.1 Scenario: Weather Prediction Model Development

**Context:** A team is building time-series forecasting models using the Jena Climate dataset. Two team members are comparing GRU and Transformer architectures.

**Step 1 - Data Ingestion**

A researcher opens the noted workspace and navigates to the Data panel. They drag the raw `jena_climate_2009_2016.csv` file into the upload area. The backend stores the file in MinIO, runs `dvc add` and `dvc push`, and commits the `.dvc` pointer file to the project's backend-managed Git repository. The Data panel shows:

```
data/raw/jena_climate.csv    v1    42MB    uploaded 2 min ago
```

**Step 2 - Preprocessing**

In a notebook cell, the researcher writes a preprocessing pipeline that standardizes features and creates train/test splits. They execute the cell. The backend detects that new files were written to `data/processed/`, runs `dvc add` on them, and the Data panel updates:

```
data/raw/jena_climate.csv       v1    42MB
data/processed/scaled.npz       v1    18MB    derived from raw v1
```

**Step 3 - Configuration**

The researcher opens the Config panel. They see a form generated from the project's Hydra structured configs:

```
Architecture:  [GRU v]        (dropdown: GRU, Transformer)
Hidden Dim:    [128]
Num Layers:    [2]
Learning Rate: [0.001]
Batch Size:    [64]
Epochs:        [50]
```

Selecting "Transformer" from the dropdown dynamically replaces "Hidden Dim" and "Num Layers" with "Attention Heads", "d_model", and "Feedforward Dim."

**Step 4 - Interactive Training**

The researcher clicks "Run" on a training cell. Because auto-tracking is enabled for this project, the backend wraps execution with MLflow context. The Experiments sidebar shows a live-updating chart:

```
Run #14  |  GRU  |  Epoch 23/50  |  MAE: 2.41  |  Running...
```

Metrics update in real-time via Socket.io. The second team member, working in the same project, sees this run appear in their sidebar as well.

**Step 5 - Comparison**

After both team members have completed several runs, they open the Experiments panel and select runs to compare. A comparison view shows overlaid loss curves, final metrics, and the exact Hydra config diff between runs. The data version hash is displayed alongside each run, confirming both used `data/raw v1`.

**Step 6 - Pipeline Execution**

The lead researcher wants to run a full hyperparameter sweep. They switch to "Pipeline" mode, which generates an Airflow DAG from the project's `src/train.py` entry point and the Hydra multirun config. They click "Submit." The Pipeline panel shows a node graph:

```
[Pull Data v1] --> [Validate Config] --> [Train (x12 configs)] --> [Log Results]
     DONE              DONE               8/12 RUNNING             PENDING
```

Task stdout streams into a terminal panel via Socket.io.

**Step 7 - Model Promotion**

The best-performing run (Transformer, 8 heads, MAE: 1.87) is visible in the Experiments panel. The researcher clicks "Register Model" and assigns the alias `@staging`. The Models panel updates:

```
JenaForecaster
  v1   GRU         MAE: 2.41   @archived
  v2   Transformer MAE: 1.87   @staging
```

After review by the team lead, they promote v2 to `@champion`.

**Step 8 - Serving**

The model-serving container detects the new `@champion` alias and hot-loads the model. The "Try It" panel in noted becomes active, showing an input form matching the model's expected schema. The researcher pastes sample weather data and gets a prediction inline.

### 6.2 What This Demonstrates

Every step in this scenario uses a different backend tool, but the user never leaves noted:

| User Action                | Backend Tool          |
|----------------------------|-----------------------|
| Upload dataset             | MinIO + DVC + Git     |
| Configure model            | Hydra                 |
| Run training interactively | Notebook kernel + MLflow |
| Submit pipeline            | Airflow REST API      |
| Compare experiments        | MLflow Tracking API   |
| Promote model              | MLflow Registry API   |
| Test predictions           | FastAPI serving       |
| All real-time updates      | Socket.io             |

---

## 7. Architectural Philosophy

### 7.1 Single Container with Proxy Pattern

noted runs as a **single Docker container** serving both the vanilla ES6 frontend (static files) and the FastAPI backend. This container is the sole intermediary between the browser and all backend services. The frontend never communicates directly with MLflow, Airflow, MinIO, or any other service.

```
[Browser]
    |
    | HTTP + Socket.io
    |
[nginx reverse proxy] (SSL termination)
    |
[noted container]  <-- single process: FastAPI + Uvicorn + Socket.io
    |               serves static frontend files
    |               proxies all backend service calls
    |
    +-- MLflow API
    +-- Airflow REST API
    +-- MinIO S3 API
    +-- DVC Python API
    +-- Hydra Compose API
    +-- Git (libgit2/pygit2)
    +-- jupyter_client (existing kernel management)
```

Benefits:
- Secrets (MinIO keys, Airflow tokens) never reach the browser
- Cross-service operations (e.g., "promote model and trigger deployment") are atomic from the frontend's perspective
- Authentication and authorization are centralized
- Single deployment unit simplifies operations

### 7.2 Event-Driven Communication

Building on the existing Socket.io infrastructure (which already handles cell updates, lock state, kernel status, user presence, and execution output streaming), all new long-running operations push status updates to connected clients:

- Kernel execution output (existing)
- MLflow metric updates during training
- Airflow task state transitions
- DVC push/pull progress
- Model serving readiness changes

No polling. No setTimeout-based synchronization.

### 7.3 Project as the Unit of Organization

Everything revolves around a noted project:

- A project has one Git repository (backend-managed)
- A project has one MLflow Experiment
- A project has one DVC remote configuration
- A project has one Hydra config root
- A project can generate one or more Airflow DAGs
- A project can register one or more models in the MLflow Registry

noted already supports both internal projects (stored in noted's data directory) and external projects (linked from the host via `projects.txt` symlinks). The MLOps features build on this existing project model.

### 7.4 Multi-Runtime Kernel Architecture

noted already supports multiple Python runtimes (3.10, 3.11, 3.12, 3.13, 3.14, including free-threaded variants) with isolated virtual environments per runtime. The MLOps integration leverages this:

- MLflow client is installed as a default dependency in environments used for ML work
- Environment variables (`MLFLOW_TRACKING_URI`, `MLFLOW_EXPERIMENT_NAME`) are injected at kernel startup
- CUDA runtime is already available with `LD_LIBRARY_PATH` injection for GPU-accelerated training
- The existing EnvironmentManager handles package installation with PTY streaming, which extends naturally to installing DVC, Hydra, and other MLOps dependencies

### 7.5 Infrastructure as Docker Compose

All services run as containers alongside the noted container. This is appropriate for the current scale (team-level, single-server deployment). Migration to Kubernetes is architecturally possible but not planned.

Current running infrastructure (already deployed):

```
noted              (FastAPI + static frontend, single container)
mlflow-server      (Tracking + Registry, MLflow 3.x)
airflow-apiserver  (Airflow 3.0 API Server)
airflow-scheduler  (Airflow 3.0)
airflow-worker     (Celery Worker)
airflow-triggerer  (Airflow 3.0)
airflow-dag-processor (Airflow 3.0)
minio              (Object storage)
postgres           (Shared metadata: MLflow + Airflow)
redis              (Airflow Celery broker, Airflow-managed)
nginx              (Reverse proxy, SSL termination)
```

Additional services to be added:

```
model-server       (FastAPI serving, on-demand per project)
```

---

## 8. Integration Boundaries

### 8.1 What noted Owns

- The web UI and all user-facing interactions (vanilla ES6 modules, CodeMirror 6, jsPanel, Wunderbaum, xterm.js)
- The FastAPI backend and all cross-service orchestration logic
- Project lifecycle management (create, configure, archive, external project linking)
- Notebook CRUD and nbformat 4 compatibility (existing NotebookManager)
- Kernel lifecycle management (existing KernelManagerService)
- Socket.io collaboration infrastructure (existing CollaborationManager)
- Environment management (existing EnvironmentManager)
- Backend Git repository management for DVC
- Real-time event distribution via Socket.io (existing ExecutionBridge, extended for MLOps events)

### 8.2 What noted Delegates

| Concern                    | Delegated To        | Interface             |
|----------------------------|---------------------|-----------------------|
| Experiment metrics storage | MLflow              | Tracking API          |
| Model versioning           | MLflow Registry     | Registry API          |
| Object/artifact storage    | MinIO               | S3-compatible API     |
| Data versioning            | DVC                 | Python API + CLI      |
| Pipeline scheduling        | Airflow             | REST API (API Server) |
| Config composition         | Hydra               | Compose API           |
| Config type validation     | OmegaConf           | Structured Configs    |
| Model inference            | FastAPI serving pod  | REST API              |

### 8.3 What noted Does Not Do

- noted does not replace MLflow's tracking database - it reads from it
- noted does not implement its own DAG scheduler - Airflow handles this
- noted does not implement its own object store - MinIO handles this
- noted does not implement Git hosting - it manages bare repos internally
- noted does not manage Kubernetes, cloud deployments, or multi-cluster orchestration
- noted does not provide a general-purpose IDE or file editor beyond notebooks

---

## 9. Differentiation from Existing Tools

| Existing Tool           | What It Does Well                  | What noted Adds                                     |
|-------------------------|------------------------------------|-----------------------------------------------------|
| Google Colab            | Interactive notebooks              | Integrated MLOps lifecycle, collaboration, self-hosted |
| MLflow UI               | Experiment comparison              | Embedded in notebook workflow, live streaming         |
| Airflow UI              | DAG monitoring                     | Triggered from notebook context, inline status        |
| MinIO Console           | Bucket management                  | Data versioning overlay via DVC, project-scoped view  |
| Jupyter Hub             | Multi-user notebooks               | Full MLOps integration, not just kernel management    |
| Kubeflow Pipelines      | K8s-native ML pipelines            | Simpler deployment model, notebook-first experience   |
| Weights & Biases        | Experiment tracking SaaS           | Self-hosted, integrated with orchestration            |

noted's differentiation is not any single feature but the integration: the ability to go from data upload to deployed model within one interface, with full traceability, without requiring the user to understand six different tools' UIs.

---

## 10. MLflow Instrumentation Modes

noted supports three distinct modes for experiment tracking, selectable per project:

### 10.1 Explicit Mode (Default)

The user writes MLflow API calls directly in notebook cells (`mlflow.start_run()`, `mlflow.log_metric()`, etc.). The backend provides environment variables (`MLFLOW_TRACKING_URI`, `MLFLOW_EXPERIMENT_NAME`) and injects run tags (project ID, data version hash, Hydra config hash) but does not modify the user's code.

This mode gives full control and is appropriate for experienced practitioners.

### 10.2 Automatic Mode (Opt-in)

When enabled, the backend wraps cell execution with MLflow context. It detects common ML frameworks (PyTorch, scikit-learn, TensorFlow) in the kernel namespace and activates the corresponding MLflow autologging. Metrics stream to the UI sidebar in real-time.

Auto-mode backs off if it detects that the user has already opened an explicit MLflow run, preventing double-wrapping.

All auto-tracked runs are tagged `instrumentation: auto` for clarity.

### 10.3 AI-Assisted Mode (Future)

An AI agent analyzes notebook code semantically to suggest what metrics, parameters, and artifacts should be tracked. It can propose instrumentation code that the user reviews and accepts before execution.

This mode is documented here for completeness but will be scoped separately.

---

## 11. DVC and Git Strategy

### 11.1 Chosen Approach: Backend-Managed Git Repositories

Each noted project is backed by a bare Git repository, managed entirely by the noted backend. Users never interact with Git directly.

**Rationale:** DVC's full feature set - `dvc repro`, `dvc diff`, pipeline caching, and branching - requires Git. Operating in `--no-scm` mode loses precisely the features that make DVC valuable for reproducibility, which is a core requirement.

### 11.2 How It Works

- When a project is created, the backend initializes a bare Git repo and runs `dvc init`
- Data operations (upload, preprocess) trigger `dvc add` + `dvc push` + `git commit` on the backend
- The UI presents a version list (derived from Git tags or commit history) without exposing Git concepts
- Collaborative conflict resolution (two users modifying the same `.dvc` file) is handled by the backend via a lock-and-merge strategy, leveraging noted's existing cell-level locking patterns

### 11.3 Abstraction Layer

A `ProjectVersionControl` service interface abstracts Git operations. This allows future migration to a different backend (e.g., `--no-scm` mode for lightweight projects) without changing the rest of the stack.

### 11.4 Relationship to External Projects

noted already supports external projects linked from the host filesystem. For external projects, the backend-managed Git repo is still created within noted's data directory - the Git/DVC metadata is noted's concern, while the notebook files may live on the host.

---

## 12. Project Directory Structure

Every noted project follows a standardized layout that accommodates all integrated tools:

```
/data/projects/{project_id}/
    .git/                          # backend-managed, invisible to user
    .dvc/                          # DVC init, config pointing to MinIO remote

    notebooks/                     # interactive exploration (existing)
        experiment_01.ipynb
        experiment_02.ipynb

    src/                           # extractable Python modules
        __init__.py
        model.py
        data_loader.py
        train.py                   # Hydra entry point

    config/                        # Hydra config root
        config.yaml                # defaults list
        model/
            gru.yaml
            transformer.yaml
        data/
            jena.yaml
            custom.yaml
        training/
            default.yaml

    data/
        raw/                       # DVC-tracked, immutable input
            dataset.csv
            dataset.csv.dvc
        processed/                 # DVC-tracked, pipeline outputs
            scaled.npz
            scaled.npz.dvc

    artifacts/                     # MLflow artifact staging (local cache)
        runs/

    pipelines/                     # Airflow DAG definitions (generated)
        dag_{project_id}.py

    outputs/                       # Hydra auto-generated run outputs
        {date}/{time}/
            .hydra/
                config.yaml
                overrides.yaml

    project.json                   # noted metadata
```

Key conventions:
- `notebooks/` is for interactive work; `src/` is for production-grade code
- `config/` follows Hydra's config group directory structure natively
- `data/raw/` is immutable input; `data/processed/` is reproducible output
- `pipelines/` contains generated Airflow DAGs, not user-authored ones
- `outputs/` is owned by Hydra for per-run config snapshots
- Virtual environments are managed by noted's existing EnvironmentManager (per-runtime, shared across projects), not per-project

---

## 13. Existing Backend Managers

noted already has a well-defined set of backend managers. The MLOps integration extends this architecture rather than replacing it:

| Existing Manager          | Responsibility                                    | MLOps Extension                              |
|---------------------------|---------------------------------------------------|----------------------------------------------|
| NotebookManager           | CRUD for projects and .ipynb files                | Extended with DVC-aware data operations      |
| KernelManagerService      | Jupyter kernel lifecycle, idle cleanup             | MLflow env injection at kernel startup       |
| ExecutionBridge           | Socket.io to Jupyter ZMQ message bridge            | MLflow metric streaming, auto-instrumentation hooks |
| CollaborationManager      | Rooms, cell locks, presence, broadcast             | MLOps event broadcasting (runs, pipelines, models) |
| EnvironmentManager        | Runtime-aware venv creation, package ops           | MLflow/DVC/Hydra as default dependencies     |
| ExternalProjectsConfig    | Parses projects.txt at startup                     | Git/DVC metadata for external projects       |

New managers to be added:

| New Manager               | Responsibility                                    |
|---------------------------|---------------------------------------------------|
| ProjectVersionControl     | Git + DVC operations, project-level locking        |
| ConfigComposer            | Hydra compose, validation, schema generation       |
| DAGGenerator              | Airflow DAG file generation from project metadata  |
| PipelineMonitor           | Airflow status polling, Socket.io event forwarding |
| ServingProxy              | Model server lifecycle and request proxying        |
| ActivityFeed              | Cross-service event logging and retrieval          |

---

## 14. Success Criteria

The platform is successful when:

1. A user can complete the full scenario described in Section 6 without leaving noted
2. Every MLflow run has a traceable link to the exact data version (DVC hash) and configuration (Hydra config snapshot) that produced it
3. Pipeline execution via Airflow is triggerable and monitorable from the noted UI with real-time feedback
4. Model promotion from experiment to production serving happens through the noted interface
5. Two or more users can collaborate on the same project simultaneously, seeing each other's experiment results and pipeline status in real-time
6. No user-facing operation requires direct access to MLflow UI, Airflow UI, MinIO Console, or a terminal

---

## 15. What This Document Does Not Cover

- Detailed feature specifications and boundaries (see Scope document)
- Phase sequencing, timelines, and task breakdowns (see Plan document)
- AI-assisted instrumentation mode design (separate document)
- Security model and authentication design (to be defined - currently noted has open access)
- Performance requirements and scaling limits (to be defined)
