#!/usr/bin/env bash
#
# teardown.sh — Remove the Cognito resources created by deploy.sh.
#
# Usage:
#   ./teardown.sh [OPTIONS]
#
# Options:
#   --region REGION       AWS region (default: us-east-1)
#   --pool-name NAME     User pool name to delete (default: tickr-user-pool)
#   --force              Skip confirmation prompt
#   --help               Show this help message
#
set -euo pipefail

REGION="us-east-1"
POOL_NAME="tickr-user-pool"
FORCE=false

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

while [[ $# -gt 0 ]]; do
  case $1 in
    --region)     REGION="$2"; shift 2 ;;
    --pool-name)  POOL_NAME="$2"; shift 2 ;;
    --force)      FORCE=true; shift ;;
    --help)
      sed -n '2,/^$/p' "$0" | sed 's/^#//;s/^ //'
      exit 0
      ;;
    *)
      error "Unknown option: $1"
      exit 1
      ;;
  esac
done

if ! command -v aws &>/dev/null; then
  error "AWS CLI is not installed."
  exit 1
fi

if ! aws sts get-caller-identity &>/dev/null; then
  error "AWS credentials are not configured or have expired."
  exit 1
fi

# Find the user pool
info "Looking for user pool '$POOL_NAME' in $REGION..."
EXISTING_POOLS=$(aws cognito-idp list-user-pools --max-results 60 --region "$REGION" --output json)
USER_POOL_ID=$(echo "$EXISTING_POOLS" | python3 -c "
import sys, json
pools = json.load(sys.stdin).get('UserPools', [])
matches = [p['Id'] for p in pools if p['Name'] == '$POOL_NAME']
print(matches[0] if matches else '')
" 2>/dev/null || echo "")

if [[ -z "$USER_POOL_ID" ]]; then
  warn "No user pool named '$POOL_NAME' found in $REGION. Nothing to delete."
  exit 0
fi

info "Found user pool: $USER_POOL_ID"

if [[ "$FORCE" != true ]]; then
  echo ""
  warn "This will permanently delete:"
  echo "  - User pool: $POOL_NAME ($USER_POOL_ID)"
  echo "  - All users and their data"
  echo "  - All app clients"
  echo "  - The Cognito domain"
  echo ""
  read -rp "Are you sure? Type 'delete' to confirm: " CONFIRM
  if [[ "$CONFIRM" != "delete" ]]; then
    info "Aborted."
    exit 0
  fi
fi

# Remove deletion protection first
info "Removing deletion protection..."
aws cognito-idp update-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --region "$REGION" \
  --deletion-protection INACTIVE 2>/dev/null || true

# Delete the domain
DOMAIN=$(aws cognito-idp describe-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --region "$REGION" \
  --output json | python3 -c "
import sys, json
pool = json.load(sys.stdin)['UserPool']
print(pool.get('Domain', ''))
" 2>/dev/null || echo "")

if [[ -n "$DOMAIN" ]]; then
  info "Deleting domain: $DOMAIN..."
  aws cognito-idp delete-user-pool-domain \
    --user-pool-id "$USER_POOL_ID" \
    --domain "$DOMAIN" \
    --region "$REGION"
  success "Domain deleted."
fi

# Delete the user pool
info "Deleting user pool: $USER_POOL_ID..."
aws cognito-idp delete-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --region "$REGION"

success "User pool '$POOL_NAME' ($USER_POOL_ID) deleted."

# Reset cognito-config.json
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_ROOT/cognito-config.json"

if [[ -f "$CONFIG_FILE" ]]; then
  info "Resetting $CONFIG_FILE to placeholder values..."
  cat > "$CONFIG_FILE" <<EOF
{
  "userPoolId": "us-east-1_exampleId",
  "userPoolClientId": "exampleAppClientId123456",
  "region": "us-east-1"
}
EOF
  success "cognito-config.json reset."
fi

echo ""
success "Teardown complete. Remember to remove the VITE_COGNITO_* values from your .env file."
