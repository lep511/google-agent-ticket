/**
 * Network exposure and access control of the Express server.
 *
 * The server used to call `app.listen(PORT, "0.0.0.0")` while no route checked
 * any credential, so every `/api/*` route — including the artifact upload and
 * the Gemini-backed `/api/analyze` — was reachable from the local network by
 * anyone.
 *
 * Two rules replace that:
 *  1. the default bind address is loopback, so a plain `npm run dev` is not
 *     reachable from outside the machine;
 *  2. binding to any other address is only allowed when `API_ACCESS_TOKEN` is
 *     set, and that token is then required on every non-public route.
 *
 * This is a fail-safe gate, not user authentication: the Cognito identity the
 * frontend obtains is still not verified server side.
 */
import { timingSafeEqual } from 'crypto';

/** Address used when `HOST` is not set. */
export const DEFAULT_HOST = '127.0.0.1';

/** Minimum length of `API_ACCESS_TOKEN`, so an exposed server cannot use a trivial one. */
export const MIN_ACCESS_TOKEN_LENGTH = 32;

/** Host names that only ever resolve to the local machine. */
const LOOPBACK_NAMES = new Set(['localhost', '::1', '[::1]', '::ffff:127.0.0.1']);

/**
 * Reports whether a bind address keeps the server unreachable from other hosts.
 * The whole `127.0.0.0/8` range counts, and so does the IPv6 loopback.
 */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (normalized === '') {
    return false;
  }
  if (LOOPBACK_NAMES.has(normalized)) {
    return true;
  }
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized);
}

export interface ServerBindingResolution {
  ok: boolean;
  /** Address to bind to, or `null` when the configuration was refused. */
  host: string | null;
  /** True when the host is reachable from other machines, which forces the token gate on. */
  exposed: boolean;
  /** Token required on non-public routes, or `null` when none applies. */
  accessToken: string | null;
  /** Reason the configuration was refused, or `null` when it is usable. */
  error: string | null;
}

/**
 * Resolves the bind address and the access control derived from it.
 *
 * Refuses a non-loopback address without a usable `API_ACCESS_TOKEN`, so
 * exposing the server on a network is always a deliberate act.
 */
export function resolveServerBinding(env: NodeJS.ProcessEnv): ServerBindingResolution {
  const host = (env.HOST ?? DEFAULT_HOST).trim() || DEFAULT_HOST;
  const token = env.API_ACCESS_TOKEN?.trim() ?? '';
  const exposed = !isLoopbackHost(host);

  if (!exposed) {
    // A loopback server keeps the existing frictionless dev workflow: the token
    // is carried through when present but nothing is required.
    return {
      ok: true,
      host,
      exposed: false,
      accessToken: token.length > 0 ? token : null,
      error: null,
    };
  }

  if (token.length === 0) {
    return {
      ok: false,
      host: null,
      exposed: true,
      accessToken: null,
      error:
        `Refusing to bind to "${host}": that address is reachable from other hosts and no ` +
        'API_ACCESS_TOKEN is set. Unset HOST to bind to 127.0.0.1, or set API_ACCESS_TOKEN ' +
        `to a secret of at least ${MIN_ACCESS_TOKEN_LENGTH} characters.`,
    };
  }

  if (token.length < MIN_ACCESS_TOKEN_LENGTH) {
    return {
      ok: false,
      host: null,
      exposed: true,
      accessToken: null,
      error:
        `Refusing to bind to "${host}": API_ACCESS_TOKEN must be at least ` +
        `${MIN_ACCESS_TOKEN_LENGTH} characters long, got ${token.length}.`,
    };
  }

  return { ok: true, host, exposed: true, accessToken: token, error: null };
}

/**
 * Compares the `Authorization` header against the expected token.
 *
 * Only the `Bearer` scheme is accepted, and the comparison is length-checked
 * first and then constant time, so a wrong token does not leak its content
 * through the response timing.
 */
export function isAuthorizedRequest(authorization: unknown, expectedToken: string): boolean {
  if (expectedToken.length === 0 || typeof authorization !== 'string') {
    return false;
  }

  const match = /^Bearer[ \t]+(.+)$/i.exec(authorization.trim());
  if (match === null) {
    return false;
  }

  const provided = Buffer.from(match[1].trim(), 'utf8');
  const expected = Buffer.from(expectedToken, 'utf8');
  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}
