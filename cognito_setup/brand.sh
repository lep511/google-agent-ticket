#!/usr/bin/env bash
#
# brand.sh — Apply Tickr branding to Cognito Managed Login (new experience).
#
# Uses the CreateManagedLoginBranding / UpdateManagedLoginBranding API
# to customize the login page with the app's design system. Requires the
# Essentials or Plus feature plan.
#
# Usage:
#   ./brand.sh [OPTIONS]
#
# Options:
#   --region REGION       AWS region (default: us-east-1)
#   --pool-id ID         User pool ID (auto-detected from cognito-config.json)
#   --client-id ID       App client ID (auto-detected from cognito-config.json)
#   --settings FILE      Path to settings JSON (default: managed-login-settings.json)
#   --logo FILE          Logo image file (PNG/SVG/JPG). Optional.
#   --reset              Reset to Cognito default branding
#   --help               Show this help message
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

REGION="us-east-1"
POOL_ID=""
CLIENT_ID=""
SETTINGS_FILE="$SCRIPT_DIR/managed-login-settings.json"
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
    --settings)   SETTINGS_FILE="$2"; shift 2 ;;
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

info "Applying Managed Login branding to pool $POOL_ID, client $CLIENT_ID in $REGION"

# Check if branding already exists
EXISTING_ID=$(aws cognito-idp describe-managed-login-branding-by-client \
  --user-pool-id "$POOL_ID" \
  --client-id "$CLIENT_ID" \
  --region "$REGION" \
  --output json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('ManagedLoginBranding', {}).get('ManagedLoginBrandingId', ''))
" 2>/dev/null || echo "")

# Reset: delete existing and recreate with defaults
if [[ "$RESET" == true ]]; then
  if [[ -n "$EXISTING_ID" ]]; then
    info "Resetting to Cognito default branding..."
    aws cognito-idp delete-managed-login-branding \
      --managed-login-branding-id "$EXISTING_ID" \
      --region "$REGION" 2>/dev/null || true

    aws cognito-idp create-managed-login-branding \
      --user-pool-id "$POOL_ID" \
      --client-id "$CLIENT_ID" \
      --use-cognito-provided-values \
      --region "$REGION" \
      --output json >/dev/null
    success "Branding reset to Cognito defaults."
  else
    info "No custom branding found. Creating with defaults..."
    aws cognito-idp create-managed-login-branding \
      --user-pool-id "$POOL_ID" \
      --client-id "$CLIENT_ID" \
      --use-cognito-provided-values \
      --region "$REGION" \
      --output json >/dev/null
    success "Default branding created."
  fi
  exit 0
fi

# Validate settings file
if [[ ! -f "$SETTINGS_FILE" ]]; then
  error "Settings file not found: $SETTINGS_FILE"
  exit 1
fi

# Validate JSON
if ! python3 -c "import json; json.load(open('$SETTINGS_FILE'))" 2>/dev/null; then
  error "Settings file is not valid JSON: $SETTINGS_FILE"
  exit 1
fi

info "Using settings: $SETTINGS_FILE"

# Build assets array — always include the page background SVG
BG_SVG="$SCRIPT_DIR/page-background.svg"
ASSETS=()

if [[ -f "$BG_SVG" ]]; then
  BG_B64=$(base64 -w0 "$BG_SVG")
  ASSETS+=("{\"Category\":\"PAGE_BACKGROUND\",\"ColorMode\":\"LIGHT\",\"Extension\":\"SVG\",\"Bytes\":\"$BG_B64\"}")
  ASSETS+=("{\"Category\":\"PAGE_BACKGROUND\",\"ColorMode\":\"DARK\",\"Extension\":\"SVG\",\"Bytes\":\"$BG_B64\"}")
  info "Using page background: $BG_SVG"
fi

# Add logo if provided
if [[ -n "$LOGO_FILE" ]]; then
  if [[ ! -f "$LOGO_FILE" ]]; then
    error "Logo file not found: $LOGO_FILE"
    exit 1
  fi

  EXTENSION=$(echo "${LOGO_FILE##*.}" | tr '[:lower:]' '[:upper:]')
  case "$EXTENSION" in
    PNG)  EXTENSION="PNG" ;;
    SVG)  EXTENSION="SVG" ;;
    JPG|JPEG) EXTENSION="JPEG" ;;
    ICO)  EXTENSION="ICO" ;;
    *)
      error "Unsupported logo format: $EXTENSION. Use PNG, SVG, JPG, or ICO."
      exit 1
      ;;
  esac

  LOGO_B64=$(base64 -w0 "$LOGO_FILE")
  ASSETS+=("{\"Category\":\"FORM_LOGO\",\"ColorMode\":\"LIGHT\",\"Extension\":\"$EXTENSION\",\"Bytes\":\"$LOGO_B64\"}")
  ASSETS+=("{\"Category\":\"FORM_LOGO\",\"ColorMode\":\"DARK\",\"Extension\":\"$EXTENSION\",\"Bytes\":\"$LOGO_B64\"}")
  info "Using logo: $LOGO_FILE ($EXTENSION)"
fi

# Write assets to a temp file (base64 payloads are too large for inline args)
ASSETS_FILE=""
if [[ ${#ASSETS[@]} -gt 0 ]]; then
  ASSETS_FILE=$(mktemp)
  JOINED=$(IFS=,; echo "${ASSETS[*]}")
  echo "[$JOINED]" > "$ASSETS_FILE"
fi

# Create or update branding
if [[ -z "$EXISTING_ID" ]]; then
  info "Creating new Managed Login branding..."
  CMD="aws cognito-idp create-managed-login-branding \
    --user-pool-id $POOL_ID \
    --client-id $CLIENT_ID \
    --settings file://$SETTINGS_FILE \
    --region $REGION \
    --output json"
else
  info "Updating existing Managed Login branding ($EXISTING_ID)..."
  CMD="aws cognito-idp update-managed-login-branding \
    --managed-login-branding-id $EXISTING_ID \
    --user-pool-id $POOL_ID \
    --settings file://$SETTINGS_FILE \
    --region $REGION \
    --output json"
fi

if [[ -n "$ASSETS_FILE" ]]; then
  CMD="$CMD --assets file://$ASSETS_FILE"
fi

eval "$CMD" >/dev/null 2>&1
RESULT=$?

if [[ $RESULT -ne 0 ]]; then
  error "Failed to apply branding. Showing error details:"
  eval "$CMD" 2>&1
  [[ -n "$ASSETS_FILE" ]] && rm -f "$ASSETS_FILE"
  exit 1
fi

[[ -n "$ASSETS_FILE" ]] && rm -f "$ASSETS_FILE"
success "Managed Login branding applied!"

# Get the domain for preview
DOMAIN=$(python3 -c "
import json
cfg = json.load(open('$CONFIG_FILE'))
prefix = cfg.get('hostedUIDomain', '')
print(f'{prefix}.auth.$REGION.amazoncognito.com')
" 2>/dev/null || echo "your-domain.auth.$REGION.amazoncognito.com")

echo ""
echo "------------------------------------------------------------"
echo "  Preview your branded login page at:"
echo "  https://$DOMAIN/login?client_id=$CLIENT_ID&response_type=code&scope=email+openid+profile&redirect_uri=http://localhost:3000"
echo "------------------------------------------------------------"
echo ""
echo "  Design system applied:"
echo "    Background:  #F6F4F0 (warm cream)"
echo "    Primary:     #0b5a4b (dark teal)"
echo "    Inputs:      rounded, stone borders"
echo "    Errors:      #CC3131 (app red)"
echo ""
echo "Tips:"
echo "  - Add a logo:   ./brand.sh --logo path/to/logo.png"
echo "  - Reset:        ./brand.sh --reset"
echo "  - Custom theme: ./brand.sh --settings my-settings.json"
