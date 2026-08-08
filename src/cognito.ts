import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
} from 'amazon-cognito-identity-js';
import cognitoConfig from '../cognito-config.json';

const userPoolId = import.meta.env?.VITE_COGNITO_USER_POOL_ID || cognitoConfig.userPoolId;
const clientId = import.meta.env?.VITE_COGNITO_CLIENT_ID || cognitoConfig.userPoolClientId;

const poolData = {
  UserPoolId: userPoolId,
  ClientId: clientId,
};

export const userPool = new CognitoUserPool(poolData);

export interface CognitoUserSession {
  userId: string;
  username: string;
  email?: string;
}

const TOKEN_KEYS = [
  'cognito_id_token',
  'cognito_access_token',
  'cognito_refresh_token',
] as const;

function clearStoredTokens(): void {
  TOKEN_KEYS.forEach((key) => localStorage.removeItem(key));
}

/**
 * Resolves the Cognito Hosted UI host name. The configured domain accepts three formats:
 *  1. Full URL:            https://my-domain.auth.us-east-1.amazoncognito.com
 *  2. Domain with suffix:  my-domain.auth.us-east-1.amazoncognito.com
 *  3. Domain prefix only:  my-domain
 */
function resolveHostedUIDomain(): string | null {
  const region = import.meta.env?.VITE_COGNITO_REGION || cognitoConfig.region || 'us-east-1';
  const domainInput =
    import.meta.env?.VITE_COGNITO_DOMAIN || (cognitoConfig as any).hostedUIDomain;

  if (!domainInput) return null;

  if (domainInput.startsWith('http://') || domainInput.startsWith('https://')) {
    return domainInput
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')
      .split('/')[0];
  }

  if (domainInput.includes('.auth.') && domainInput.includes('.amazoncognito.com')) {
    return domainInput.replace(/\/$/, '');
  }

  return `${domainInput}.auth.${region}.amazoncognito.com`;
}

function sessionFromIdToken(idToken: string): CognitoUserSession {
  const payload = JSON.parse(atob(idToken.split('.')[1]));
  return {
    userId: payload.sub,
    username: payload['cognito:username'] || payload.sub,
    email: payload.email,
  };
}

/** Redirects the user to the Cognito Hosted UI login page. */
export function signInWithHostedUI(): void {
  const domain = resolveHostedUIDomain();

  if (!domain) {
    console.error(
      'Cognito Hosted UI domain not configured. Add VITE_COGNITO_DOMAIN to your .env file or hostedUIDomain to cognito-config.json',
    );
    alert('Cognito Hosted UI domain not configured. Please check the console for details.');
    return;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'email openid profile',
    redirect_uri: window.location.origin,
  });

  const hostedUIUrl = `https://${domain}/login?${params.toString()}`;
  console.log('🔐 Redirecting to Cognito Hosted UI:', hostedUIUrl);
  window.location.href = hostedUIUrl;
}

/**
 * Handles the OAuth 2.0 Authorization Code callback: exchanges the `?code=`
 * query param for tokens, stores them and returns the authenticated user.
 */
export async function handleOAuthCallback(): Promise<CognitoUserSession | null> {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');

  if (!code) return null;

  // Guard against React StrictMode double-invocation reusing a one-time code.
  if (sessionStorage.getItem('processed_oauth_code') === code) {
    console.log('⚠️ Code already processed, skipping...');
    window.history.replaceState({}, document.title, window.location.pathname);
    return null;
  }
  sessionStorage.setItem('processed_oauth_code', code);

  try {
    const domain = resolveHostedUIDomain();
    if (!domain) {
      throw new Error('Cognito Hosted UI domain not configured');
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: window.location.origin,
    });

    console.log('🔄 Exchanging code for tokens...');
    const response = await fetch(`https://${domain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    // Clean the code out of the URL as soon as the request is away.
    window.history.replaceState({}, document.title, window.location.pathname);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Token exchange failed:', errorText);
      sessionStorage.removeItem('processed_oauth_code');

      // invalid_grant means the code was already redeemed or expired: not fatal.
      if (errorText.includes('invalid_grant')) {
        console.log('ℹ️ Code already used or expired - checking for existing session...');
        return null;
      }

      throw new Error(`Failed to exchange code for tokens: ${response.status} - ${errorText}`);
    }

    const tokens = await response.json();
    console.log('✅ Tokens received successfully');

    localStorage.setItem('cognito_id_token', tokens.id_token);
    localStorage.setItem('cognito_access_token', tokens.access_token);
    if (tokens.refresh_token) {
      localStorage.setItem('cognito_refresh_token', tokens.refresh_token);
    }

    const session = sessionFromIdToken(tokens.id_token);
    console.log('👤 Logged in as:', session.email || session.username);
    return session;
  } catch (error) {
    console.error('Error handling OAuth callback:', error);
    sessionStorage.removeItem('processed_oauth_code');
    window.history.replaceState({}, document.title, window.location.pathname);
    return null;
  }
}

/** Returns the active session, or null when the user is not signed in. */
export async function getCurrentCognitoUser(): Promise<CognitoUserSession | null> {
  // Prefer tokens obtained through the Hosted UI flow.
  const idToken = localStorage.getItem('cognito_id_token');

  if (idToken) {
    try {
      const payload = JSON.parse(atob(idToken.split('.')[1]));
      const now = Math.floor(Date.now() / 1000);

      if (payload.exp && payload.exp > now) {
        return sessionFromIdToken(idToken);
      }
      clearStoredTokens();
    } catch (error) {
      console.error('Error decoding token:', error);
      clearStoredTokens();
    }
  }

  // Fall back to a traditional User Pool (SRP) session.
  return new Promise((resolve) => {
    const currentUser = userPool.getCurrentUser();
    if (!currentUser) {
      return resolve(null);
    }

    currentUser.getSession((err: any, session: any) => {
      if (err || !session?.isValid()) {
        return resolve(null);
      }

      currentUser.getUserAttributes((attrErr, attributes) => {
        let email = currentUser.getUsername();
        if (!attrErr && attributes) {
          const emailAttr = attributes.find((a) => a.getName() === 'email');
          if (emailAttr) email = emailAttr.getValue();
        }
        resolve({
          userId: currentUser.getUsername(),
          username: currentUser.getUsername(),
          email,
        });
      });
    });
  });
}

export async function signUpWithCognito(
  email: string,
  password: string,
): Promise<{ isSignUpComplete: boolean }> {
  return new Promise((resolve, reject) => {
    const attributeList = [new CognitoUserAttribute({ Name: 'email', Value: email })];

    userPool.signUp(email, password, attributeList, [], (err, result) => {
      if (err) return reject(err);
      resolve({ isSignUpComplete: !!result?.userConfirmed });
    });
  });
}

export async function confirmSignUpWithCognito(
  email: string,
  code: string,
): Promise<{ isSignUpComplete: boolean }> {
  return new Promise((resolve, reject) => {
    const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });

    cognitoUser.confirmRegistration(code, true, (err, result) => {
      if (err) return reject(err);
      resolve({ isSignUpComplete: result === 'SUCCESS' });
    });
  });
}

export async function resendConfirmationCode(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });

    cognitoUser.resendConfirmationCode((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export async function signInWithCognito(
  email: string,
  password: string,
): Promise<{ isSignedIn: boolean }> {
  return new Promise((resolve, reject) => {
    const authenticationDetails = new AuthenticationDetails({
      Username: email,
      Password: password,
    });
    const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });

    cognitoUser.authenticateUser(authenticationDetails, {
      onSuccess: () => resolve({ isSignedIn: true }),
      onFailure: (err) => reject(err),
    });
  });
}

/** Clears local tokens and redirects to the Cognito logout endpoint. */
export async function signOutCognito(): Promise<void> {
  clearStoredTokens();
  sessionStorage.removeItem('processed_oauth_code');

  const currentUser = userPool.getCurrentUser();
  if (currentUser) {
    currentUser.signOut();
  }

  const domain = resolveHostedUIDomain();
  if (domain) {
    const logoutUrl = `https://${domain}/logout?client_id=${clientId}&logout_uri=${encodeURIComponent(
      window.location.origin,
    )}`;
    window.location.href = logoutUrl;
  }
}

/**
 * Returns the current valid ID token for API authorization, or null if
 * unavailable. Checks both the Hosted UI token and the SRP session.
 */
export async function getIdToken(): Promise<string | null> {
  const storedToken = localStorage.getItem('cognito_id_token');
  if (storedToken) {
    try {
      const payload = JSON.parse(atob(storedToken.split('.')[1]));
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp > now) return storedToken;
    } catch { /* fall through */ }
  }

  return new Promise((resolve) => {
    const currentUser = userPool.getCurrentUser();
    if (!currentUser) return resolve(null);

    currentUser.getSession((err: any, session: any) => {
      if (err || !session?.isValid()) return resolve(null);
      const token = session.getIdToken()?.getJwtToken();
      resolve(token || null);
    });
  });
}
