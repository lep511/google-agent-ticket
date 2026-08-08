# Cognito Setup for Tickr

This folder contains scripts to deploy, brand, and tear down an Amazon Cognito User Pool for the Tickr application using the **Managed Login** (new experience).

## How Cognito Is Used in This App

Tickr uses Amazon Cognito as its authentication layer. The flow works as follows:

1. **User clicks "Sign In"** — the app redirects to the Cognito Managed Login page.
2. **User authenticates** — via email/password sign-up or an existing account.
3. **Cognito redirects back** with an authorization code (`?code=...`).
4. **The app exchanges the code for tokens** — ID, access, and refresh tokens via the `/oauth2/token` endpoint.
5. **Session is maintained client-side** — tokens are stored in `localStorage` scoped per user; the ID token is sent to the backend for API authorization.

### Auth Flows Supported

| Flow | Description |
|------|-------------|
| **Managed Login (OAuth 2.0 Authorization Code)** | Primary flow. Redirects to Cognito's branded login page. No client secret (public client). |
| **SRP (Secure Remote Password)** | Fallback for in-app sign-in forms using `amazon-cognito-identity-js`. |
| **Sign-up with email verification** | Users register with email + password; a confirmation code is sent to verify the address. |

### Architecture Diagram

```
┌────────────┐     redirect      ┌──────────────────────────┐
│  Browser   │ ───────────────► │  Cognito Managed Login    │
│  (React)   │ ◄─────────────── │  (branded login/signup)   │
│            │    ?code=abc      └──────────────────────────┘
│            │                              │
│            │    POST /oauth2/token        │
│            │ ─────────────────────────────┘
│            │ ◄─── { id_token, access_token, refresh_token }
│            │
│            │    Authorization: Bearer <id_token>
│            │ ────────────────────────────────────────►  ┌──────────┐
│            │                                            │  Express │
└────────────┘                                            │  Server  │
                                                          └──────────┘
```

### Key Files in the App

| File | Role |
|------|------|
| `src/cognito.ts` | All Cognito logic: sign-in, sign-up, token handling, OAuth callback, `getIdToken()` |
| `cognito-config.json` | Fallback config (used if env vars are not set) |
| `.env` | Primary source of Cognito configuration at runtime |
| `server/lib/cognitoAuth.ts` | Backend JWT verification middleware (`aws-jwt-verify`) |

## Prerequisites

- **AWS CLI v2** — [Installation guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- **Configured AWS credentials** — via `aws configure`, `aws sso login`, or environment variables
- **IAM permissions** — `cognito-idp:*` (or scoped: `Create*`, `Describe*`, `Update*`, `Delete*`, `AdminCreateUser`, `AdminSetUserPassword`, `CreateManagedLoginBranding`, `UpdateManagedLoginBranding`)

## Quick Start

```bash
cd cognito_setup

# Full deployment: pool + client + domain + branding + test user
./deploy.sh --apply-branding --create-test-user

# With a Vercel production URL
./deploy.sh \
  --apply-branding \
  --create-test-user \
  --extra-callback-url https://your-app.vercel.app

# Deploy with all custom options
./deploy.sh \
  --region us-west-2 \
  --pool-name my-tickr-pool \
  --domain-prefix my-tickr-auth \
  --callback-url http://localhost:3000 \
  --extra-callback-url https://myapp.example.com \
  --apply-branding \
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
| `--callback-url` | `http://localhost:3000` | Primary OAuth callback URL |
| `--extra-callback-url` | None | Additional callback URL (repeatable, e.g. Vercel production URL) |
| `--app-name` | `tickr-web-client` | Name of the app client |
| `--create-test-user` | Off | Interactively create a confirmed test user |
| `--apply-branding` | Off | Run `brand.sh` after deployment to apply Tickr theme |
| `--output-env FILE` | Stdout only | Write env vars to a file |

### `brand.sh`

Applies Tickr branding to the **Cognito Managed Login** (new experience). This uses the `CreateManagedLoginBranding` / `UpdateManagedLoginBranding` API with a structured JSON settings file.

Requires the **Essentials** or **Plus** feature plan (the deploy script creates pools on Essentials by default).

```bash
# Apply the Tickr theme
./brand.sh

# Apply with a custom logo
./brand.sh --logo ../public/tickr-logo.png

# Reset to Cognito defaults
./brand.sh --reset

# Use a custom settings file
./brand.sh --settings my-theme.json
```

| Option | Default | Description |
|--------|---------|-------------|
| `--region` | `us-east-1` | AWS region |
| `--pool-id` | Auto-detected | User pool ID (reads from cognito-config.json) |
| `--client-id` | Auto-detected | App client ID (reads from cognito-config.json) |
| `--settings FILE` | `managed-login-settings.json` | Branding settings JSON |
| `--logo FILE` | None | Logo image (PNG/SVG/JPG/ICO) |
| `--reset` | Off | Reset to Cognito default branding |

The settings file (`managed-login-settings.json`) configures all visual components:
- **Page background**: `#F6F4F0` (warm cream in light mode)
- **Primary button**: `#0b5a4b` (dark teal) with hover/active states
- **Secondary button**: white with stone borders
- **Form container**: white, 12px rounded corners
- **Inputs**: 8px radius, stone borders, teal focus ring
- **Links**: `#0b5a4b` teal (matching the app accent)
- **Alerts/errors**: `#CC3131` red
- **Text**: stone palette (headings, body, descriptions)
- **Dark mode**: full stone-900 palette with emerald accents

Edit `managed-login-settings.json` and re-run `./brand.sh` to update. The JSON maps directly to the Cognito branding editor components.

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

1. **User Pool** (Essentials tier) — configured with:
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

3. **Cognito Domain** (Managed Login v2) — the branded login page:
   `https://<prefix>.auth.<region>.amazoncognito.com`

4. **Managed Login Branding** (optional, with `--apply-branding`) — full theme matching the app's design system via the `CreateManagedLoginBranding` API.

## Production Considerations

### Security

- **Enable MFA** — add `--mfa-configuration ON` with TOTP or SMS
- **Shorter refresh tokens** — reduce from 30 days to 7 for sensitive apps
- **PKCE** — the app uses authorization code grant; add PKCE (`code_challenge`) for defense-in-depth
- **Custom domain** — use your own domain (e.g., `auth.yourapp.com`) with an ACM certificate in us-east-1
- **Backend JWT verification** — already implemented in `server/lib/cognitoAuth.ts` using `aws-jwt-verify`

### Multiple Environments

```bash
# Development
./deploy.sh --pool-name tickr-dev --domain-prefix tickr-dev-123 \
  --callback-url http://localhost:3000 --apply-branding

# Production
./deploy.sh --pool-name tickr-prod --domain-prefix tickr-prod-123 \
  --callback-url https://app.tickr.io --apply-branding
```

### Adding Social Login (Google, GitHub)

After deploying the base pool, configure an identity provider:

```bash
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
| `redirect_mismatch` after login | The callback URL must exactly match your app's origin. Use `--extra-callback-url` for additional origins (e.g. Vercel). |
| "Domain already exists" | Domain prefixes are globally unique. Choose a different `--domain-prefix`. |
| Users stuck as UNCONFIRMED | Use `--create-test-user` which auto-confirms, or have users check spam for the verification code. |
| Token expired errors in app | Access tokens are valid for 1 hour. The app's `getIdToken()` handles both Hosted UI and SRP tokens. |
| Script fails on re-run | The script is idempotent — detects existing resources and reuses them. It also updates callback URLs on re-runs. |
| Old login page showing | Ensure the domain uses Managed Login v2. Re-run `deploy.sh` — it upgrades existing domains automatically. |
| Branding not applied | Requires Essentials or Plus tier. Check with `aws cognito-idp describe-user-pool --query 'UserPool.UserPoolTier'`. |
