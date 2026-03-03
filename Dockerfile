FROM python:3.12-slim

# System deps for pyzmq and venv creation
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libzmq3-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy application
COPY backend/ backend/
COPY frontend/ frontend/

# Ensure data directories exist
RUN mkdir -p data/projects data/shared_venvs

EXPOSE 8123

CMD ["uvicorn", "app.main:socket_app", "--host", "0.0.0.0", "--port", "8123", "--app-dir", "backend"]
