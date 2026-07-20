#!/usr/bin/env bash
# Verificación mínima para agentes/devs. No requiere API en marcha.
#
# Por defecto: import backend (obligatorio) + lint frontend (informativo si hay deuda).
# VERIFY_LINT=1  → falla si eslint no está limpio
# VERIFY_BUILD=1 → ejecuta npm run build (falla si build falla)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

pick_python() {
  if [[ -x "$ROOT/backend/.venv/bin/python" ]]; then
    echo "$ROOT/backend/.venv/bin/python"
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
FAILED=0

echo "== backend: import main ($PY) =="
cd "$ROOT/backend"
"$PY" -c "import main; print('ok', main.app.title)"

echo "== frontend: lint =="
cd "$ROOT/frontend"
set +e
npm run lint
LINT_EC=$?
set -e
if [[ "$LINT_EC" -ne 0 ]]; then
  if [[ "${VERIFY_LINT:-}" == "1" ]]; then
    echo "lint: FAIL (VERIFY_LINT=1)" >&2
    FAILED=1
  else
    echo "lint: hay avisos/errores previos; no bloquea (VERIFY_LINT=1 para exigir limpio)"
  fi
fi

if [[ "${VERIFY_BUILD:-}" == "1" ]]; then
  echo "== frontend: build =="
  npm run build
else
  echo "== frontend: build omitido (VERIFY_BUILD=1 para incluirlo) =="
fi

if curl -sf "http://127.0.0.1:8000/health" >/dev/null 2>&1; then
  echo "== API /health: ok =="
else
  echo "== API /health: no disponible (arranca uvicorn para smoke HTTP) =="
fi

if [[ "$FAILED" -ne 0 ]]; then
  echo "verify: FAILED" >&2
  exit 1
fi
echo "verify: done"
