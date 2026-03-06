# ── Stage 1: Base image with CUDA runtime, Python interpreters, and pip deps ──
# Docker caches this stage. It only rebuilds when these layers change
# (new Python versions, system packages, or requirements.txt updates).
FROM nvidia/cuda:13.1.1-runtime-ubuntu24.04 AS base

ENV DEBIAN_FRONTEND=noninteractive

# System packages + deadsnakes PPA for multiple Python versions
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        software-properties-common gpg-agent && \
    add-apt-repository -y ppa:deadsnakes/ppa && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        # Python interpreters (latest patch auto-resolved by deadsnakes)
        python3.10 python3.10-venv python3.10-dev \
        python3.11 python3.11-venv python3.11-dev \
        python3.12 python3.12-venv python3.12-dev \
        python3.13 python3.13-venv python3.13-dev \
        python3.13-nogil \
        python3.14 python3.14-venv python3.14-dev \
        python3.14-nogil \
        # Build deps for native extensions (pyzmq, etc.)
        gcc g++ libzmq3-dev \
        # pip bootstrap
        python3-pip \
        # curl for health checks
        curl && \
    rm -rf /var/lib/apt/lists/*

# Ensure pip is available for each Python version
RUN for py in python3.10 python3.11 python3.12 python3.13 python3.14; do \
        $py -m ensurepip --upgrade 2>/dev/null || true; \
    done

WORKDIR /app

# Install Python dependencies (using system Python 3.12)
COPY backend/requirements.txt backend/requirements.txt
RUN python3.12 -m pip install --no-cache-dir --break-system-packages \
    -r backend/requirements.txt

# ── Stage 2: App image — copies application code onto the cached base ──
# Fast rebuild (~1s) on every code change.
FROM base

WORKDIR /app

COPY backend/ backend/
COPY frontend/ frontend/
COPY scripts/ scripts/

RUN chmod +x scripts/*.sh

# Ensure data directories exist
RUN mkdir -p data/projects data/environments

EXPOSE 8123

ENTRYPOINT ["scripts/entrypoint.sh"]
CMD ["uvicorn", "app.main:socket_app", "--host", "0.0.0.0", "--port", "8123", "--app-dir", "backend"]
