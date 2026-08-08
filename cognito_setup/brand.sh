#!/usr/bin/env bash
#
# brand.sh — Apply custom branding to the Cognito Hosted UI.
#
# Uploads the Tickr-themed CSS (and optionally a logo) to the user pool's
# hosted login page so it visually matches the app.
#
# Usage:
#   ./brand.sh [OPTIONS]
#
# Options:
#   --region REGION       AWS region (default: us-east-1)
#   --pool-id ID         User pool ID (auto-detected from cognito-config.json)
#   --client-id ID       App client ID (auto-detected from cognito-config.json)
#   --css FILE           Path to CSS file (default: hosted-ui.css in this folder)
#   --logo FILE          Path to a logo image (PNG/JPG, max 100KB). Optional.
#   --reset              Remove all customizations (revert to default Cognito UI)
#   --help               Show this help message
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

REGION="us-east-1"
POOL_ID=""
CLIENT_ID=""
CSS_FILE="$SCRIPT_DIR/hosted-ui.css"
LOGO_FILE=""
RESET=false

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
    --pool-id)    POOL_ID="$2"; shift 2 ;;
    --client-id)  CLIENT_ID="$2"; shift 2 ;;
    --css)        CSS_FILE="$2"; shift 2 ;;
    --logo)       LOGO_FILE="$2"; shift 2 ;;
    --reset)      RESET=true; shift ;;
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

# Auto-detect pool/client from cognito-config.json
CONFIG_FILE="$PROJECT_ROOT/cognito-config.json"
if [[ -z "$POOL_ID" && -f "$CONFIG_FILE" ]]; then
  POOL_ID=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['userPoolId'])" 2>/dev/null || echo "")
fi
if [[ -z "$CLIENT_ID" && -f "$CONFIG_FILE" ]]; then
  CLIENT_ID=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['userPoolClientId'])" 2>/dev/null || echo "")
fi

if [[ -z "$POOL_ID" ]]; then
  error "User pool ID not found. Pass --pool-id or run deploy.sh first."
  exit 1
fi

if [[ -z "$CLIENT_ID" ]]; then
  error "Client ID not found. Pass --client-id or run deploy.sh first."
  exit 1
fi

if ! command -v aws &>/dev/null; then
  error "AWS CLI is not installed."
  exit 1
fi

if ! aws sts get-caller-identity &>/dev/null; then
  error "AWS credentials are not configured or have expired."
  exit 1
fi

info "Applying branding to pool $POOL_ID, client $CLIENT_ID in $REGION"

if [[ "$RESET" == true ]]; then
  info "Resetting Hosted UI to default Cognito branding..."
  aws cognito-idp set-ui-customization \
    --user-pool-id "$POOL_ID" \
    --client-id "$CLIENT_ID" \
    --css "" \
    --region "$REGION" \
    --output json >/dev/null
  success "Branding reset to defaults."
  exit 0
fi

# Validate CSS file
if [[ ! -f "$CSS_FILE" ]]; then
  error "CSS file not found: $CSS_FILE"
  exit 1
fi

CSS_SIZE=$(wc -c < "$CSS_FILE")
if [[ "$CSS_SIZE" -gt 131072 ]]; then
  error "CSS file is too large ($CSS_SIZE bytes). Cognito limit is 128 KB."
  exit 1
fi

info "Using CSS: $CSS_FILE ($CSS_SIZE bytes)"

# Build the command
CMD=(aws cognito-idp set-ui-customization
  --user-pool-id "$POOL_ID"
  --client-id "$CLIENT_ID"
  --css "file://$CSS_FILE"
  --region "$REGION"
  --output json)

# Add logo if provided
if [[ -n "$LOGO_FILE" ]]; then
  if [[ ! -f "$LOGO_FILE" ]]; then
    error "Logo file not found: $LOGO_FILE"
    exit 1
  fi
  LOGO_SIZE=$(wc -c < "$LOGO_FILE")
  if [[ "$LOGO_SIZE" -gt 102400 ]]; then
    error "Logo file is too large ($LOGO_SIZE bytes). Cognito limit is 100 KB."
    exit 1
  fi
  info "Using logo: $LOGO_FILE ($LOGO_SIZE bytes)"
  CMD+=(--image-file "fileb://$LOGO_FILE")
fi

# Apply branding
"${CMD[@]}" >/dev/null
success "Hosted UI branding applied!"

echo ""
echo "------------------------------------------------------------"
echo "  Preview your branded login page at:"
echo "  https://$(python3 -c "
import json
cfg = json.load(open('$CONFIG_FILE'))
prefix = cfg.get('hostedUIDomain', '')
print(f'{prefix}.auth.{\"$REGION\"}.amazoncognito.com/login?client_id={\"$CLIENT_ID\"}&response_type=code&scope=email+openid+profile&redirect_uri=http://localhost:3000')
" 2>/dev/null || echo "your-domain.auth.$REGION.amazoncognito.com/login")"
echo "------------------------------------------------------------"
echo ""
echo "Tips:"
echo "  - Add a logo: ./brand.sh --logo path/to/logo.png"
echo "  - Reset to defaults: ./brand.sh --reset"
echo "  - Edit hosted-ui.css and re-run to update styles"
