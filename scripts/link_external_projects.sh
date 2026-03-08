#!/usr/bin/env bash
# Link external notebook directories into noted's project structure.
#
# Reads data/projects.txt (INI-style) and creates symlinks so noted
# can see notebooks from mounted host directories.
#
# Format:
#   [Project Name]
#   /container/path/to/notebooks
#   /another/path/with/notebooks/*
#
#   [Another Project]
#   /workspace/research
#
# Paths ending with /* are scanned recursively (all subdirectories).
# Plain paths scan only the immediate directory.
#
# Lines starting with # are comments. Empty lines are ignored.
# Paths are container-internal (mount host dirs first via docker -v).
#
# On each run:
#   1. Removes all stale symlinks in project notebooks/ directories
#   2. Creates fresh symlinks from the current config
#   3. Real (non-symlink) files are never touched

set -euo pipefail

CONF="${1:-/app/data/projects.txt}"
PROJECTS_DIR="/app/data/projects"

if [ ! -f "$CONF" ]; then
    exit 0
fi

echo "Reading external projects from $CONF"

# ── Phase 1: Collect project names from config ──────────────────────
declare -A config_projects
current_project=""

while IFS= read -r line || [ -n "$line" ]; do
    line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [ -z "$line" ] && continue
    [[ "$line" == \#* ]] && continue
    if [[ "$line" =~ ^\[(.+)\]$ ]]; then
        current_project="${BASH_REMATCH[1]}"
        config_projects["$current_project"]=1
    fi
done < "$CONF"

# ── Phase 2: Clean up stale symlinks in all project notebooks/ dirs ─
for nb_dir in "$PROJECTS_DIR"/*/notebooks; do
    [ -d "$nb_dir" ] || continue
    find "$nb_dir" -maxdepth 1 -type l 2>/dev/null | while read -r link; do
        if [ ! -e "$link" ]; then
            echo "Removing stale symlink: $link"
            rm -f "$link"
        fi
    done
done

# ── Phase 3: Create symlinks from config ────────────────────────────
current_project=""

while IFS= read -r line || [ -n "$line" ]; do
    line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [ -z "$line" ] && continue
    [[ "$line" == \#* ]] && continue

    # Section header: [Project Name]
    if [[ "$line" =~ ^\[(.+)\]$ ]]; then
        current_project="${BASH_REMATCH[1]}"
        continue
    fi

    # Path line — must be inside a section
    if [ -z "$current_project" ]; then
        echo "WARNING: path '$line' outside of a [Project] section, skipping" >&2
        continue
    fi

    src_path="$line"
    recursive=false

    # Detect trailing /* for recursive scanning
    if [[ "$src_path" == *"/\*" ]] || [[ "$src_path" == *"/*" ]]; then
        src_path="${src_path%/\*}"
        src_path="${src_path%/*}"
        recursive=true
    fi

    # Validate source path exists
    if [ ! -d "$src_path" ]; then
        echo "WARNING: [$current_project] path '$src_path' not found, skipping" >&2
        continue
    fi

    # Create the project's notebooks directory
    nb_dir="$PROJECTS_DIR/$current_project/notebooks"
    mkdir -p "$nb_dir"

    # Symlink .ipynb files (recursive or root-only based on /* suffix)
    find_args=("$src_path" -name "*.ipynb" -type f)
    if [ "$recursive" = false ]; then
        find_args=("$src_path" -maxdepth 1 -name "*.ipynb" -type f)
    fi
    find "${find_args[@]}" 2>/dev/null | while read -r ipynb; do
        fname="$(basename "$ipynb")"
        target="$nb_dir/$fname"

        # Skip if a real file (not symlink) already exists with this name
        if [ -e "$target" ] && [ ! -L "$target" ]; then
            echo "  Skipping $fname (real file exists, not overwriting)"
            continue
        fi

        # Create or update symlink
        ln -sf "$ipynb" "$target"
    done

    if [ "$recursive" = true ]; then
        echo "Linked: [$current_project] <- $src_path (recursive)"
    else
        echo "Linked: [$current_project] <- $src_path"
    fi

done < "$CONF"

echo "External project linking complete."
