#!/usr/bin/env bash
#
# deploy.sh — Deploy an Amazon Cognito User Pool for the Tickr application.
#
# Creates a user pool (Essentials tier), app client (public, no secret),
# Cognito domain with Managed Login v2, and optionally applies branding.
#
# Prerequisites:
#   - AWS CLI v2 installed and configured (aws configure / aws sso login)
#   - Sufficient IAM permissions for cognito-idp:Create*, cognito-idp:Describe*,
#     cognito-idp:Update*, cognito-idp:AdminSetUserPassword,
#     cognito-idp:CreateManagedLoginBranding
#
# Usage:
#   ./deploy.sh [OPTIONS]
#
# Options:
#   --region REGION             AWS region (default: us-east-1)
#   --pool-name NAME            User pool name (default: tickr-user-pool)
#   --domain-prefix PREFIX      Cognito domain prefix (must be globally unique)
#   --callback-url URL          Primary OAuth callback URL (default: http://localhost:3000)
#   --extra-callback-url URL    Additional callback URL (e.g. https://app.vercel.app)
#   --app-name NAME             App client name (default: tickr-web-client)
#   --create-test-user          Create a test user (prompts for email/password)
#   --apply-branding            Apply Tickr theme after deployment
#   --output-env FILE           Write .env values to this file (default: stdout only)
#   --help                      Show this help message
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# ------------------------------------------------------------------
# Defaults
# ------------------------------------------------------------------
REGION="us-east-1"
POOL_NAME="tickr-user-pool"
DOMAIN_PREFIX=""
CALLBACK_URL="http://localhost:3000"
EXTRA_CALLBACK_URLS=()
APP_CLIENT_NAME="tickr-web-client"
CREATE_TEST_USER=false
APPLY_BRANDING=false
OUTPUT_ENV=""

# ------------------------------------------------------------------
# Color helpers
# ------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
step()    { echo -e "\n${BOLD}── $* ──${NC}"; }

# ------------------------------------------------------------------
# Parse arguments
# ------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case $1 in
    --region)             REGION="$2"; shift 2 ;;
    --pool-name)          POOL_NAME="$2"; shift 2 ;;
    --domain-prefix)      DOMAIN_PREFIX="$2"; shift 2 ;;
    --callback-url)       CALLBACK_URL="$2"; shift 2 ;;
    --extra-callback-url) EXTRA_CALLBACK_URLS+=("$2"); shift 2 ;;
    --app-name)           APP_CLIENT_NAME="$2"; shift 2 ;;
    --create-test-user)   CREATE_TEST_USER=true; shift ;;
    --apply-branding)     APPLY_BRANDING=true; shift ;;
    --output-env)         OUTPUT_ENV="$2"; shift 2 ;;
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

# ------------------------------------------------------------------
# Validation
# ------------------------------------------------------------------
if ! command -v aws &>/dev/null; then
  error "AWS CLI is not installed. Install it from https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
  exit 1
fi

if ! aws sts get-caller-identity &>/dev/null; then
  error "AWS credentials are not configured or have expired. Run 'aws configure' or 'aws sso login'."
  exit 1
fi

CALLER_IDENTITY=$(aws sts get-caller-identity --output json)
ACCOUNT_ID=$(echo "$CALLER_IDENTITY" | python3 -c "import sys,json; print(json.load(sys.stdin)['Account'])")
info "AWS account: $ACCOUNT_ID | Region: $REGION"

if [[ -z "$DOMAIN_PREFIX" ]]; then
  DOMAIN_PREFIX="tickr-$(echo "$ACCOUNT_ID" | tail -c 7)"
  info "Auto-generated domain prefix: $DOMAIN_PREFIX"
fi

if [[ ! "$DOMAIN_PREFIX" =~ ^[a-z][a-z0-9-]{2,62}$ ]]; then
  error "Domain prefix must be 3-63 characters, start with a lowercase letter, and contain only lowercase letters, numbers, and hyphens."
  exit 1
fi

# Build callback URL list
ALL_CALLBACK_URLS=("$CALLBACK_URL")
ALL_CALLBACK_URLS+=("${EXTRA_CALLBACK_URLS[@]}")
CALLBACK_ARGS=$(printf '"%s" ' "${ALL_CALLBACK_URLS[@]}")
LOGOUT_ARGS="$CALLBACK_ARGS"

# ------------------------------------------------------------------
# Step 1: User Pool
# ------------------------------------------------------------------
step "User Pool"

EXISTING_POOLS=$(aws cognito-idp list-user-pools --max-results 60 --region "$REGION" --output json)
EXISTING_POOL_ID=$(echo "$EXISTING_POOLS" | python3 -c "
import sys, json
pools = json.load(sys.stdin).get('UserPools', [])
matches = [p['Id'] for p in pools if p['Name'] == '$POOL_NAME']
print(matches[0] if matches else '')
" 2>/dev/null || echo "")

if [[ -n "$EXISTING_POOL_ID" ]]; then
  warn "User pool '$POOL_NAME' already exists (ID: $EXISTING_POOL_ID)."
  read -rp "  Use the existing pool? [Y/n] " USE_EXISTING
  if [[ "${USE_EXISTING,,}" == "n" ]]; then
    error "Aborting. Use --pool-name to pick a different name."
    exit 1
  fi
  USER_POOL_ID="$EXISTING_POOL_ID"
  success "Reusing user pool: $USER_POOL_ID"
else
  info "Creating user pool '$POOL_NAME' (Essentials tier)..."
  CREATE_POOL_OUTPUT=$(aws cognito-idp create-user-pool \
    --pool-name "$POOL_NAME" \
    --region "$REGION" \
    --user-pool-tier ESSENTIALS \
    --auto-verified-attributes email \
    --username-attributes email \
    --username-configuration "CaseSensitive=false" \
    --mfa-configuration OFF \
    --policies '{
      "PasswordPolicy": {
        "MinimumLength": 8,
        "RequireUppercase": true,
        "RequireLowercase": true,
        "RequireNumbers": true,
        "RequireSymbols": false,
        "TemporaryPasswordValidityDays": 7
      }
    }' \
    --schema '[{
      "Name": "email",
      "AttributeDataType": "String",
      "Required": true,
      "Mutable": true
    }]' \
    --account-recovery-setting '{
      "RecoveryMechanisms": [{"Priority": 1, "Name": "verified_email"}]
    }' \
    --user-attribute-update-settings '{
      "AttributesRequireVerificationBeforeUpdate": ["email"]
    }' \
    --deletion-protection ACTIVE \
    --output json)

  USER_POOL_ID=$(echo "$CREATE_POOL_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['UserPool']['Id'])")
  success "User pool created: $USER_POOL_ID"
fi

# ------------------------------------------------------------------
# Step 2: App Client
# ------------------------------------------------------------------
step "App Client"

EXISTING_CLIENTS=$(aws cognito-idp list-user-pool-clients \
  --user-pool-id "$USER_POOL_ID" \
  --region "$REGION" \
  --max-results 60 \
  --output json)

EXISTING_CLIENT_ID=$(echo "$EXISTING_CLIENTS" | python3 -c "
import sys, json
clients = json.load(sys.stdin).get('UserPoolClients', [])
matches = [c['ClientId'] for c in clients if c['ClientName'] == '$APP_CLIENT_NAME']
print(matches[0] if matches else '')
" 2>/dev/null || echo "")

if [[ -n "$EXISTING_CLIENT_ID" ]]; then
  warn "App client '$APP_CLIENT_NAME' already exists (ID: $EXISTING_CLIENT_ID)."
  CLIENT_ID="$EXISTING_CLIENT_ID"

  # Update callback URLs in case they changed
  info "Updating callback URLs..."
  eval aws cognito-idp update-user-pool-client \
    --user-pool-id "$USER_POOL_ID" \
    --client-id "$CLIENT_ID" \
    --region "$REGION" \
    --explicit-auth-flows "ALLOW_USER_SRP_AUTH" "ALLOW_REFRESH_TOKEN_AUTH" "ALLOW_USER_PASSWORD_AUTH" \
    --supported-identity-providers "COGNITO" \
    --callback-urls $CALLBACK_ARGS \
    --logout-urls $LOGOUT_ARGS \
    --allowed-o-auth-flows "code" \
    --allowed-o-auth-scopes "email" "openid" "profile" \
    --allowed-o-auth-flows-user-pool-client \
    --enable-token-revocation \
    --prevent-user-existence-errors "ENABLED" \
    --access-token-validity 1 \
    --id-token-validity 1 \
    --refresh-token-validity 30 \
    --token-validity-units "'{\"AccessToken\":\"hours\",\"IdToken\":\"hours\",\"RefreshToken\":\"days\"}'" \
    --output json '>/dev/null'

  success "App client updated: $CLIENT_ID"
else
  info "Creating app client '$APP_CLIENT_NAME' (public, no secret)..."
  CREATE_CLIENT_OUTPUT=$(eval aws cognito-idp create-user-pool-client \
    --user-pool-id "$USER_POOL_ID" \
    --client-name "$APP_CLIENT_NAME" \
    --region "$REGION" \
    --no-generate-secret \
    --explicit-auth-flows "ALLOW_USER_SRP_AUTH" "ALLOW_REFRESH_TOKEN_AUTH" "ALLOW_USER_PASSWORD_AUTH" \
    --supported-identity-providers "COGNITO" \
    --callback-urls $CALLBACK_ARGS \
    --logout-urls $LOGOUT_ARGS \
    --allowed-o-auth-flows "code" \
    --allowed-o-auth-scopes "email" "openid" "profile" \
    --allowed-o-auth-flows-user-pool-client \
    --enable-token-revocation \
    --prevent-user-existence-errors "ENABLED" \
    --access-token-validity 1 \
    --id-token-validity 1 \
    --refresh-token-validity 30 \
    --token-validity-units "'{\"AccessToken\":\"hours\",\"IdToken\":\"hours\",\"RefreshToken\":\"days\"}'" \
    --output json)

  CLIENT_ID=$(echo "$CREATE_CLIENT_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['UserPoolClient']['ClientId'])")
  success "App client created: $CLIENT_ID"
fi

# ------------------------------------------------------------------
# Step 3: Domain (Managed Login v2)
# ------------------------------------------------------------------
step "Cognito Domain (Managed Login)"

EXISTING_DOMAIN=$(aws cognito-idp describe-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --region "$REGION" \
  --output json | python3 -c "
import sys, json
pool = json.load(sys.stdin)['UserPool']
print(pool.get('Domain', ''))
" 2>/dev/null || echo "")

if [[ -n "$EXISTING_DOMAIN" ]]; then
  warn "Domain already exists: $EXISTING_DOMAIN"
  DOMAIN_PREFIX="$EXISTING_DOMAIN"

  # Ensure it uses Managed Login v2
  info "Ensuring Managed Login v2..."
  aws cognito-idp update-user-pool-domain \
    --user-pool-id "$USER_POOL_ID" \
    --domain "$DOMAIN_PREFIX" \
    --managed-login-version 2 \
    --region "$REGION" \
    --output json >/dev/null 2>&1 || true
  success "Domain: $DOMAIN_PREFIX (Managed Login v2)"
else
  DOMAIN_CHECK=$(aws cognito-idp describe-user-pool-domain \
    --domain "$DOMAIN_PREFIX" \
    --region "$REGION" \
    --output json 2>/dev/null || echo '{"DomainDescription":{}}')

  DOMAIN_STATUS=$(echo "$DOMAIN_CHECK" | python3 -c "
import sys, json
desc = json.load(sys.stdin).get('DomainDescription', {})
print(desc.get('Status', ''))
" 2>/dev/null || echo "")

  if [[ -n "$DOMAIN_STATUS" ]]; then
    error "Domain prefix '$DOMAIN_PREFIX' is already taken. Choose a different one with --domain-prefix."
    exit 1
  fi

  info "Creating domain '$DOMAIN_PREFIX' with Managed Login v2..."
  aws cognito-idp create-user-pool-domain \
    --user-pool-id "$USER_POOL_ID" \
    --domain "$DOMAIN_PREFIX" \
    --managed-login-version 2 \
    --region "$REGION" \
    --output json >/dev/null

  success "Domain created: $DOMAIN_PREFIX (Managed Login v2)"
fi

COGNITO_DOMAIN="${DOMAIN_PREFIX}.auth.${REGION}.amazoncognito.com"

# ------------------------------------------------------------------
# Step 4: Apply Branding (optional)
# ------------------------------------------------------------------
if [[ "$APPLY_BRANDING" == true ]]; then
  step "Managed Login Branding"
  if [[ -x "$SCRIPT_DIR/brand.sh" ]]; then
    bash "$SCRIPT_DIR/brand.sh" \
      --region "$REGION" \
      --pool-id "$USER_POOL_ID" \
      --client-id "$CLIENT_ID"
  else
    warn "brand.sh not found or not executable. Skipping branding."
  fi
fi

# ------------------------------------------------------------------
# Step 5: Test User (optional)
# ------------------------------------------------------------------
if [[ "$CREATE_TEST_USER" == true ]]; then
  step "Test User"
  read -rp "  Email: " TEST_EMAIL
  read -rsp "  Password (min 8 chars, upper+lower+number): " TEST_PASSWORD
  echo ""

  if [[ -z "$TEST_EMAIL" || -z "$TEST_PASSWORD" ]]; then
    warn "Skipping test user creation (empty email or password)."
  else
    aws cognito-idp admin-create-user \
      --user-pool-id "$USER_POOL_ID" \
      --username "$TEST_EMAIL" \
      --user-attributes "Name=email,Value=$TEST_EMAIL" "Name=email_verified,Value=true" \
      --message-action SUPPRESS \
      --region "$REGION" \
      --output json >/dev/null 2>&1 || true

    aws cognito-idp admin-set-user-password \
      --user-pool-id "$USER_POOL_ID" \
      --username "$TEST_EMAIL" \
      --password "$TEST_PASSWORD" \
      --permanent \
      --region "$REGION"

    success "Test user created: $TEST_EMAIL"
  fi
fi

# ------------------------------------------------------------------
# Output
# ------------------------------------------------------------------
step "Deployment Complete"

ENV_BLOCK="VITE_COGNITO_USER_POOL_ID=${USER_POOL_ID}
VITE_COGNITO_CLIENT_ID=${CLIENT_ID}
VITE_COGNITO_REGION=${REGION}
VITE_COGNITO_DOMAIN=${DOMAIN_PREFIX}"

echo ""
echo "  Add to .env:"
echo "  ┌──────────────────────────────────────────────────────"
echo "$ENV_BLOCK" | sed 's/^/  │  /'
echo "  └──────────────────────────────────────────────────────"
echo ""
echo "  Resources:"
echo "    User Pool:     $USER_POOL_ID"
echo "    App Client:    $CLIENT_ID"
echo "    Domain:        https://$COGNITO_DOMAIN"
echo "    Callback URLs: ${ALL_CALLBACK_URLS[*]}"
echo "    Login version: Managed Login v2"
echo ""

if [[ -n "$OUTPUT_ENV" ]]; then
  echo "$ENV_BLOCK" > "$OUTPUT_ENV"
  success "Environment variables written to: $OUTPUT_ENV"
fi

# Update cognito-config.json
CONFIG_FILE="$PROJECT_ROOT/cognito-config.json"
if [[ -f "$CONFIG_FILE" ]]; then
  info "Updating cognito-config.json..."
  cat > "$CONFIG_FILE" <<EOF
{
  "userPoolId": "${USER_POOL_ID}",
  "userPoolClientId": "${CLIENT_ID}",
  "region": "${REGION}",
  "hostedUIDomain": "${DOMAIN_PREFIX}"
}
EOF
  success "cognito-config.json updated."
fi

echo ""
success "Done! Run 'npm run dev' and open http://localhost:3000"
