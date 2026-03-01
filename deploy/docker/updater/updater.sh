#!/usr/bin/env bash
set -euo pipefail

CHECK_INTERVAL_SECONDS="${CHECK_INTERVAL_SECONDS:-120}"
STARTUP_GRACE_SECONDS="${STARTUP_GRACE_SECONDS:-25}"
SUCCESS_LOG_TEXT="${SUCCESS_LOG_TEXT:-⚡️ Mom bot connected and listening!}"

REPO_DIR="/work/repo"
STATE_DIR="/work/state"
GOOD_FILE="$STATE_DIR/good_commit"
NOTICE_FILE="$STATE_DIR/NEEDS_USER_NOTIFICATION.txt"
STACK="$REPO_DIR/deploy/compose.yml"

mkdir -p "$STATE_DIR" "$REPO_DIR"

log() { echo "[$(date -Is)] $*"; }
compose() { docker compose -f "$STACK" "$@"; }

setup_ssh() {
  if [[ -n "${GIT_SSH_PRIVATE_KEY:-}" ]]; then
    mkdir -p /root/.ssh
    chmod 700 /root/.ssh
    printf "%s\n" "$GIT_SSH_PRIVATE_KEY" > /root/.ssh/id_ed25519
    chmod 600 /root/.ssh/id_ed25519
    # Accept GitHub host key to avoid interactive prompt
    ssh-keyscan github.com >> /root/.ssh/known_hosts 2>/dev/null || true
  fi
}

ensure_repo() {
  if [[ ! -d "$REPO_DIR/.git" ]]; then
    log "Cloning $REPO_URL (branch $REPO_BRANCH) into $REPO_DIR..."
    mkdir -p "$REPO_DIR"
    find "$REPO_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    git clone --branch "$REPO_BRANCH" --single-branch "$REPO_URL" "$REPO_DIR"
  fi
}

current_head() { git -C "$REPO_DIR" rev-parse HEAD; }

latest_remote() {
  git -C "$REPO_DIR" fetch origin "$REPO_BRANCH" --quiet
  git -C "$REPO_DIR" rev-parse "origin/$REPO_BRANCH"
}

restart_mom() {
  log "Rebuilding/recreating mom..."
  # Build uses /repo volume in mom container; compose rebuilds mom image and recreates container.
  compose up -d --build --force-recreate mom
}

startup_ok() {
  sleep "$STARTUP_GRACE_SECONDS"
  out="$(docker logs --since=90s mom 2>&1 || true)"
  echo "$out" | grep -Fq "$SUCCESS_LOG_TEXT"
}

record_good() {
  current_head > "$GOOD_FILE"
  log "Recorded good commit: $(cat "$GOOD_FILE")"
}

rollback() {
  if [[ ! -f "$GOOD_FILE" ]]; then
    log "No good commit recorded; cannot rollback."
    return 1
  fi
  good="$(cat "$GOOD_FILE")"
  log "Rolling back to good commit: $good"
  git -C "$REPO_DIR" reset --hard "$good" --quiet
}

notify_hook() {
  bad="${1:-unknown}"
  good="$(cat "$GOOD_FILE" 2>/dev/null || echo unknown)"
  echo "Mom failed startup on $bad; rolled back to $good at $(date -Is)." > "$NOTICE_FILE"
  log "Wrote notification request: $NOTICE_FILE"
}

main() {
  setup_ssh
  ensure_repo

  if [[ ! -f "$GOOD_FILE" ]]; then
    log "Bootstrap: starting mom the first time..."
    restart_mom
    if startup_ok; then
      record_good
    else
      log "Bootstrap failed: success line not found in logs."
      exit 1
    fi
  fi

  while true; do
    head="$(current_head)"
    remote="$(latest_remote)"

    if [[ "$head" != "$remote" ]]; then
      log "New commit found: $head -> $remote"
      git -C "$REPO_DIR" reset --hard "$remote" --quiet

      restart_mom
      if startup_ok; then
        record_good
        rm -f "$NOTICE_FILE" || true
        log "Update succeeded."
      else
        log "Update failed; rolling back."
        rollback || true
        restart_mom || true
        notify_hook "$remote"
      fi
    else
      log "No update."
    fi

    sleep "$CHECK_INTERVAL_SECONDS"
  done
}

main
