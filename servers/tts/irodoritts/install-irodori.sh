#!/usr/bin/env bash
# Patches and installs the IrodoriTTS package from source.
#
# A plain `pip install git+...` fails for two reasons:
#   1. Upstream packaging bugs in pyproject.toml:
#      a. license = "MIT" — must be license = {text = "MIT"} per PEP 621
#      b. configs/ dir at root — setuptools auto-discovery rejects the flat layout
#   2. dacvae (a dependency) is not on PyPI; upstream declares it via [tool.uv.sources]
#      which pip ignores, so it must be pre-installed from GitHub manually.
#
# Commits are pinned for supply-chain safety. To update, replace the SHA constants
# below with the new HEAD SHAs from each repo.
#
# Run with the venv activated from the irodoritts folder.

set -e

# Pinned commits — update these when pulling in upstream changes
IRODORI_COMMIT="2708d3cadf726d4389d25eb4bb7a0344517a9a40"  # Aratako/Irodori-TTS
DACVAE_COMMIT="414c20785fc3a28373073ea8ef7a1316eeeaca6e"   # facebookresearch/dacvae

CLONE_DIR="$(mktemp -d)/Irodori-TTS-patched"

echo "Cloning Irodori-TTS @ $IRODORI_COMMIT..."
git clone --quiet https://github.com/Aratako/Irodori-TTS.git "$CLONE_DIR"
git -C "$CLONE_DIR" checkout --quiet "$IRODORI_COMMIT"

echo "Patching pyproject.toml..."
TOML="$CLONE_DIR/pyproject.toml"

# Fix 1: license bare string → table
sed -i 's/license\s*=\s*"MIT"/license = {text = "MIT"}/' "$TOML"

# Fix 2: restrict package discovery to irodori_tts, excluding configs/
if ! grep -q '\[tool\.setuptools' "$TOML"; then
  printf '\n[tool.setuptools.packages.find]\ninclude = ["irodori_tts*"]\n' >> "$TOML"
fi

echo "Installing dacvae @ $DACVAE_COMMIT (not on PyPI — sourced from GitHub per upstream pyproject.toml)..."
pip install "git+https://github.com/facebookresearch/dacvae@$DACVAE_COMMIT"

echo "Installing irodori-tts..."
pip install "$CLONE_DIR"

echo "irodori-tts installed successfully."
