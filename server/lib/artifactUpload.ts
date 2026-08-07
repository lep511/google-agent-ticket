/**
 * Validation of the artifact file name accepted by `POST /api/upload_artifact`.
 *
 * The endpoint used to pass `req.query.name` straight into `path.join`, so a
 * name such as `../../server.ts` escaped `workspace/artifacts` and let an
 * unauthenticated caller overwrite any file the server process can write.
 *
 * The name is now validated against an allow-list instead of being sanitized:
 * anything that is not a plain file name is rejected, and the resolved absolute
 * path is verified to stay inside the artifacts directory as a second barrier.
 *
 * The result shape follows the same convention as `analyzeInput.ts` and
 * `runLogDownload.ts`: a flat object with `ok` plus a nullable `rejection` the
 * caller checks, so it narrows correctly under this project's `tsconfig`.
 */
import nodePath from 'path';

/** Name used when the caller does not provide one. */
export const DEFAULT_ARTIFACT_NAME = 'podcast_briefing.wav';

/** Upper bound of the file name, so a name cannot exhaust the file system. */
export const ARTIFACT_NAME_MAX_LENGTH = 128;

/** Query parameter carrying the file name. */
export const ARTIFACT_NAME_PARAM = 'name';

/**
 * Accepted shape of a file name: letters, digits, dot, dash and underscore.
 * Path separators, `..`, NUL bytes and every other character are excluded by
 * construction, and the first character cannot be a dot, so a name can never
 * become a dotfile.
 */
const SAFE_ARTIFACT_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export type ArtifactUploadErrorCode =
  | 'invalid_artifact_name_type'
  | 'invalid_artifact_name_format'
  | 'artifact_name_too_long'
  | 'artifact_path_escapes_directory';

export interface ArtifactUploadErrorBody {
  error: string;
  code: ArtifactUploadErrorCode;
  param: typeof ARTIFACT_NAME_PARAM;
}

export interface ArtifactUploadRejection {
  status: 400;
  body: ArtifactUploadErrorBody;
}

export interface ArtifactNameValidation {
  ok: boolean;
  /** Accepted file name, or `null` when the name was rejected. */
  fileName: string | null;
  rejection: ArtifactUploadRejection | null;
}

export interface ArtifactPathResolution extends ArtifactNameValidation {
  /** Absolute path inside the artifacts directory, or `null` when rejected. */
  absolutePath: string | null;
}

function reject(code: ArtifactUploadErrorCode, error: string): ArtifactNameValidation {
  return {
    ok: false,
    fileName: null,
    rejection: { status: 400, body: { error, code, param: ARTIFACT_NAME_PARAM } },
  };
}

/**
 * Resolves the file name of an upload from the raw query value.
 *
 * `undefined` and an empty string fall back to {@link DEFAULT_ARTIFACT_NAME}.
 * A repeated query parameter (`?name=a&name=b`) arrives as an array and is
 * rejected instead of crashing `path.join` with `ERR_INVALID_ARG_TYPE`.
 */
export function resolveArtifactFileName(raw: unknown): ArtifactNameValidation {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, fileName: DEFAULT_ARTIFACT_NAME, rejection: null };
  }

  if (typeof raw !== 'string') {
    return reject(
      'invalid_artifact_name_type',
      'The "name" parameter must be a single string value.',
    );
  }

  if (raw.length > ARTIFACT_NAME_MAX_LENGTH) {
    return reject(
      'artifact_name_too_long',
      `The "name" parameter must be at most ${ARTIFACT_NAME_MAX_LENGTH} characters long.`,
    );
  }

  if (!SAFE_ARTIFACT_NAME.test(raw)) {
    return reject(
      'invalid_artifact_name_format',
      'The "name" parameter only accepts A-Z, a-z, 0-9, ".", "-" and "_", and cannot start with ".".',
    );
  }

  return { ok: true, fileName: raw, rejection: null };
}

/**
 * Shape of the `path` module this helper needs, so the containment check can be
 * exercised against both POSIX and Windows semantics without depending on the
 * host platform.
 */
export type PathModule = Pick<typeof nodePath, 'join' | 'resolve' | 'sep'>;

/**
 * Resolves the absolute path an upload may be written to.
 *
 * `join` and `resolve` run only after the name has been accepted, and the result
 * is checked against the artifacts directory so any future loosening of the
 * allow-list still cannot produce a path outside it.
 */
export function resolveArtifactPath(
  artifactsDir: string,
  raw: unknown,
  pathModule: PathModule = nodePath,
): ArtifactPathResolution {
  const name = resolveArtifactFileName(raw);
  if (name.rejection !== null) {
    return { ...name, absolutePath: null };
  }

  const root = pathModule.resolve(artifactsDir);
  const absolutePath = pathModule.resolve(pathModule.join(root, name.fileName as string));

  if (absolutePath === root || !absolutePath.startsWith(root + pathModule.sep)) {
    return {
      ...reject(
        'artifact_path_escapes_directory',
        'The "name" parameter resolves outside the artifacts directory.',
      ),
      absolutePath: null,
    };
  }

  return { ok: true, fileName: name.fileName, absolutePath, rejection: null };
}
