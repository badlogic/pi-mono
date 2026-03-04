#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

AUTH_FILE="$HOME/.pi/agent/auth.json"
AUTH_BACKUP="$HOME/.pi/agent/auth.json.bak"

DEFAULT_REGRESSION_TESTS=(
	"test/subagent-reporter.test.ts"
	"test/taskboard-extension.test.ts"
)
EXTRA_REGRESSION_TESTS=()

normalize_extra_test_target() {
	local raw="$1"
	case "$raw" in
		*addons-extensions/taskboard.ts)
			echo "test/taskboard-extension.test.ts"
			return
			;;
		*addons-extensions/subagent.ts)
			echo "test/subagent-reporter.test.ts"
			return
			;;
	esac

	if [[ "$raw" == packages/coding-agent/* ]]; then
		echo "${raw#packages/coding-agent/}"
		return
	fi

	echo "$raw"
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
			echo "Usage: ./test.sh [-e|--extra-test <coding-agent test file>]" >&2
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

for test_file in "${REGRESSION_TESTS[@]}"; do
	if [[ -n "${SEEN_TESTS[$test_file]+x}" ]]; then
		continue
	fi
	SEEN_TESTS["$test_file"]=1
	if [[ ! -f "$SCRIPT_DIR/packages/coding-agent/$test_file" ]]; then
		echo "Error: Regression test not found: $test_file" >&2
		exit 1
	fi
	UNIQUE_REGRESSION_TESTS+=("$test_file")
done

if [[ ${#UNIQUE_REGRESSION_TESTS[@]} -gt 0 ]]; then
	echo "Running targeted coding-agent regression tests..."
	(
		cd "$SCRIPT_DIR/packages/coding-agent"
		npx tsx ../../node_modules/vitest/dist/cli.js --run "${UNIQUE_REGRESSION_TESTS[@]}"
	)
fi
