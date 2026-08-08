#!/usr/bin/env bash
#
# deploy.sh — Deploy an Amazon Cognito User Pool for the Tickr application.
#
# Creates a user pool, app client (public, no secret), and a Cognito domain,
# then outputs the environment variables required by the app's .env file.
#
# Prerequisites:
#   - AWS CLI v2 installed and configured (aws configure / aws sso login)
#   - Sufficient IAM permissions for cognito-idp:Create*, cognito-idp:Describe*,
#     cognito-idp:Update*, cognito-idp:AdminSetUserPassword
#
# Usage:
#   ./deploy.sh [OPTIONS]
#
# Options:
#   --region REGION         AWS region (default: us-east-1)
#   --pool-name NAME        User pool name (default: tickr-user-pool)
#   --domain-prefix PREFIX  Cognito domain prefix (must be globally unique)
#   --callback-url URL      OAuth callback URL (default: http://localhost:3000)
#   --app-name NAME         App client name (default: tickr-web-client)
#   --create-test-user      Create a test user (prompts for email/password)
#   --output-env FILE       Write .env values to this file (default: stdout only)
#   --help                  Show this help message
#
set -euo pipefail

# ------------------------------------------------------------------
# Defaults
# ------------------------------------------------------------------
REGION="us-east-1"
POOL_NAME="tickr-user-pool"
DOMAIN_PREFIX=""
CALLBACK_URL="http://localhost:3000"
APP_CLIENT_NAME="tickr-web-client"
CREATE_TEST_USER=false
OUTPUT_ENV=""

# ------------------------------------------------------------------
# Color helpers
# ------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ------------------------------------------------------------------
# Parse arguments
# ------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case $1 in
    --region)         REGION="$2"; shift 2 ;;
    --pool-name)      POOL_NAME="$2"; shift 2 ;;
    --domain-prefix)  DOMAIN_PREFIX="$2"; shift 2 ;;
    --callback-url)   CALLBACK_URL="$2"; shift 2 ;;
    --app-name)       APP_CLIENT_NAME="$2"; shift 2 ;;
    --create-test-user) CREATE_TEST_USER=true; shift ;;
    --output-env)     OUTPUT_ENV="$2"; shift 2 ;;
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
info "Using AWS account: $ACCOUNT_ID in region: $REGION"

# Generate a domain prefix if not provided
if [[ -z "$DOMAIN_PREFIX" ]]; then
  DOMAIN_PREFIX="tickr-$(echo "$ACCOUNT_ID" | tail -c 7)"
  info "No --domain-prefix provided; using generated prefix: $DOMAIN_PREFIX"
fi

# Validate domain prefix format
if [[ ! "$DOMAIN_PREFIX" =~ ^[a-z][a-z0-9-]{2,62}$ ]]; then
  error "Domain prefix must be 3-63 characters, start with a lowercase letter, and contain only lowercase letters, numbers, and hyphens."
  exit 1
fi

# ------------------------------------------------------------------
# Check for existing resources (idempotent re-runs)
# ------------------------------------------------------------------
info "Checking for existing user pool named '$POOL_NAME'..."
EXISTING_POOLS=$(aws cognito-idp list-user-pools --max-results 60 --region "$REGION" --output json)
EXISTING_POOL_ID=$(echo "$EXISTING_POOLS" | python3 -c "
import sys, json
pools = json.load(sys.stdin).get('UserPools', [])
matches = [p['Id'] for p in pools if p['Name'] == '$POOL_NAME']
print(matches[0] if matches else '')
" 2>/dev/null || echo "")

if [[ -n "$EXISTING_POOL_ID" ]]; then
  warn "User pool '$POOL_NAME' already exists (ID: $EXISTING_POOL_ID)."
  echo ""
  read -rp "Do you want to use the existing pool? [Y/n] " USE_EXISTING
  if [[ "${USE_EXISTING,,}" == "n" ]]; then
    error "Aborting. Rename your pool with --pool-name or delete the existing one."
    exit 1
  fi
  USER_POOL_ID="$EXISTING_POOL_ID"
  success "Reusing existing user pool: $USER_POOL_ID"
else
  # ------------------------------------------------------------------
  # Create User Pool
  # ------------------------------------------------------------------
  info "Creating user pool '$POOL_NAME'..."
  CREATE_POOL_OUTPUT=$(aws cognito-idp create-user-pool \
    --pool-name "$POOL_NAME" \
    --region "$REGION" \
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
    --schema '[
      {
        "Name": "email",
        "AttributeDataType": "String",
        "Required": true,
        "Mutable": true
      }
    ]' \
    --account-recovery-setting '{
      "RecoveryMechanisms": [
        {"Priority": 1, "Name": "verified_email"}
      ]
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
# Create or find the App Client (public, no secret)
# ------------------------------------------------------------------
info "Checking for existing app client '$APP_CLIENT_NAME'..."
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
  success "Reusing existing app client: $CLIENT_ID"
else
  info "Creating app client '$APP_CLIENT_NAME' (public, no secret)..."
  CREATE_CLIENT_OUTPUT=$(aws cognito-idp create-user-pool-client \
    --user-pool-id "$USER_POOL_ID" \
    --client-name "$APP_CLIENT_NAME" \
    --region "$REGION" \
    --no-generate-secret \
    --explicit-auth-flows \
      "ALLOW_USER_SRP_AUTH" \
      "ALLOW_REFRESH_TOKEN_AUTH" \
      "ALLOW_USER_PASSWORD_AUTH" \
    --supported-identity-providers "COGNITO" \
    --callback-urls "$CALLBACK_URL" \
    --logout-urls "$CALLBACK_URL" \
    --allowed-o-auth-flows "code" \
    --allowed-o-auth-scopes "email" "openid" "profile" \
    --allowed-o-auth-flows-user-pool-client \
    --enable-token-revocation \
    --prevent-user-existence-errors ENABLED \
    --access-token-validity 1 \
    --id-token-validity 1 \
    --refresh-token-validity 30 \
    --token-validity-units '{
      "AccessToken": "hours",
      "IdToken": "hours",
      "RefreshToken": "days"
    }' \
    --output json)

  CLIENT_ID=$(echo "$CREATE_CLIENT_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['UserPoolClient']['ClientId'])")
  success "App client created: $CLIENT_ID"
fi

# ------------------------------------------------------------------
# Create or verify the Cognito Domain
# ------------------------------------------------------------------
info "Setting up Cognito domain prefix '$DOMAIN_PREFIX'..."
EXISTING_DOMAIN=$(aws cognito-idp describe-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --region "$REGION" \
  --output json | python3 -c "
import sys, json
pool = json.load(sys.stdin)['UserPool']
print(pool.get('Domain', ''))
" 2>/dev/null || echo "")

if [[ -n "$EXISTING_DOMAIN" ]]; then
  warn "User pool already has domain: $EXISTING_DOMAIN"
  DOMAIN_PREFIX="$EXISTING_DOMAIN"
  success "Reusing existing domain: $DOMAIN_PREFIX"
else
  # Check if the domain prefix is available
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
    error "Domain prefix '$DOMAIN_PREFIX' is already taken by another account."
    error "Choose a different prefix with --domain-prefix"
    exit 1
  fi

  aws cognito-idp create-user-pool-domain \
    --user-pool-id "$USER_POOL_ID" \
    --domain "$DOMAIN_PREFIX" \
    --region "$REGION"

  success "Domain created: $DOMAIN_PREFIX"
fi

COGNITO_DOMAIN="${DOMAIN_PREFIX}.auth.${REGION}.amazoncognito.com"

# ------------------------------------------------------------------
# Optional: Create a test user
# ------------------------------------------------------------------
if [[ "$CREATE_TEST_USER" == true ]]; then
  echo ""
  info "Creating a test user..."
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

    success "Test user created and confirmed: $TEST_EMAIL"
  fi
fi

# ------------------------------------------------------------------
# Output
# ------------------------------------------------------------------
echo ""
echo "============================================================"
echo "  Cognito Deployment Complete"
echo "============================================================"
echo ""
echo "Add the following to your .env file:"
echo ""

ENV_BLOCK="VITE_COGNITO_USER_POOL_ID=${USER_POOL_ID}
VITE_COGNITO_CLIENT_ID=${CLIENT_ID}
VITE_COGNITO_REGION=${REGION}
VITE_COGNITO_DOMAIN=${DOMAIN_PREFIX}"

echo "$ENV_BLOCK"
echo ""
echo "------------------------------------------------------------"
echo "  Resources Created"
echo "------------------------------------------------------------"
echo "  User Pool ID:    $USER_POOL_ID"
echo "  App Client ID:   $CLIENT_ID"
echo "  Cognito Domain:  https://$COGNITO_DOMAIN"
echo "  Callback URL:    $CALLBACK_URL"
echo "  Region:          $REGION"
echo "------------------------------------------------------------"

# Write to file if requested
if [[ -n "$OUTPUT_ENV" ]]; then
  echo "$ENV_BLOCK" > "$OUTPUT_ENV"
  success "Environment variables written to: $OUTPUT_ENV"
fi

# Also update cognito-config.json in project root if it exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_ROOT/cognito-config.json"

if [[ -f "$CONFIG_FILE" ]]; then
  info "Updating $CONFIG_FILE..."
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
success "Done! Run your app with 'npm run dev' and sign in at http://localhost:3000"
