#!/usr/bin/env bash
# ================================================================
#  Codespaces / devcontainer setup — ai-delivery-platform
#
#  Clones ai-project_template as a sibling (if absent),
#  then syncs the AI dev stack guidance into this project.
# ================================================================
set -euo pipefail

BASE_DIR="$(dirname "$PWD")"
TEMPLATE_DIR="$BASE_DIR/ai-project_template"

echo "=== Codespaces setup for ai-delivery-platform ==="
echo ""

# ── 1. Clone ai-project_template if not present ──────────────────
if [ ! -d "$TEMPLATE_DIR/.git" ]; then
    echo "Cloning ai-project_template..."
    git clone https://github.com/rnettles/ai-project_template.git "$TEMPLATE_DIR"
else
    echo "ai-project_template already present — pulling latest..."
    git -C "$TEMPLATE_DIR" pull --quiet --ff-only || echo "Warning: could not pull; continuing with local version."
fi

# ── 2. Sync agents to ~/.copilot/agents ──────────────────────────
echo ""
echo "Syncing Copilot agents..."
mkdir -p ~/.copilot/agents
for f in "$TEMPLATE_DIR/.github/agents/"*.agent.md; do
    [ -f "$f" ] || continue
    cp -f "$f" ~/.copilot/agents/
    echo "  Synced $(basename "$f")"
done

# ── 3. Sync AI dev stack guidance into this project ──────────────
echo ""
bash "$TEMPLATE_DIR/install/sync-project.sh" "$PWD"

# ── 4. Install Node dependencies ─────────────────────────────────
echo ""
echo "Installing Node.js dependencies..."
npm ci --silent

echo ""
echo "=== Setup complete ==="
