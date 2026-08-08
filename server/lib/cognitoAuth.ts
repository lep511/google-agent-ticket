/**
 * Cognito JWT verification middleware.
 *
 * Validates the ID token from the Authorization header against the configured
 * Cognito user pool. Only authenticated users can access protected routes.
 */

import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { Request, Response, NextFunction } from 'express';

export interface AuthenticatedRequest extends Request {
  user?: {
    sub: string;
    email?: string;
    username?: string;
  };
}

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

function getVerifier() {
  if (verifier) return verifier;

  const userPoolId = process.env.VITE_COGNITO_USER_POOL_ID;
  const clientId = process.env.VITE_COGNITO_CLIENT_ID;

  if (!userPoolId || !clientId) {
    return null;
  }

  verifier = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: 'id',
    clientId,
  });

  return verifier;
}

/**
 * Express middleware that requires a valid Cognito ID token.
 *
 * Expects: `Authorization: Bearer <id_token>`
 *
 * On success, attaches `req.user` with the token claims.
 * On failure, responds with 401.
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const jwtVerifier = getVerifier();

  if (!jwtVerifier) {
    // Cognito not configured — skip auth (local dev without Cognito)
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Authentication required. Please sign in.',
      code: 'auth_required',
    });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = await jwtVerifier.verify(token);
    req.user = {
      sub: payload.sub,
      email: payload.email as string | undefined,
      username: (payload['cognito:username'] as string) || payload.sub,
    };
    next();
  } catch (error: any) {
    const message = error?.message || 'Invalid token';
    const isExpired = message.includes('expired') || message.includes('exp');
    res.status(401).json({
      error: isExpired
        ? 'Session expired. Please sign in again.'
        : 'Invalid authentication token.',
      code: isExpired ? 'token_expired' : 'invalid_token',
    });
  }
}
