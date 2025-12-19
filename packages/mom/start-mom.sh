#!/bin/bash

# Wrapper script for pi-mom Slack bot
# Reads fresh OAuth token from ~/.claude/.credentials.json before starting

set -e

CREDENTIALS_FILE="$HOME/.claude/.credentials.json"
MOM_DIR="/home/majinbu/organized/active-projects/pi-mono/packages/mom"
DATA_DIR="/home/majinbu/mom-data"

# Check if credentials file exists
if [ ! -f "$CREDENTIALS_FILE" ]; then
    echo "ERROR: Credentials file not found at $CREDENTIALS_FILE"
    exit 1
fi

# Extract OAuth token from credentials.json
OAUTH_TOKEN=$(jq -r '.claudeAiOauth.accessToken' "$CREDENTIALS_FILE")

if [ -z "$OAUTH_TOKEN" ] || [ "$OAUTH_TOKEN" = "null" ]; then
    echo "ERROR: Failed to extract accessToken from $CREDENTIALS_FILE"
    exit 1
fi

echo "Successfully extracted OAuth token from credentials file"
echo "Starting pi-mom bot..."

# Change to mom directory
cd "$MOM_DIR"

# Load Slack tokens from local env file (not committed to git)
ENV_FILE="$HOME/.mom-env"
if [ -f "$ENV_FILE" ]; then
    source "$ENV_FILE"
else
    echo "ERROR: Missing $ENV_FILE with MOM_SLACK_APP_TOKEN and MOM_SLACK_BOT_TOKEN"
    echo "Create it with:"
    echo '  echo "export MOM_SLACK_APP_TOKEN=xapp-..." > ~/.mom-env'
    echo '  echo "export MOM_SLACK_BOT_TOKEN=xoxb-..." >> ~/.mom-env'
    exit 1
fi

# Export OAuth token from Claude credentials
export ANTHROPIC_OAUTH_TOKEN="$OAUTH_TOKEN"

# Start the bot
exec node dist/main.js "$DATA_DIR"
