#!/usr/bin/env bash
# learn-datalake: user-facing continuous datalake learner
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
WATCHDOG_DIR="$SCRIPT_DIR/state/watchdogs"
DEFAULT_ROOT="/mnt/storage12tb/extractor_corpus"

if ! command -v uv &>/dev/null; then
    echo "ERROR: uv not found. Install with: curl -LsSf https://astral.sh/uv/install.sh | sh"
    exit 1
fi

mkdir -p "$WATCHDOG_DIR"

_collect_pids() {
    local pattern="$1"
    pgrep -f "$pattern" 2>/dev/null || true
}

_supervisor_pattern() {
    local label="$1"
    echo "[s]upervise_learn_datalake.py .*--label ${label}([[:space:]]|$)"
}

_monitor_pattern() {
    local label="$1"
    echo "[m]onitor_supervisor.sh --label ${label}([[:space:]]|$)"
}

_learn_pattern_for_root() {
    local root="$1"
    echo "[l]earn_datalake.py start ${root}([[:space:]]|$)"
}

_verify_pattern_for_root() {
    local root="$1"
    echo "[v]erify.py loop ${root}([[:space:]]|$)"
}

_root_for_label() {
    local label="$1"
    local state_file="$WATCHDOG_DIR/supervisor_${label}.json"
    if [[ -f "$state_file" ]]; then
        jq -r '.root // empty' "$state_file" 2>/dev/null || true
    fi
}

_start_monitor() {
    local label="$1"
    local interval_seconds="$2"
    local monitor_log="$WATCHDOG_DIR/monitor_${label}.log"
    local report_path="$WATCHDOG_DIR/monitor_${label}_report.txt"
    local pattern
    pattern="$(_monitor_pattern "$label")"

    mapfile -t running_pids < <(_collect_pids "$pattern")
    if [[ ${#running_pids[@]} -gt 0 ]]; then
        echo "monitor_status=already_running label=$label pids=$(IFS=,; echo "${running_pids[*]}") report=$report_path"
        return 0
    fi

    setsid -f "$SCRIPT_DIR/monitor_supervisor.sh" \
        --label "$label" \
        --interval-seconds "$interval_seconds" \
        --report-path "$report_path" \
        >"$monitor_log" 2>&1 < /dev/null
    sleep 1

    mapfile -t started_pids < <(_collect_pids "$pattern")
    if [[ ${#started_pids[@]} -eq 0 ]]; then
        echo "ERROR: monitor failed to start label=$label log=$monitor_log"
        return 1
    fi
    echo "monitor_status=started label=$label pids=$(IFS=,; echo "${started_pids[*]}") report=$report_path log=$monitor_log"
}

_stop_monitor() {
    local label="$1"
    local pattern
    pattern="$(_monitor_pattern "$label")"
    mapfile -t pids < <(_collect_pids "$pattern")
    if [[ ${#pids[@]} -eq 0 ]]; then
        echo "monitor_status=not_running label=$label"
        return 0
    fi
    for pid in "${pids[@]}"; do
        kill "$pid" >/dev/null 2>&1 || true
    done
    sleep 1
    mapfile -t remaining < <(_collect_pids "$pattern")
    if [[ ${#remaining[@]} -gt 0 ]]; then
        for pid in "${remaining[@]}"; do
            kill -9 "$pid" >/dev/null 2>&1 || true
        done
    fi
    echo "monitor_status=stopped label=$label"
}

_start_supervised() {
    local root="$DEFAULT_ROOT"
    local label="corpus"
    local monitor_interval_seconds="60"
    local -a extra=()

    if [[ "${1:-}" != "" ]] && [[ "${1:0:2}" != "--" ]]; then
        root="$1"
        shift
    fi
    while [[ $# -gt 0 ]]; do
        case "$1" in
        --label)
            label="$2"
            shift 2
            ;;
        --monitor-interval-seconds)
            monitor_interval_seconds="$2"
            shift 2
            ;;
        *)
            extra+=("$1")
            shift
            ;;
        esac
    done

    local stop_file="$WATCHDOG_DIR/STOP_${label}"
    local supervisor_console_log="$WATCHDOG_DIR/supervisor_${label}_console.log"
    local pattern
    pattern="$(_supervisor_pattern "$label")"
    rm -f "$stop_file"

    mapfile -t existing_pids < <(_collect_pids "$pattern")
    if [[ ${#existing_pids[@]} -gt 0 ]]; then
        echo "supervisor_status=already_running label=$label pids=$(IFS=,; echo "${existing_pids[*]}")"
        _start_monitor "$label" "$monitor_interval_seconds"
        return 0
    fi

    # If a prior unsupervised child tree exists for this root, clear it first.
    local learn_pattern verify_pattern
    learn_pattern="$(_learn_pattern_for_root "$root")"
    verify_pattern="$(_verify_pattern_for_root "$root")"
    mapfile -t orphan_learn < <(_collect_pids "$learn_pattern")
    mapfile -t orphan_verify < <(_collect_pids "$verify_pattern")
    if [[ ${#orphan_learn[@]} -gt 0 ]] || [[ ${#orphan_verify[@]} -gt 0 ]]; then
        for pid in "${orphan_verify[@]}"; do
            kill "$pid" >/dev/null 2>&1 || true
        done
        for pid in "${orphan_learn[@]}"; do
            kill "$pid" >/dev/null 2>&1 || true
        done
        sleep 1
        mapfile -t orphan_verify < <(_collect_pids "$verify_pattern")
        mapfile -t orphan_learn < <(_collect_pids "$learn_pattern")
        for pid in "${orphan_verify[@]}"; do
            kill -9 "$pid" >/dev/null 2>&1 || true
        done
        for pid in "${orphan_learn[@]}"; do
            kill -9 "$pid" >/dev/null 2>&1 || true
        done
    fi

    setsid -f uv run --script supervise_learn_datalake.py \
        "$root" \
        --label "$label" \
        "${extra[@]}" \
        >"$supervisor_console_log" 2>&1 < /dev/null
    sleep 1

    mapfile -t started_pids < <(_collect_pids "$pattern")
    if [[ ${#started_pids[@]} -eq 0 ]]; then
        echo "ERROR: supervisor failed to start label=$label log=$supervisor_console_log"
        return 1
    fi
    echo "supervisor_status=started label=$label pids=$(IFS=,; echo "${started_pids[*]}") root=$root log=$supervisor_console_log"
    _start_monitor "$label" "$monitor_interval_seconds"
}

_stop_supervised() {
    local label="corpus"
    local root=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
        --label)
            label="$2"
            shift 2
            ;;
        --root)
            root="$2"
            shift 2
            ;;
        *)
            echo "ERROR: unknown option for stop-supervised: $1"
            return 2
            ;;
        esac
    done

    local stop_file="$WATCHDOG_DIR/STOP_${label}"
    local pattern
    pattern="$(_supervisor_pattern "$label")"
    if [[ -z "$root" ]]; then
        root="$(_root_for_label "$label")"
    fi
    if [[ -z "$root" ]]; then
        root="$DEFAULT_ROOT"
    fi
    touch "$stop_file"
    echo "stop_file=created path=$stop_file"

    for _ in {1..20}; do
        mapfile -t pids < <(_collect_pids "$pattern")
        if [[ ${#pids[@]} -eq 0 ]]; then
            break
        fi
        sleep 2
    done

    mapfile -t remaining < <(_collect_pids "$pattern")
    if [[ ${#remaining[@]} -gt 0 ]]; then
        for pid in "${remaining[@]}"; do
            kill "$pid" >/dev/null 2>&1 || true
        done
        sleep 1
        mapfile -t remaining < <(_collect_pids "$pattern")
        if [[ ${#remaining[@]} -gt 0 ]]; then
            for pid in "${remaining[@]}"; do
                kill -9 "$pid" >/dev/null 2>&1 || true
            done
        fi
    fi

    # Always prune stale child trees for this root.
    local learn_pattern verify_pattern
    learn_pattern="$(_learn_pattern_for_root "$root")"
    verify_pattern="$(_verify_pattern_for_root "$root")"
    mapfile -t orphan_verify < <(_collect_pids "$verify_pattern")
    mapfile -t orphan_learn < <(_collect_pids "$learn_pattern")
    for pid in "${orphan_verify[@]}"; do
        kill "$pid" >/dev/null 2>&1 || true
    done
    for pid in "${orphan_learn[@]}"; do
        kill "$pid" >/dev/null 2>&1 || true
    done
    sleep 1
    mapfile -t orphan_verify < <(_collect_pids "$verify_pattern")
    mapfile -t orphan_learn < <(_collect_pids "$learn_pattern")
    for pid in "${orphan_verify[@]}"; do
        kill -9 "$pid" >/dev/null 2>&1 || true
    done
    for pid in "${orphan_learn[@]}"; do
        kill -9 "$pid" >/dev/null 2>&1 || true
    done

    rm -f "$stop_file"
    _stop_monitor "$label"
    echo "supervisor_status=stopped label=$label"
}

_status_supervised() {
    local label="corpus"
    local show_table="no"
    while [[ $# -gt 0 ]]; do
        case "$1" in
        --label)
            label="$2"
            shift 2
            ;;
        --table)
            show_table="yes"
            shift
            ;;
        *)
            echo "ERROR: unknown option for status-supervised: $1"
            return 2
            ;;
        esac
    done

    local state_file="$WATCHDOG_DIR/supervisor_${label}.json"
    local report_file="$WATCHDOG_DIR/monitor_${label}_report.txt"
    local stop_file="$WATCHDOG_DIR/STOP_${label}"
    local run_log=""
    local supervisor_status="no"
    local monitor_status="no"
    local learn_status="no"
    local verify_status="no"
    local stop_status="no"
    local state_status="unknown"
    local state_run_id="unknown"
    local state_updated_at="unknown"
    local state_heartbeat_fresh="false"
    local state_heartbeat_age="unknown"
    local state_restart_count="0"
    local state_run_count="0"
    local state_timeout_rate_pct="0.00"
    local state_fail_rate_pct="0.00"
    local state_throughput_per_hour="0.00"
    local state_rolling_docs_analyzed="0"
    local state_rolling_score="n/a"
    local state_rolling_fail_ratio="n/a"
    local state_rolling_critical_pct="0.00"
    local state_documents_missing_ratio_pct="0.00"
    local state_phase="unknown"
    local state_quality_gate_action="n/a"
    local state_quality_gate_reason="n/a"
    local state_quality_gate_consecutive_failures="0"
    local state_adaptive_watchdog_seconds="0"
    local state_adaptive_heartbeat_timeout_seconds="0"
    local state_recent_failed_pdf_count="0"
    local corpus_pdf_count="0"
    local corpus_profile_count="0"
    local extracted_pdf_count="0"
    local missing_pdf_count="0"
    local extracted_pdf_coverage_pct="0.00"
    local discovered_profiles="0"
    local scanned_max="0"
    local new_extractions="0"
    local last_extracted_pdf="n/a"
    local root
    root="$(_root_for_label "$label")"
    if [[ -z "$root" ]]; then
        root="$DEFAULT_ROOT"
    fi
    local supervisor_pattern monitor_pattern learn_pattern verify_pattern
    supervisor_pattern="$(_supervisor_pattern "$label")"
    monitor_pattern="$(_monitor_pattern "$label")"
    learn_pattern="$(_learn_pattern_for_root "$root")"
    verify_pattern="$(_verify_pattern_for_root "$root")"

    mapfile -t supervisor_pids < <(_collect_pids "$supervisor_pattern")
    mapfile -t monitor_pids < <(_collect_pids "$monitor_pattern")
    mapfile -t learn_pids < <(_collect_pids "$learn_pattern")
    mapfile -t verify_pids < <(_collect_pids "$verify_pattern")

    echo "label=$label"
    if [[ ${#supervisor_pids[@]} -gt 0 ]]; then
        supervisor_status="yes"
        echo "supervisor_running=yes pids=$(IFS=,; echo "${supervisor_pids[*]}")"
    else
        echo "supervisor_running=no pids=none"
    fi
    if [[ ${#monitor_pids[@]} -gt 0 ]]; then
        monitor_status="yes"
        echo "monitor_running=yes pids=$(IFS=,; echo "${monitor_pids[*]}")"
    else
        echo "monitor_running=no pids=none"
    fi
    if [[ ${#learn_pids[@]} -gt 0 ]]; then
        learn_status="yes"
        echo "learn_loop_running=yes pids=$(IFS=,; echo "${learn_pids[*]}")"
    else
        echo "learn_loop_running=no pids=none"
    fi
    if [[ ${#verify_pids[@]} -gt 0 ]]; then
        verify_status="yes"
        echo "verify_loop_running=yes pids=$(IFS=,; echo "${verify_pids[*]}")"
    else
        echo "verify_loop_running=no pids=none"
    fi
    stop_status="$([[ -f "$stop_file" ]] && echo yes || echo no)"
    echo "stop_file_present=$([[ -f "$stop_file" ]] && echo yes || echo no) path=$stop_file"
    if [[ -f "$state_file" ]]; then
        state_status="$(jq -r '.status // "unknown"' "$state_file" 2>/dev/null || echo unknown)"
        state_run_id="$(jq -r '.run_id // "unknown"' "$state_file" 2>/dev/null || echo unknown)"
        state_updated_at="$(jq -r '.updated_at // "unknown"' "$state_file" 2>/dev/null || echo unknown)"
        state_heartbeat_fresh="$(jq -r '.review_heartbeat_fresh // false' "$state_file" 2>/dev/null || echo false)"
        state_heartbeat_age="$(jq -r '.review_heartbeat_age_seconds // "unknown"' "$state_file" 2>/dev/null || echo unknown)"
        state_restart_count="$(jq -r '.restart_count // 0' "$state_file" 2>/dev/null || echo 0)"
        state_run_count="$(jq -r '.run_count // 0' "$state_file" 2>/dev/null || echo 0)"
        state_timeout_rate_pct="$(jq -r '.run_metrics.extraction_timeout_rate_pct // .extraction_timeout_rate_pct // 0' "$state_file" 2>/dev/null || echo 0)"
        state_fail_rate_pct="$(jq -r '.run_metrics.extraction_fail_rate_pct // .extraction_fail_rate_pct // 0' "$state_file" 2>/dev/null || echo 0)"
        state_throughput_per_hour="$(jq -r '.run_metrics.extraction_throughput_per_hour // .extraction_throughput_per_hour // 0' "$state_file" 2>/dev/null || echo 0)"
        state_rolling_docs_analyzed="$(jq -r '.run_metrics.rolling_docs_analyzed // .rolling_docs_analyzed // 0' "$state_file" 2>/dev/null || echo 0)"
        state_rolling_score="$(jq -r '.run_metrics.rolling_avg_score // .rolling_avg_score // "n/a"' "$state_file" 2>/dev/null || echo n/a)"
        state_rolling_fail_ratio="$(jq -r '.run_metrics.rolling_fail_ratio // .rolling_fail_ratio // "n/a"' "$state_file" 2>/dev/null || echo n/a)"
        state_rolling_critical_pct="$(
            jq -r '
                if (.run_metrics.rolling_critical_doc_ratio // .rolling_critical_doc_ratio) == null
                then 0
                else ((.run_metrics.rolling_critical_doc_ratio // .rolling_critical_doc_ratio) * 100)
                end
            ' "$state_file" 2>/dev/null || echo 0
        )"
        state_documents_missing_ratio_pct="$(
            jq -r '
                if (.run_metrics.documents_missing_ratio // .documents_missing_ratio) == null
                then 0
                else ((.run_metrics.documents_missing_ratio // .documents_missing_ratio) * 100)
                end
            ' "$state_file" 2>/dev/null || echo 0
        )"
        state_phase="$(jq -r '.run_metrics.phase // .phase // "unknown"' "$state_file" 2>/dev/null || echo unknown)"
        state_quality_gate_action="$(jq -r '.run_metrics.quality_gate_action // .quality_gate_action // "n/a"' "$state_file" 2>/dev/null || echo n/a)"
        state_quality_gate_reason="$(jq -r '.run_metrics.quality_gate_reason // .quality_gate_reason // "n/a"' "$state_file" 2>/dev/null || echo n/a)"
        state_quality_gate_consecutive_failures="$(jq -r '.run_metrics.quality_gate_consecutive_failures // .quality_gate_consecutive_failures // 0' "$state_file" 2>/dev/null || echo 0)"
        state_adaptive_watchdog_seconds="$(jq -r '.run_metrics.recommended_watchdog_seconds // .recommended_watchdog_seconds // 0' "$state_file" 2>/dev/null || echo 0)"
        state_adaptive_heartbeat_timeout_seconds="$(jq -r '.run_metrics.adaptive_heartbeat_timeout_seconds // .adaptive_heartbeat_timeout_seconds // 0' "$state_file" 2>/dev/null || echo 0)"
        state_recent_failed_pdf_count="$(jq -r '.run_metrics.recent_failed_pdf_count // .recent_failed_pdf_count // 0' "$state_file" 2>/dev/null || echo 0)"
        run_log="$(jq -r '.run_log // .last_run_log // ""' "$state_file" 2>/dev/null || true)"
        jq '{status,run_id,updated_at,review_heartbeat_fresh,review_heartbeat_age_seconds,child_pid,restart_count,run_count,failure_buckets}' "$state_file"
    else
        echo "state_file_missing=$state_file"
    fi
    if [[ -n "$root" ]] && [[ -d "$root" ]]; then
        corpus_pdf_count="$(fd -e pdf . "$root" 2>/dev/null | wc -l | tr -d ' ')"
        corpus_profile_count="$(fd -p '00_profile_detector/profile.json' "$root" 2>/dev/null | wc -l | tr -d ' ')"
        extracted_pdf_count="$(
            fd -0 -p '00_profile_detector/profile.json' "$root" 2>/dev/null | \
                xargs -0 -r jq -r '.file // empty' 2>/dev/null | \
                rg -i '\.pdf$' | \
                sort -u | \
                wc -l | \
                tr -d ' '
        )"
        if [[ -z "$extracted_pdf_count" ]]; then
            extracted_pdf_count="0"
        fi
        if [[ "$corpus_pdf_count" =~ ^[0-9]+$ ]] && [[ "$extracted_pdf_count" =~ ^[0-9]+$ ]]; then
            if (( extracted_pdf_count > corpus_pdf_count )); then
                extracted_pdf_count="$corpus_pdf_count"
            fi
            missing_pdf_count="$((corpus_pdf_count - extracted_pdf_count))"
            if (( corpus_pdf_count > 0 )); then
                extracted_pdf_coverage_pct="$(awk "BEGIN { printf \"%.2f\", (100 * $extracted_pdf_count) / $corpus_pdf_count }")"
            fi
        fi
        echo "corpus_pdf_count=$corpus_pdf_count"
        echo "corpus_profile_count=$corpus_profile_count"
        echo "extracted_pdf_count=$extracted_pdf_count"
        echo "missing_pdf_count=$missing_pdf_count"
        echo "extracted_pdf_coverage_pct=$extracted_pdf_coverage_pct"
    fi
    if [[ -n "$run_log" ]] && [[ -f "$run_log" ]]; then
        discovered_profiles="$(rg -o 'discovered_profiles count=[0-9]+' "$run_log" | tail -n 1 | rg -o '[0-9]+' | head -n 1 || true)"
        scanned_max="$(rg -o 'discover_progress scanned=[0-9]+' "$run_log" | rg -o '[0-9]+' | sort -n | tail -n 1 || true)"
        new_extractions="$(rg -o 'extract_missing status=extracted new_count=[0-9]+' "$run_log" | tail -n 1 | rg -o '[0-9]+$' | head -n 1 || true)"
        last_extracted_pdf="$(rg -o 'extract_missing status=extracted new_count=[0-9]+ pdf=.*' "$run_log" | tail -n 1 | sed -E 's/^.* pdf=//' || true)"
        echo "run_log=$run_log"
        echo "run_discovered_profiles_count=${discovered_profiles:-0}"
        echo "run_scanned_max=${scanned_max:-0}"
        echo "run_new_extractions=${new_extractions:-0}"
        if [[ -n "$last_extracted_pdf" ]]; then
            echo "run_last_extracted_pdf=$last_extracted_pdf"
        fi
    fi
    if [[ -f "$report_file" ]]; then
        echo "monitor_report=$report_file"
        head -n 20 "$report_file"
    fi
    if [[ "$show_table" == "yes" ]]; then
        _row() {
            local k="$1"
            local v="$2"
            v="${v//$'\n'/ }"
            printf '| %-30s | %-56.56s |\n' "$k" "$v"
        }
        local border
        border='+--------------------------------+----------------------------------------------------------+'
        echo "$border"
        _row "metric" "value"
        echo "$border"
        _row "label" "$label"
        _row "supervisor_running" "$supervisor_status"
        _row "monitor_running" "$monitor_status"
        _row "learn_loop_running" "$learn_status"
        _row "verify_loop_running" "$verify_status"
        _row "stop_file_present" "$stop_status"
        _row "state_status" "$state_status"
        _row "run_id" "$state_run_id"
        _row "updated_at" "$state_updated_at"
        _row "heartbeat_fresh" "$state_heartbeat_fresh"
        _row "heartbeat_age_seconds" "$state_heartbeat_age"
        _row "run_count" "$state_run_count"
        _row "restart_count" "$state_restart_count"
        _row "timeout_rate_pct" "$state_timeout_rate_pct"
        _row "extract_fail_rate_pct" "$state_fail_rate_pct"
        _row "throughput_per_hour" "$state_throughput_per_hour"
        _row "rolling_docs_analyzed" "$state_rolling_docs_analyzed"
        _row "rolling_score" "$state_rolling_score"
        _row "rolling_fail_ratio" "$state_rolling_fail_ratio"
        _row "rolling_critical_pct" "$state_rolling_critical_pct"
        _row "documents_missing_ratio_pct" "$state_documents_missing_ratio_pct"
        _row "phase" "$state_phase"
        _row "quality_gate_action" "$state_quality_gate_action"
        _row "quality_gate_reason" "$state_quality_gate_reason"
        _row "quality_gate_consecutive_failures" "$state_quality_gate_consecutive_failures"
        _row "adaptive_watchdog_seconds" "$state_adaptive_watchdog_seconds"
        _row "adaptive_heartbeat_timeout_seconds" "$state_adaptive_heartbeat_timeout_seconds"
        _row "recent_failed_pdf_count" "$state_recent_failed_pdf_count"
        _row "corpus_pdf_count" "$corpus_pdf_count"
        _row "corpus_profile_count" "$corpus_profile_count"
        _row "extracted_pdf_count" "$extracted_pdf_count"
        _row "missing_pdf_count" "$missing_pdf_count"
        _row "extracted_pdf_coverage_pct" "$extracted_pdf_coverage_pct"
        _row "run_discovered_profiles_count" "${discovered_profiles:-0}"
        _row "run_scanned_max" "${scanned_max:-0}"
        _row "run_new_extractions" "${new_extractions:-0}"
        _row "run_last_extracted_pdf" "$last_extracted_pdf"
        echo "$border"
    fi
}

CMD="${1:-}"
case "$CMD" in
start-supervised)
    shift
    _start_supervised "$@"
    ;;
stop-supervised)
    shift
    _stop_supervised "$@"
    ;;
status-supervised)
    shift
    _status_supervised "$@"
    ;;
*)
    exec uv run --script learn_datalake.py "$@"
    ;;
esac
