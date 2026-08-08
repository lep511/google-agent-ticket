# Cognito Setup for Tickr

This folder contains scripts to deploy and tear down an Amazon Cognito User Pool for the Tickr application.

## How Cognito Is Used in This App

Tickr uses Amazon Cognito as its authentication layer. The flow works as follows:

1. **User clicks "Sign In"** — the app redirects to the Cognito Hosted UI (managed login page).
2. **User authenticates** — via email/password sign-up or an existing account.
3. **Cognito redirects back** with an authorization code (`?code=...`).
4. **The app exchanges the code for tokens** — ID, access, and refresh tokens via the `/oauth2/token` endpoint.
5. **Session is maintained client-side** — tokens are stored in `localStorage`; the ID token is decoded to display user info.

### Auth Flows Supported

| Flow | Description |
|------|-------------|
| **Hosted UI (OAuth 2.0 Authorization Code)** | Primary flow. Redirects to Cognito's managed login page. No client secret (public client). |
| **SRP (Secure Remote Password)** | Fallback for in-app sign-in forms using `amazon-cognito-identity-js`. |
| **Sign-up with email verification** | Users register with email + password; a confirmation code is sent to verify the address. |

### Architecture Diagram

```
┌────────────┐     redirect      ┌─────────────────────┐
│  Browser   │ ───────────────► │  Cognito Hosted UI   │
│  (React)   │ ◄─────────────── │  (login/signup page) │
│            │    ?code=abc      └─────────────────────┘
│            │                              │
│            │    POST /oauth2/token        │
│            │ ─────────────────────────────┘
│            │ ◄─── { id_token, access_token, refresh_token }
│            │
│            │    Authorization: Bearer <token>
│            │ ────────────────────────────────────────►  ┌──────────┐
│            │                                            │  Express │
└────────────┘                                            │  Server  │
                                                          └──────────┘
```

### Key Files in the App

| File | Role |
|------|------|
| `src/cognito.ts` | All Cognito logic: sign-in, sign-up, token handling, OAuth callback |
| `cognito-config.json` | Fallback config (used if env vars are not set) |
| `.env` | Primary source of Cognito configuration at runtime |

## Prerequisites

- **AWS CLI v2** — [Installation guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- **Configured AWS credentials** — via `aws configure`, `aws sso login`, or environment variables
- **IAM permissions** — the caller needs `cognito-idp:*` on the account (or a scoped policy for `Create*`, `Describe*`, `Update*`, `Delete*`, `AdminCreateUser`, `AdminSetUserPassword`)

## Quick Start

```bash
cd cognito_setup

# Deploy with defaults (us-east-1, auto-generated domain prefix)
./deploy.sh

# Deploy with custom options
./deploy.sh \
  --region us-west-2 \
  --pool-name my-tickr-pool \
  --domain-prefix my-tickr-auth \
  --callback-url https://myapp.example.com \
  --create-test-user \
  --output-env ../.env.cognito
```

The script will print the values to add to your `.env`:

```
VITE_COGNITO_USER_POOL_ID=us-east-1_AbCdEfGhI
VITE_COGNITO_CLIENT_ID=1a2b3c4d5e6f7g8h9i0j
VITE_COGNITO_REGION=us-east-1
VITE_COGNITO_DOMAIN=tickr-123456
```

## Script Options

### `deploy.sh`

| Option | Default | Description |
|--------|---------|-------------|
| `--region` | `us-east-1` | AWS region for the user pool |
| `--pool-name` | `tickr-user-pool` | Name of the Cognito user pool |
| `--domain-prefix` | Auto-generated | Cognito domain prefix (must be globally unique) |
| `--callback-url` | `http://localhost:3000` | OAuth callback URL (your app's origin) |
| `--app-name` | `tickr-web-client` | Name of the app client |
| `--create-test-user` | Off | Interactively create a confirmed test user |
| `--output-env FILE` | Stdout only | Write env vars to a file |

### `brand.sh`

Applies custom CSS (and optionally a logo) to the Cognito Hosted UI so the login page matches the app's visual design.

```bash
# Apply the default Tickr theme
./brand.sh

# Apply with a custom logo
./brand.sh --logo ../public/tickr-logo.png

# Reset to Cognito defaults
./brand.sh --reset
```

| Option | Default | Description |
|--------|---------|-------------|
| `--region` | `us-east-1` | AWS region |
| `--pool-id` | Auto-detected | User pool ID (reads from cognito-config.json) |
| `--client-id` | Auto-detected | App client ID (reads from cognito-config.json) |
| `--css FILE` | `hosted-ui.css` | Custom CSS file to upload |
| `--logo FILE` | None | Logo image (PNG/JPG, max 100KB) |
| `--reset` | Off | Remove all customizations |

The CSS file (`hosted-ui.css`) is pre-configured to match Tickr's design:
- Warm cream background (`#F6F4F0`)
- Dark teal primary buttons (`#0b5a4b`)
- System sans-serif font stack
- Rounded inputs with subtle borders
- Error messages in the app's red (`#CC3131`)

Edit `hosted-ui.css` and re-run `./brand.sh` to update styles.

### `teardown.sh`

Removes all Cognito resources created by `deploy.sh`.

```bash
# Interactive confirmation
./teardown.sh

# Skip confirmation
./teardown.sh --force

# Target a specific pool
./teardown.sh --pool-name my-tickr-pool --region us-west-2
```

| Option | Default | Description |
|--------|---------|-------------|
| `--region` | `us-east-1` | AWS region |
| `--pool-name` | `tickr-user-pool` | Name of the pool to delete |
| `--force` | Off | Skip the confirmation prompt |

## What Gets Created

The `deploy.sh` script creates:

1. **User Pool** — configured with:
   - Email as the username attribute (case-insensitive)
   - Email auto-verification
   - Password policy: 8+ chars, upper + lower + number
   - Account recovery via verified email
   - Deletion protection enabled

2. **App Client** (public, no secret) — configured with:
   - Auth flows: SRP, refresh token, user-password
   - OAuth: authorization code grant with `email openid profile` scopes
   - Token validity: 1h access/ID, 30d refresh
   - Token revocation enabled
   - User-existence error prevention enabled

3. **Cognito Domain** — the hosted UI login page URL:
   `https://<prefix>.auth.<region>.amazoncognito.com`

## Production Considerations

For a production deployment, consider these enhancements:

### Security

- **Enable MFA** — add `--mfa-configuration ON` with TOTP or SMS
- **Shorter refresh tokens** — reduce from 30 days to 7 for sensitive apps
- **PKCE** — the app uses authorization code grant; add PKCE (`code_challenge`) for defense-in-depth (prevents code interception)
- **Custom domain** — use your own domain (e.g., `auth.yourapp.com`) with an ACM certificate in us-east-1

### Multiple Environments

Run `deploy.sh` once per environment with different `--pool-name` and `--domain-prefix`:

```bash
# Development
./deploy.sh --pool-name tickr-dev --domain-prefix tickr-dev-123 --callback-url http://localhost:3000

# Production
./deploy.sh --pool-name tickr-prod --domain-prefix tickr-prod-123 --callback-url https://app.tickr.io
```

### Adding Social Login (Google, GitHub)

After deploying the base pool, configure an identity provider:

```bash
# Example: Add Google
aws cognito-idp create-identity-provider \
  --user-pool-id <your-pool-id> \
  --provider-name Google \
  --provider-type Google \
  --provider-details '{
    "client_id": "<google-client-id>",
    "client_secret": "<google-client-secret>",
    "authorize_scopes": "email profile openid"
  }' \
  --attribute-mapping '{"email": "email", "username": "sub"}'
```

Then update the app client to include Google as a supported identity provider.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `redirect_mismatch` after login | The callback URL in Cognito must exactly match your app's origin (including scheme and port). Re-run `deploy.sh` with the correct `--callback-url`. |
| "Domain already exists" | Domain prefixes are globally unique. Choose a different `--domain-prefix`. |
| Users stuck as UNCONFIRMED | Use `--create-test-user` which auto-confirms, or have users check spam for the verification code. |
| Token expired errors in app | Access tokens are valid for 1 hour. The app should handle refresh or re-login. |
| Script fails on re-run | The script is idempotent — it detects existing resources and reuses them. If a partial run left orphaned resources, use `teardown.sh` and re-deploy. |
