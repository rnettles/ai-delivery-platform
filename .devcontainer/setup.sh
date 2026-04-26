#!/usr/bin/env bash
# ================================================================
#  Codespaces / devcontainer setup — ai-delivery-platform
#
#  Clones ai-project_template and dotfiles as siblings (if absent),
#  then syncs the AI dev stack guidance into this project.
# ================================================================
set -euo pipefail

BASE_DIR="$(dirname "$PWD")"
TEMPLATE_DIR="$BASE_DIR/ai-project_template"
DOTFILES_DIR="$BASE_DIR/dotfiles"

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

# ── 2. Clone dotfiles if not present ─────────────────────────────
if [ ! -d "$DOTFILES_DIR/.git" ]; then
    echo "Cloning dotfiles..."
    git clone https://github.com/rnettles/dotfiles.git "$DOTFILES_DIR"
else
    echo "dotfiles already present — pulling latest..."
    git -C "$DOTFILES_DIR" pull --quiet --ff-only || echo "Warning: could not pull; continuing with local version."
fi

# ── 3. Sync agents to ~/.copilot/agents ──────────────────────────
echo ""
echo "Syncing Copilot agents..."
mkdir -p ~/.copilot/agents
for f in "$TEMPLATE_DIR/.github/agents/"*.agent.md; do
    [ -f "$f" ] || continue
    cp -f "$f" ~/.copilot/agents/
    echo "  Synced $(basename "$f")"
done

# ── 4. Sync AI dev stack guidance into this project ──────────────
echo ""
bash "$DOTFILES_DIR/sync-project.sh" "$PWD"

# ── 5. Install Node dependencies ─────────────────────────────────
echo ""
echo "Installing Node.js dependencies..."
npm ci --silent

echo ""
echo "=== Setup complete ==="
