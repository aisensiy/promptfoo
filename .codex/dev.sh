#!/usr/bin/env bash

set -euo pipefail

WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_PORT_FILE="$(git rev-parse --git-path codex-port-range.env)"
CONCURRENTLY_BIN="${WORKTREE_ROOT}/node_modules/.bin/concurrently"

APP_PORT=3000
API_PORT=15500

export NVM_DIR="${NVM_DIR:-${HOME}/.nvm}"
if [[ ! -s "${NVM_DIR}/nvm.sh" ]]; then
  echo "nvm is not installed at ${NVM_DIR}/nvm.sh" >&2
  exit 1
fi
# shellcheck source=/dev/null
. "${NVM_DIR}/nvm.sh"
nvm use "$(tr -d '[:space:]' < "${WORKTREE_ROOT}/.nvmrc")"

if [[ -f "${WORKTREE_PORT_FILE}" ]]; then
  # shellcheck source=/dev/null
  . "${WORKTREE_PORT_FILE}"
fi

if [[ ! "${APP_PORT}" =~ ^[0-9]+$ ]] || [[ ! "${API_PORT}" =~ ^[0-9]+$ ]]; then
  echo "Invalid app/API port assignment in ${WORKTREE_PORT_FILE}" >&2
  exit 1
fi

if [[ ! -x "${CONCURRENTLY_BIN}" ]]; then
  echo "Missing ${CONCURRENTLY_BIN}; run .codex/setup.sh first" >&2
  exit 1
fi

export API_PORT

printf 'Starting Promptfoo app on http://localhost:%s\n' "${APP_PORT}"
printf 'Starting Promptfoo API on http://localhost:%s\n' "${API_PORT}"

exec "${CONCURRENTLY_BIN}" -g --kill-others-on-fail \
  "npm run dev:server" \
  "npm --prefix src/app run dev -- --port ${APP_PORT} --strictPort"
