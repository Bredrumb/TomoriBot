#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="${SCRIPT_DIR}/CosyVoice"
MODEL_DIR="${COSYVOICE3_MODEL_DIR:-${RUNTIME_DIR}/pretrained_models/Fun-CosyVoice3-0.5B}"
MODEL_ID="FunAudioLLM/Fun-CosyVoice3-0.5B-2512"
RUNTIME_REPO="https://github.com/QwenAudio/CosyVoice.git"
# The wrapper depends on this runtime's AutoModel and inference signatures. Bump both pins together after testing.
RUNTIME_COMMIT="074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc"
MODEL_REVISION="29e01c4e8d000f4bcd70751be16fa94bf3d85a18"
PYTHON_BIN="${PYTHON:-python3.10}"
VENV_DIR="${SCRIPT_DIR}/.venv"

if ! command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
  echo "${PYTHON_BIN} was not found. CosyVoice currently recommends Python 3.10." >&2
  exit 1
fi

"${PYTHON_BIN}" - <<'PY'
import sys
if sys.version_info[:2] != (3, 10):
    raise SystemExit(f"Python 3.10 is required by the current CosyVoice setup; found {sys.version.split()[0]}")
PY

if [[ ! -d "${RUNTIME_DIR}/.git" ]]; then
  echo "Cloning the pinned CosyVoice runtime revision ${RUNTIME_COMMIT}..."
  git clone --recursive "${RUNTIME_REPO}" "${RUNTIME_DIR}"
  git -C "${RUNTIME_DIR}" fetch --no-tags origin "${RUNTIME_COMMIT}"
  git -C "${RUNTIME_DIR}" checkout --detach "${RUNTIME_COMMIT}"
else
  if [[ -n "$(git -C "${RUNTIME_DIR}" status --porcelain)" ]]; then
    echo "CosyVoice runtime has local changes. Clean it before reinstalling." >&2
    exit 1
  fi
  if [[ "$(git -C "${RUNTIME_DIR}" rev-parse HEAD)" != "${RUNTIME_COMMIT}" ]]; then
    git -C "${RUNTIME_DIR}" fetch --no-tags origin "${RUNTIME_COMMIT}"
    git -C "${RUNTIME_DIR}" checkout --detach "${RUNTIME_COMMIT}"
  fi
fi
git -C "${RUNTIME_DIR}" submodule sync --recursive
git -C "${RUNTIME_DIR}" submodule update --init --recursive

if ! command -v sox >/dev/null 2>&1; then
  echo "Warning: sox was not found. Upstream recommends installing sox/libsox-dev if audio compatibility issues occur." >&2
fi

"${PYTHON_BIN}" -m venv "${VENV_DIR}"
# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r "${RUNTIME_DIR}/requirements.txt"
python -m pip install -r "${SCRIPT_DIR}/requirements.txt"

python - "${MODEL_ID}" "${MODEL_DIR}" "${MODEL_REVISION}" <<'PY'
from pathlib import Path
import sys
from huggingface_hub import snapshot_download

model_id, model_dir, revision = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
model_dir.parent.mkdir(parents=True, exist_ok=True)
print(f"Downloading {model_id}@{revision} to {model_dir} ...")
snapshot_download(repo_id=model_id, revision=revision, local_dir=str(model_dir))
PY

cat <<EOF

CosyVoice 3 setup complete.

Start only the local server:
  ${VENV_DIR}/bin/python ${SCRIPT_DIR}/server.py

Or start it with TomoriBot from the repository root:
  bun run launch --cosyvoice3

Default endpoint: http://127.0.0.1:8017

Pinned runtime: ${RUNTIME_COMMIT}
Pinned model revision: ${MODEL_REVISION}
EOF
