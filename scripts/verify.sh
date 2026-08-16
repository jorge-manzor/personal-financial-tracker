#!/usr/bin/env bash
# Verificación mínima para agentes/devs. No requiere API en marcha.
#
# Por defecto: import backend + lint frontend (falla si hay errores ESLint).
# VERIFY_BUILD=1 → ejecuta npm run build
# SKIP_LINT=1    → omite eslint
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

pick_python() {
  if [[ -x "$ROOT/backend/.venv/bin/python" ]]; then
    echo "$ROOT/backend/.venv/bin/python"
  elif [[ -x "$ROOT/backend/.venv/Scripts/python.exe" ]]; then
    echo "$ROOT/backend/.venv/Scripts/python.exe"
  elif command -v python3 >/dev/null 2>&1; then
    command -v python3
  elif command -v python >/dev/null 2>&1; then
    command -v python
  else
    echo "No se encontró python3/python ni backend/.venv" >&2
    exit 1
  fi
}

PY="$(pick_python)"

echo "== backend: import main ($PY) =="
cd "$ROOT/backend"
"$PY" -c "import main; print('ok', main.app.title)"

if [[ "${SKIP_SMOKE:-}" != "1" ]]; then
  if "$PY" -c "import pytest" >/dev/null 2>&1; then
    echo "== backend: smoke pytest =="
    (cd "$ROOT/backend" && PYTHONPATH=. "$PY" -m pytest -q tests/)
  else
    echo "== backend: smoke omitido (pip install -r requirements-dev.txt) =="
  fi
fi

if [[ "${SKIP_LINT:-}" != "1" ]]; then
  echo "== frontend: lint =="
  cd "$ROOT/frontend"
  npm run lint
else
  echo "== frontend: lint omitido (SKIP_LINT=1) =="
fi

if [[ "${SKIP_FRONTEND_TEST:-}" != "1" ]]; then
  echo "== frontend: unit tests =="
  cd "$ROOT/frontend"
  npm test
else
  echo "== frontend: unit tests omitidos (SKIP_FRONTEND_TEST=1) =="
fi

if [[ "${VERIFY_BUILD:-}" == "1" ]]; then
  echo "== frontend: build =="
  cd "$ROOT/frontend"
  npm run build
else
  echo "== frontend: build omitido (VERIFY_BUILD=1 para incluirlo) =="
fi

if curl -sf "http://127.0.0.1:8000/health" >/dev/null 2>&1; then
  echo "== API /health: ok =="
else
  echo "== API /health: no disponible (arranca uvicorn para smoke HTTP) =="
fi

echo "verify: done"
