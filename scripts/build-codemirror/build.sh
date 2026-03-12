#!/usr/bin/env bash
# Builds the CodeMirror ESM bundle for the noted frontend.
# Run this whenever CodeMirror packages need to be updated or new exports added.
#
# Usage:
#   cd scripts/build-codemirror
#   ./build.sh
#
# Output: frontend/vendor/codemirror/codemirror.bundle.js

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$SCRIPT_DIR/../../frontend/vendor/codemirror/codemirror.bundle.js"

cd "$SCRIPT_DIR"

echo "Installing packages..."
npm install

echo "Bundling..."
npm run build

echo "Done → $OUT"
