#!/usr/bin/env bash

set -euo pipefail

WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
GIT_COMMON_DIR="$(git rev-parse --git-common-dir)"
SOURCE_REPO_ROOT="$(cd "${GIT_COMMON_DIR}/.." && pwd -P)"
WORKTREE_PORT_FILE="$(git rev-parse --git-path codex-port-range.env)"
PORT_STATE_DIR="${GIT_COMMON_DIR}/codex-local-environment"
NEXT_PORT_FILE="${PORT_STATE_DIR}/next-port"
PORT_LOCK_DIR="${PORT_STATE_DIR}/port-lock"
PORT_LOCK_PID_FILE="${PORT_LOCK_DIR}/pid"
PORT_LOCK_CREATED_AT_FILE="${PORT_LOCK_DIR}/created_at"
PORT_LOCK_PROCESS_STARTED_AT_FILE="${PORT_LOCK_DIR}/process_started_at"

ROOT_NVMRC="${WORKTREE_ROOT}/.nvmrc"
PORT_BLOCK_SIZE=10
DEFAULT_PORT_RANGE_START=3500
MAX_PORT=65535
PORT_LOCK_STALE_SECONDS=30

log_info() {
  printf '%s\n' "$1"
}

log_step() {
  printf '\n--- %s ---\n' "$1"
}

trim_file() {
  tr -d '[:space:]' <"$1"
}

trim_file_edges() {
  sed 's/^[[:space:]]*//; s/[[:space:]]*$//' <"$1"
}

resolve_node_version() {
  if [[ ! -f "${ROOT_NVMRC}" ]]; then
    echo "Missing ${ROOT_NVMRC}" >&2
    exit 1
  fi

  local node_version
  node_version="$(trim_file "${ROOT_NVMRC}")"

  if [[ "${node_version}" =~ ^[0-9] ]]; then
    printf 'v%s\n' "${node_version}"
    return
  fi

  printf '%s\n' "${node_version}"
}

port_cwd() {
  local port="$1"

  if ! command -v lsof >/dev/null 2>&1; then
    return 1
  fi

  local pid
  pid="$(lsof -nP -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if [[ -z "${pid}" ]]; then
    return 1
  fi

  lsof -a -p "${pid}" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

port_in_use() {
  local port="$1"

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi

  if command -v ss >/dev/null 2>&1; then
    ss -ltnH "( sport = :${port} )" 2>/dev/null | grep -q .
    return
  fi

  if command -v netstat >/dev/null 2>&1; then
    netstat -an 2>/dev/null |
      grep -E "[\.:]${port}[[:space:]].*LISTEN" >/dev/null
    return
  fi

  echo "Port collision detection requires lsof, ss, or netstat" >&2
  exit 1
}

port_belongs_to_worktree() {
  local port="$1"
  local cwd

  cwd="$(port_cwd "${port}" || true)"
  if [[ -z "${cwd}" ]]; then
    return 1
  fi

  [[ "${cwd}" == "${WORKTREE_ROOT}" || "${cwd}" == "${WORKTREE_ROOT}"/* ]]
}

port_range_available() {
  local start_port="$1"
  local offset

  for ((offset = 0; offset < PORT_BLOCK_SIZE; offset += 1)); do
    if port_in_use "$((start_port + offset))"; then
      return 1
    fi
  done

  return 0
}

port_range_usable_for_worktree() {
  local start_port="$1"
  local offset

  for ((offset = 0; offset < PORT_BLOCK_SIZE; offset += 1)); do
    local port
    port="$((start_port + offset))"
    if port_in_use "${port}"; then
      if ! command -v lsof >/dev/null 2>&1; then
        echo "Port ${port} is already in use and ownership cannot be determined without lsof; install lsof or free the saved port block ${start_port}" >&2
        return 2
      fi

      if ! port_belongs_to_worktree "${port}"; then
        return 1
      fi
    fi
  done

  return 0
}

is_valid_port() {
  local port="$1"

  [[ "${port}" =~ ^[0-9]+$ ]] || return 1
  ((port >= 1 && port <= MAX_PORT))
}

is_valid_port_block_start() {
  local start_port="$1"

  is_valid_port "${start_port}" || return 1
  ((start_port >= DEFAULT_PORT_RANGE_START)) || return 1
  ((((start_port - DEFAULT_PORT_RANGE_START) % PORT_BLOCK_SIZE) == 0)) || return 1
  (((start_port + PORT_BLOCK_SIZE - 1) <= MAX_PORT))
}

is_valid_service_port_assignment() {
  local app_port="$1"
  local api_port="$2"

  is_valid_port_block_start "${app_port}" || return 1
  is_valid_port "${api_port}" || return 1
  ((api_port == app_port + 1))
}

scan_available_port_block() {
  local start_port="$1"
  local end_port="$2"
  local candidate_port="$1"

  while ((candidate_port <= end_port)); do
    if port_range_available "${candidate_port}"; then
      printf '%s\n' "${candidate_port}"
      return 0
    fi
    candidate_port="$((candidate_port + PORT_BLOCK_SIZE))"
  done

  return 1
}

load_port_assignment() {
  if [[ ! -f "${WORKTREE_PORT_FILE}" ]]; then
    return
  fi

  local line key value
  local uses_legacy_server_port=0

  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -z "${line}" ]] && continue

    if [[ ! "${line}" =~ ^([A-Z_]+)=([0-9]+)$ ]]; then
      echo "Invalid port assignment line in ${WORKTREE_PORT_FILE}: ${line}" >&2
      exit 1
    fi

    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"

    case "${key}" in
    PORT_RANGE_START | APP_PORT | API_PORT)
      printf -v "${key}" '%s' "${value}"
      ;;
    SERVER_PORT)
      API_PORT="${value}"
      uses_legacy_server_port=1
      ;;
    *)
      echo "Unexpected port assignment key in ${WORKTREE_PORT_FILE}: ${key}" >&2
      exit 1
      ;;
    esac
  done <"${WORKTREE_PORT_FILE}"

  if [[ -n "${PORT_RANGE_START:-}" ]] && ! is_valid_port_block_start "${PORT_RANGE_START}"; then
    echo "Invalid PORT_RANGE_START in ${WORKTREE_PORT_FILE}: ${PORT_RANGE_START}" >&2
    exit 1
  fi

  if [[ -n "${APP_PORT:-}" || -n "${API_PORT:-}" ]]; then
    if ! is_valid_service_port_assignment "${APP_PORT:-}" "${API_PORT:-}"; then
      echo "Invalid saved port assignment in ${WORKTREE_PORT_FILE}" >&2
      exit 1
    fi
  fi

  if ((uses_legacy_server_port == 1)) && [[ -n "${APP_PORT:-}" ]] && [[ -n "${API_PORT:-}" ]]; then
    save_port_assignment "${APP_PORT}" "${API_PORT}"
  fi
}

save_port_assignment() {
  local app_port="$1"
  local api_port="$2"

  mkdir -p "$(dirname "${WORKTREE_PORT_FILE}")"
  cat >"${WORKTREE_PORT_FILE}" <<EOF
PORT_RANGE_START=${app_port}
APP_PORT=${app_port}
API_PORT=${api_port}
EOF
}

write_port_lock_metadata() {
  printf '%s\n' "$$" >"${PORT_LOCK_PID_FILE}"
  date +%s >"${PORT_LOCK_CREATED_AT_FILE}"
  ps -p "$$" -o lstart= 2>/dev/null | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' >"${PORT_LOCK_PROCESS_STARTED_AT_FILE}" || true
}

port_lock_age_seconds() {
  # Missing or unreadable metadata → treat as maximally stale so recovery kicks in
  if [[ ! -f "${PORT_LOCK_CREATED_AT_FILE}" ]]; then
    printf '%s\n' "$((PORT_LOCK_STALE_SECONDS + 1))"
    return
  fi

  local created_at now
  created_at="$(trim_file "${PORT_LOCK_CREATED_AT_FILE}")"
  now="$(date +%s)"

  if [[ ! "${created_at}" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$((PORT_LOCK_STALE_SECONDS + 1))"
    return
  fi

  printf '%s\n' "$((now - created_at))"
}

port_lock_is_stale() {
  local age
  age="$(port_lock_age_seconds)"

  if [[ -f "${PORT_LOCK_PID_FILE}" ]]; then
    local lock_pid
    lock_pid="$(trim_file "${PORT_LOCK_PID_FILE}")"
    if [[ "${lock_pid}" =~ ^[0-9]+$ ]] && kill -0 "${lock_pid}" 2>/dev/null; then
      local expected_started_at actual_started_at
      expected_started_at=''
      actual_started_at=''

      if [[ -f "${PORT_LOCK_PROCESS_STARTED_AT_FILE}" ]]; then
        expected_started_at="$(trim_file_edges "${PORT_LOCK_PROCESS_STARTED_AT_FILE}")"
      fi
      actual_started_at="$(ps -p "${lock_pid}" -o lstart= 2>/dev/null | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' || true)"

      # Preserve the live process that created the lock, even if the allocation is slow.
      if [[ -n "${expected_started_at}" && "${actual_started_at}" == "${expected_started_at}" ]]; then
        return 1
      fi

      # If process start-time metadata is unavailable, give a young live lock time to finish.
      if [[ -z "${expected_started_at}" || -z "${actual_started_at}" ]] &&
        ((age < PORT_LOCK_STALE_SECONDS)); then
        return 1
      fi
    fi
    return 0
  fi

  ((age >= PORT_LOCK_STALE_SECONDS))
}

recover_stale_port_lock() {
  if ! port_lock_is_stale; then
    return 1
  fi

  rm -rf "${PORT_LOCK_DIR}"
  log_info "Recovered stale port allocation lock"
  return 0
}

acquire_port_lock() {
  mkdir -p "${PORT_STATE_DIR}"

  local attempt
  for ((attempt = 0; attempt < 200; attempt += 1)); do
    if mkdir "${PORT_LOCK_DIR}" 2>/dev/null; then
      write_port_lock_metadata
      return 0
    fi

    recover_stale_port_lock || true
    sleep 0.1
  done

  echo "Timed out waiting for port allocation lock" >&2
  exit 1
}

release_port_lock() {
  rm -f "${PORT_LOCK_PID_FILE}" "${PORT_LOCK_CREATED_AT_FILE}" "${PORT_LOCK_PROCESS_STARTED_AT_FILE}" 2>/dev/null || true
  rmdir "${PORT_LOCK_DIR}" 2>/dev/null || true
}

allocate_port_range() {
  local saved_assignment_status=0

  load_port_assignment
  if [[ -n "${APP_PORT:-}" ]] && [[ -n "${API_PORT:-}" ]]; then
    port_range_usable_for_worktree "${APP_PORT}" && return
    saved_assignment_status=$?
    if [[ "${saved_assignment_status}" -eq 2 ]]; then
      exit 1
    fi

    log_info "Saved port block starting at ${APP_PORT} is no longer available; allocating a new block"
    unset APP_PORT API_PORT
  fi

  acquire_port_lock
  trap release_port_lock EXIT

  local base_port max_start next_port allocated_port following_port
  base_port="${DEFAULT_PORT_RANGE_START}"
  max_start="$((MAX_PORT - PORT_BLOCK_SIZE + 1))"
  next_port="${base_port}"
  if [[ -f "${NEXT_PORT_FILE}" ]]; then
    next_port="$(trim_file "${NEXT_PORT_FILE}")"
  fi
  if [[ ! "${next_port}" =~ ^[0-9]+$ ]]; then
    next_port="${base_port}"
  fi
  if ! is_valid_port_block_start "${next_port}"; then
    log_info "Next port range start ${next_port} is out of range; restarting scan at ${base_port}"
    next_port="${base_port}"
  fi

  allocated_port="$(scan_available_port_block "${next_port}" "${max_start}" || true)"
  if [[ -z "${allocated_port}" ]] && ((next_port > base_port)); then
    allocated_port="$(scan_available_port_block "${base_port}" "$((next_port - PORT_BLOCK_SIZE))" || true)"
  fi

  if [[ -z "${allocated_port}" ]]; then
    echo "No available ${PORT_BLOCK_SIZE}-port block remains below ${MAX_PORT}" >&2
    exit 1
  fi

  APP_PORT="${allocated_port}"
  API_PORT="$((allocated_port + 1))"
  save_port_assignment "${APP_PORT}" "${API_PORT}"

  following_port="$((allocated_port + PORT_BLOCK_SIZE))"
  if is_valid_port_block_start "${following_port}"; then
    printf '%s\n' "${following_port}" >"${NEXT_PORT_FILE}"
  else
    printf '%s\n' "${base_port}" >"${NEXT_PORT_FILE}"
  fi

  release_port_lock
  trap - EXIT
}

copy_env_files() {
  local copied=0
  local skipped=0

  while IFS= read -r -d '' source_env; do
    local rel_path dest_path
    rel_path="${source_env#"${SOURCE_REPO_ROOT}"/}"
    dest_path="${WORKTREE_ROOT}/${rel_path}"

    if [[ "${source_env}" == "${dest_path}" ]]; then
      continue
    fi

    if [[ -f "${dest_path}" ]]; then
      skipped=$((skipped + 1))
      continue
    fi

    mkdir -p "$(dirname "${dest_path}")"
    cp "${source_env}" "${dest_path}"
    printf 'Copied %s\n' "${rel_path}"
    copied=$((copied + 1))
  done < <(
    find "${SOURCE_REPO_ROOT}" \
      \( -path "${SOURCE_REPO_ROOT}/.git" -o -path "${SOURCE_REPO_ROOT}/.git/*" -o -path '*/node_modules' -o -path '*/node_modules/*' \) -prune \
      -o -type f -name '.env' -print0
  )

  printf 'Copied %d env file(s)\n' "${copied}"
  printf 'Skipped %d existing env file(s)\n' "${skipped}"
}

configure_ports() {
  allocate_port_range

  log_info "Assigned port block starting at ${APP_PORT}"
  log_info "  App: http://localhost:${APP_PORT}"
  log_info "  API: http://localhost:${API_PORT}"
}

log_step "Updating submodules"
if [[ -f "${WORKTREE_ROOT}/.gitmodules" ]]; then
  git submodule update --init --recursive
else
  log_info "No submodules configured"
fi

log_step "Setting up Node.js"
export NVM_DIR="${NVM_DIR:-${HOME}/.nvm}"
if [[ ! -s "${NVM_DIR}/nvm.sh" ]]; then
  echo "nvm is not installed at ${NVM_DIR}/nvm.sh" >&2
  exit 1
fi
# shellcheck source=/dev/null
. "${NVM_DIR}/nvm.sh"

NODE_VERSION="$(resolve_node_version)"
printf 'Using Node.js %s\n' "${NODE_VERSION}"
nvm use "${NODE_VERSION}"
printf 'Using npm %s\n' "$(npm --version)"

log_step "Installing dependencies"
npm ci

log_step "Copying env files"
copy_env_files

log_step "Configuring per-worktree ports"
configure_ports
