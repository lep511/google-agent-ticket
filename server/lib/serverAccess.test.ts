import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HOST,
  MIN_ACCESS_TOKEN_LENGTH,
  isAuthorizedRequest,
  isLoopbackHost,
  resolveServerBinding,
} from './serverAccess.ts';

const VALID_TOKEN = 'k'.repeat(MIN_ACCESS_TOKEN_LENGTH);

describe('isLoopbackHost', () => {
  it('recognises every loopback form', () => {
    for (const host of ['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', '::1', '[::1]']) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it('rejects addresses reachable from other hosts', () => {
    for (const host of ['0.0.0.0', '::', '10.0.0.223', '192.168.1.5', 'example.com', '']) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });
});

describe('resolveServerBinding', () => {
  it('binds to loopback and requires no token by default', () => {
    expect(resolveServerBinding({})).toEqual({
      ok: true,
      host: DEFAULT_HOST,
      exposed: false,
      accessToken: null,
      error: null,
    });
  });

  it('keeps a loopback bind inert even when a token is set', () => {
    expect(resolveServerBinding({ HOST: 'localhost', API_ACCESS_TOKEN: VALID_TOKEN })).toEqual({
      ok: true,
      host: 'localhost',
      exposed: false,
      accessToken: VALID_TOKEN,
      error: null,
    });
  });

  it('refuses a network bind without a token', () => {
    const result = resolveServerBinding({ HOST: '0.0.0.0' });
    expect(result.ok).toBe(false);
    expect(result.host).toBeNull();
    expect(result.error).toContain('0.0.0.0');
    expect(result.error).toContain('API_ACCESS_TOKEN');
  });

  it('refuses a network bind with a token that is too short', () => {
    const result = resolveServerBinding({ HOST: '0.0.0.0', API_ACCESS_TOKEN: 'short' });
    expect(result.ok).toBe(false);
    expect(result.host).toBeNull();
    expect(result.error).toContain(String(MIN_ACCESS_TOKEN_LENGTH));
  });

  it('allows a network bind with a usable token and turns the gate on', () => {
    expect(resolveServerBinding({ HOST: '0.0.0.0', API_ACCESS_TOKEN: VALID_TOKEN })).toEqual({
      ok: true,
      host: '0.0.0.0',
      exposed: true,
      accessToken: VALID_TOKEN,
      error: null,
    });
  });
});

describe('isAuthorizedRequest', () => {
  it('accepts the exact bearer token, whatever the scheme casing', () => {
    expect(isAuthorizedRequest(`Bearer ${VALID_TOKEN}`, VALID_TOKEN)).toBe(true);
    expect(isAuthorizedRequest(`bearer ${VALID_TOKEN}`, VALID_TOKEN)).toBe(true);
    expect(isAuthorizedRequest(`  Bearer   ${VALID_TOKEN}  `, VALID_TOKEN)).toBe(true);
  });

  it('rejects a missing, malformed or wrong credential', () => {
    const cases: unknown[] = [
      undefined,
      null,
      42,
      ['Bearer', VALID_TOKEN],
      '',
      VALID_TOKEN,
      `Basic ${VALID_TOKEN}`,
      `Bearer ${'k'.repeat(MIN_ACCESS_TOKEN_LENGTH - 1)}`,
      `Bearer ${'k'.repeat(MIN_ACCESS_TOKEN_LENGTH)}x`,
      `Bearer ${'x'.repeat(MIN_ACCESS_TOKEN_LENGTH)}`,
    ];

    for (const authorization of cases) {
      expect(isAuthorizedRequest(authorization, VALID_TOKEN), String(authorization)).toBe(false);
    }
  });

  it('never authorises when no token is configured', () => {
    expect(isAuthorizedRequest('Bearer anything', '')).toBe(false);
  });
});
