#!/usr/bin/env bash
# Entrypoint: generate runtime configs for installed Pythons, then start the app.
set -euo pipefail

# Generate runtime.json files into data/runtimes/ (the volume mount)
# Runs every startup so new image builds with new Pythons are auto-detected.
/app/scripts/create_runtime_configs.sh /app/data/runtimes

# Link external notebook directories (if projects.txt exists)
/app/scripts/link_external_projects.sh /app/data/projects.txt

exec "$@"
