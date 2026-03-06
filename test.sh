#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

AUTH_FILE="$HOME/.pi/agent/auth.json"
AUTH_BACKUP="$HOME/.pi/agent/auth.json.bak"

DEFAULT_REGRESSION_TESTS=(
	"packages/coding-agent:test/subagent-reporter.test.ts"
	"packages/coding-agent:test/taskboard-extension.test.ts"
	"packages/coding-agent:test/settings-manager.test.ts"
	"packages/coding-agent:test/system-prompt.test.ts"
	"packages/coding-agent:test/subagent-builtins.test.ts"
	"packages/coding-agent:test/subagent-guard.test.ts"
	"packages/agent:test/agent-loop.test.ts"
	"packages/ai:test/anthropic-compatibility.test.ts"
	"packages/ai:test/openai-completions-tool-choice.test.ts"
)
EXTRA_REGRESSION_TESTS=()

normalize_extra_test_target() {
	local raw="$1"
	case "$raw" in
		*addons-extensions/taskboard.ts)
			echo "packages/coding-agent:test/taskboard-extension.test.ts"
			return
			;;
		*addons-extensions/subagent.ts)
			echo "packages/coding-agent:test/subagent-reporter.test.ts"
			return
			;;
	esac

	if [[ "$raw" =~ ^(packages/[^/]+)/(.+)$ ]]; then
		echo "${BASH_REMATCH[1]}:${BASH_REMATCH[2]}"
		return
	fi

	echo "packages/coding-agent:$raw"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		-e|--extra-test)
			if [[ $# -lt 2 ]]; then
				echo "Missing value for $1" >&2
				exit 1
			fi
			EXTRA_REGRESSION_TESTS+=("$(normalize_extra_test_target "$2")")
			shift 2
			;;
		*)
			echo "Unknown argument: $1" >&2
			echo "Usage: ./test.sh [-e|--extra-test <test file or source path>]" >&2
			exit 1
			;;
	esac
done

# Restore auth.json on exit (success or failure)
cleanup() {
    if [[ -f "$AUTH_BACKUP" ]]; then
        mv "$AUTH_BACKUP" "$AUTH_FILE"
        echo "Restored auth.json"
    fi
}
trap cleanup EXIT

# Move auth.json out of the way
if [[ -f "$AUTH_FILE" ]]; then
    mv "$AUTH_FILE" "$AUTH_BACKUP"
    echo "Moved auth.json to backup"
fi

# Skip local LLM tests (ollama, lmstudio)
export PI_NO_LOCAL_LLM=1

# Unset API keys (see packages/ai/src/stream.ts getEnvApiKey)
unset ANTHROPIC_API_KEY
unset ANTHROPIC_OAUTH_TOKEN
unset OPENAI_API_KEY
unset GEMINI_API_KEY
unset GROQ_API_KEY
unset CEREBRAS_API_KEY
unset XAI_API_KEY
unset OPENROUTER_API_KEY
unset ZAI_API_KEY
unset MISTRAL_API_KEY
unset MINIMAX_API_KEY
unset MINIMAX_CN_API_KEY
unset KIMI_API_KEY
unset HF_TOKEN
unset AI_GATEWAY_API_KEY
unset OPENCODE_API_KEY
unset COPILOT_GITHUB_TOKEN
unset GH_TOKEN
unset GITHUB_TOKEN
unset GOOGLE_APPLICATION_CREDENTIALS
unset GOOGLE_CLOUD_PROJECT
unset GCLOUD_PROJECT
unset GOOGLE_CLOUD_LOCATION
unset AWS_PROFILE
unset AWS_ACCESS_KEY_ID
unset AWS_SECRET_ACCESS_KEY
unset AWS_SESSION_TOKEN
unset AWS_REGION
unset AWS_DEFAULT_REGION
unset AWS_BEARER_TOKEN_BEDROCK
unset AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
unset AWS_CONTAINER_CREDENTIALS_FULL_URI
unset AWS_WEB_IDENTITY_TOKEN_FILE
unset BEDROCK_EXTENSIVE_MODEL_TEST

echo "Running tests without API keys..."
npm test

REGRESSION_TESTS=("${DEFAULT_REGRESSION_TESTS[@]}" "${EXTRA_REGRESSION_TESTS[@]}")
UNIQUE_REGRESSION_TESTS=()
declare -A SEEN_TESTS=()
declare -A SEEN_PACKAGES=()
declare -A TESTS_BY_PACKAGE=()
PACKAGE_ORDER=()

for test_spec in "${REGRESSION_TESTS[@]}"; do
	package_dir="${test_spec%%:*}"
	test_file="${test_spec#*:}"
	test_key="$package_dir:$test_file"

	if [[ "$package_dir" == "$test_spec" || -z "$test_file" ]]; then
		echo "Error: Invalid regression test target: $test_spec" >&2
		exit 1
	fi

	if [[ -n "${SEEN_TESTS[$test_key]+x}" ]]; then
		continue
	fi
	SEEN_TESTS["$test_key"]=1
	if [[ ! -f "$SCRIPT_DIR/$package_dir/$test_file" ]]; then
		echo "Error: Regression test not found: $package_dir/$test_file" >&2
		exit 1
	fi
	UNIQUE_REGRESSION_TESTS+=("$test_key")
	TESTS_BY_PACKAGE["$package_dir"]+=$'\n'"$test_file"
	if [[ -z "${SEEN_PACKAGES[$package_dir]+x}" ]]; then
		SEEN_PACKAGES["$package_dir"]=1
		PACKAGE_ORDER+=("$package_dir")
	fi
done

if [[ ${#UNIQUE_REGRESSION_TESTS[@]} -gt 0 ]]; then
	echo "Running targeted regression tests..."
	for package_dir in "${PACKAGE_ORDER[@]}"; do
		package_tests=()
		while IFS= read -r test_file; do
			if [[ -n "$test_file" ]]; then
				package_tests+=("$test_file")
			fi
		done <<< "${TESTS_BY_PACKAGE[$package_dir]}"

		if [[ ${#package_tests[@]} -eq 0 ]]; then
			continue
		fi

		(
			cd "$SCRIPT_DIR/$package_dir"
			npx tsx ../../node_modules/vitest/dist/cli.js --run "${package_tests[@]}"
		)
	done
fi
