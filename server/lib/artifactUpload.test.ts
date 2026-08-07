import { describe, expect, it } from 'vitest';
import path from 'path';
import fc from 'fast-check';

import {
  ARTIFACT_NAME_MAX_LENGTH,
  DEFAULT_ARTIFACT_NAME,
  resolveArtifactFileName,
  resolveArtifactPath,
} from './artifactUpload.ts';

const ARTIFACTS_DIR = '/srv/app/workspace/artifacts';

describe('resolveArtifactFileName', () => {
  it('falls back to the default name when no name is provided', () => {
    for (const raw of [undefined, null, '']) {
      expect(resolveArtifactFileName(raw)).toEqual({
        ok: true,
        fileName: DEFAULT_ARTIFACT_NAME,
        rejection: null,
      });
    }
  });

  it('accepts plain file names', () => {
    for (const raw of ['report.json', 'podcast_briefing.wav', 'a', 'A-1_b.2.wav']) {
      expect(resolveArtifactFileName(raw)).toEqual({ ok: true, fileName: raw, rejection: null });
    }
  });

  it('rejects every traversal and separator form', () => {
    const attacks = [
      '../../server.ts',
      '..',
      '.',
      './server.ts',
      'sub/dir.wav',
      'sub\\dir.wav',
      '/etc/passwd',
      'C:\\Windows\\win.ini',
      'report.json\u0000.wav',
      '.env',
      '.gitignore',
      'a b.wav',
      'ré.wav',
    ];

    for (const raw of attacks) {
      const result = resolveArtifactFileName(raw);
      expect(result.ok, `expected "${raw}" to be rejected`).toBe(false);
      expect(result.fileName).toBeNull();
      expect(result.rejection?.status).toBe(400);
      expect(result.rejection?.body.code).toBe('invalid_artifact_name_format');
    }
  });

  it('rejects a repeated query parameter, which Express delivers as an array', () => {
    const result = resolveArtifactFileName(['a', 'b']);
    expect(result.ok).toBe(false);
    expect(result.rejection?.body).toEqual({
      error: 'The "name" parameter must be a single string value.',
      code: 'invalid_artifact_name_type',
      param: 'name',
    });
  });

  it('rejects a name longer than the limit', () => {
    const result = resolveArtifactFileName('a'.repeat(ARTIFACT_NAME_MAX_LENGTH + 1));
    expect(result.ok).toBe(false);
    expect(result.rejection?.body.code).toBe('artifact_name_too_long');
  });

  it('accepts a name exactly at the limit', () => {
    const raw = 'a'.repeat(ARTIFACT_NAME_MAX_LENGTH);
    expect(resolveArtifactFileName(raw).ok).toBe(true);
  });
});

describe('resolveArtifactPath', () => {
  it('resolves an accepted name inside the artifacts directory', () => {
    expect(resolveArtifactPath(ARTIFACTS_DIR, 'report.json', path.posix)).toEqual({
      ok: true,
      fileName: 'report.json',
      absolutePath: '/srv/app/workspace/artifacts/report.json',
      rejection: null,
    });
  });

  it('never resolves outside the artifacts directory for any accepted name', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,40}$/), (name) => {
        const result = resolveArtifactPath(ARTIFACTS_DIR, name, path.posix);
        // Every name matching the allow-list resolves, and stays under the root.
        expect(result.ok).toBe(true);
        expect(result.absolutePath?.startsWith(`${ARTIFACTS_DIR}/`)).toBe(true);
        expect(result.absolutePath?.includes('/..')).toBe(false);
      }),
    );
  });

  it('propagates the name failure instead of building a path', () => {
    const result = resolveArtifactPath(ARTIFACTS_DIR, '../../server.ts', path.posix);
    expect(result.ok).toBe(false);
    expect(result.absolutePath).toBeNull();
    expect(result.rejection?.body.code).toBe('invalid_artifact_name_format');
  });
});
