/**
 * Validación de manifiestos y aplicación de valores por defecto.
 *
 * Toma una carpeta ya descubierta (`DiscoveredAgentFolder`) y devuelve, o bien
 * la definición resuelta del agente (manifiesto normalizado + rutas de disco),
 * o bien exactamente una advertencia que explica por qué se omite la carpeta.
 *
 * Reglas que aplica:
 *  - Los campos obligatorios se validan en el orden declarado, de modo que la
 *    advertencia nombra el primer campo causante (Requirement 2.5).
 *  - `inputMode`, `outputRenderer` e `icon` se comparan de forma exacta contra
 *    sus valores permitidos y contra la lista blanca de iconos (2.2, 2.3, 16.4).
 *  - `id` debe coincidir carácter a carácter con el nombre de la carpeta (1.3).
 *  - `AGENTS.md`, el archivo de prompt y el de esquema deben existir, ser
 *    legibles y no estar vacíos, y el esquema debe contener JSON válido (2.4).
 *  - Los campos opcionales omitidos toman su valor por defecto, y los que
 *    llegan con un tipo incorrecto degradan a ese valor conservando la entrada
 *    y registrando una advertencia (2.6, 2.7).
 *  - Cualquier excepción se captura: la carpeta se omite con una advertencia y
 *    el resto del catálogo continúa (2.8, 2.9).
 *
 
 */

import fs from 'node:fs';
import path from 'node:path';

import type {
  AgentRegistryLogger,
  AgentRegistryWarning,
  DiscoveredAgentFolder,
} from './agentRegistry.ts';
import {
  AGENTS_FILE_NAME,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_MODEL_NAME,
  DEFAULT_MODEL_PROVIDER,
  DEFAULT_ORDER,
  DEFAULT_TOOLS,
  FIELD_MAX_LENGTHS,
  MANIFEST_DEFAULTS,
  ORDER_MAX,
  ORDER_MIN,
  isAllowedIconName,
  isInputMode,
  isModelProvider,
  isOutputRenderer,
  type AgentLanding,
  type AgentLandingHighlight,
  type AgentLandingHighlightGroup,
  type AgentManifest,
  type AgentPaths,
  type ModelProviderType,
  type ResolvedAgentDefinition,
} from './agentTypes.ts';
import { isKnownToolName } from '../tools/toolRegistry.ts';

/* ────────────────────────────────────────────────────────── */
/*  Advertencias                                               */
/* ────────────────────────────────────────────────────────── */

/** Motivos por los que la validación descarta una carpeta o degrada un campo. */
export type AgentManifestWarningCode =
  | 'invalid_manifest_json'
  | 'missing_required_field'
  | 'invalid_field_value'
  | 'id_folder_mismatch'
  | 'missing_required_file'
  | 'unreadable_required_file'
  | 'empty_required_file'
  | 'invalid_schema_json'
  | 'invalid_optional_field'
  | 'order_out_of_range'
  | 'validation_exception';

/* ────────────────────────────────────────────────────────── */
/*  Resultado                                                  */
/* ────────────────────────────────────────────────────────── */

export interface ManifestValidationSuccess {
  ok: true;
  definition: ResolvedAgentDefinition;
  /** Degradaciones de campos opcionales; la entrada se conserva (2.7). */
  warnings: AgentRegistryWarning[];
}

export interface ManifestValidationFailure {
  ok: false;
  /** Exactamente una advertencia con la ruta relativa y la causa (2.5). */
  warnings: [AgentRegistryWarning];
}

export type ManifestValidationResult = ManifestValidationSuccess | ManifestValidationFailure;

export interface AgentValidationResult {
  /** Definiciones válidas, en el mismo orden en que llegaron las carpetas. */
  definitions: ResolvedAgentDefinition[];
  warnings: AgentRegistryWarning[];
}

/* ────────────────────────────────────────────────────────── */
/*  Campos obligatorios                                       */
/* ────────────────────────────────────────────────────────── */

/**
 * Campos obligatorios en el orden en que se validan: la advertencia de una
 * carpeta descartada nombra el primero que falla (Requirement 2.5).
 */
export const REQUIRED_STRING_FIELDS = [
  'id',
  'name',
  'tagline',
  'description',
  'icon',
  'inputMode',
  'inputPlaceholder',
  'actionLabel',
  'outputRenderer',
] as const;

export type RequiredStringField = (typeof REQUIRED_STRING_FIELDS)[number];

/** Nombres de archivo admitidos en `promptFile` y `schemaFile`. */
const SAFE_FILE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Color hexadecimal con 3, 4, 6 u 8 dígitos. */
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Longitud máxima admitida en `accentColor`. */
const MAX_ACCENT_COLOR_LENGTH = 32;

/* ────────────────────────────────────────────────────────── */
/*  Utilidades internas                                        */
/* ────────────────────────────────────────────────────────── */

/** Error interno que transporta el código de advertencia hasta el llamador. */
class ManifestValidationError extends Error {
  constructor(
    readonly code: AgentManifestWarningCode,
    message: string,
  ) {
    super(message);
    this.name = 'ManifestValidationError';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Devuelve la cadena recortada, o `null` si no es una cadena con contenido. */
function trimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function isSafeFileName(value: string): boolean {
  return value !== '.' && value !== '..' && SAFE_FILE_NAME_PATTERN.test(value);
}

/* ────────────────────────────────────────────────────────── */
/*  Normalización de `order`                                   */
/* ────────────────────────────────────────────────────────── */

/** Resultado de normalizar `order`: valor aplicado y motivo de la degradación. */
export interface OrderNormalization {
  order: number;
  degraded: 'none' | 'omitted' | 'type' | 'range';
}

/**
 * Interpreta `order` como entero entre 0 y 9999, aplicando 100 cuando falta,
 * no es un entero o queda fuera de rango (Requirement 1.7).
 */
export function normalizeOrder(value: unknown): OrderNormalization {
  if (value === undefined || value === null) return { order: DEFAULT_ORDER, degraded: 'omitted' };
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return { order: DEFAULT_ORDER, degraded: 'type' };
  }
  if (!Number.isInteger(value) || value < ORDER_MIN || value > ORDER_MAX) {
    return { order: DEFAULT_ORDER, degraded: 'range' };
  }
  return { order: value, degraded: 'none' };
}

/* ────────────────────────────────────────────────────────── */
/*  Vista de aterrizaje                                        */
/* ────────────────────────────────────────────────────────── */

/**
 * Normaliza el bloque `landing`. Devuelve `null` cuando su forma no encaja con
 * el contrato, de modo que el llamador aplique el valor por defecto. Los iconos
 * fuera de la lista blanca se descartan para que nunca lleguen a la interfaz
 * (Requirement 16.4).
 */
export function normalizeLanding(value: unknown): AgentLanding | null {
  if (!isPlainObject(value)) return null;

  const title = trimmedString(value.title);
  const subtitle = trimmedString(value.subtitle);
  if (title === null || subtitle === null || !Array.isArray(value.highlights)) return null;

  const highlights: AgentLandingHighlightGroup[] = [];
  for (const rawGroup of value.highlights) {
    if (!isPlainObject(rawGroup)) return null;
    const groupTitle = trimmedString(rawGroup.title);
    if (groupTitle === null || !Array.isArray(rawGroup.items)) return null;

    const items: AgentLandingHighlight[] = [];
    for (const rawItem of rawGroup.items) {
      if (!isPlainObject(rawItem)) return null;
      const itemTitle = trimmedString(rawItem.title);
      if (itemTitle === null) return null;

      const item: AgentLandingHighlight = { title: itemTitle };
      const itemSubtitle = trimmedString(rawItem.subtitle);
      if (itemSubtitle !== null) item.subtitle = itemSubtitle;
      if (isAllowedIconName(rawItem.icon)) item.icon = rawItem.icon;
      items.push(item);
    }

    highlights.push({ title: groupTitle, items });
  }

  return { title, subtitle, highlights };
}

/* ────────────────────────────────────────────────────────── */
/*  Validación de campos obligatorios                          */
/* ────────────────────────────────────────────────────────── */

function requireStringField(raw: Record<string, unknown>, field: RequiredStringField): string {
  const value = raw[field];

  if (value === undefined || value === null) {
    throw new ManifestValidationError(
      'missing_required_field',
      `falta el campo obligatorio "${field}".`,
    );
  }
  if (typeof value !== 'string') {
    throw new ManifestValidationError(
      'invalid_field_value',
      `el campo obligatorio "${field}" no es una cadena.`,
    );
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ManifestValidationError(
      'invalid_field_value',
      `el campo obligatorio "${field}" está vacío.`,
    );
  }

  const maxLength = FIELD_MAX_LENGTHS[field];
  if (trimmed.length > maxLength) {
    throw new ManifestValidationError(
      'invalid_field_value',
      `el campo obligatorio "${field}" tiene ${trimmed.length} caracteres y supera el límite de ${maxLength}.`,
    );
  }

  return value;
}

/**
 * Valida los campos obligatorios en orden y devuelve sus valores literales.
 * Las enumeraciones y el ajuste de `id` se comprueban en el mismo recorrido,
 * de forma que la primera causa sea la que se reporta.
 */
function readRequiredFields(
  raw: Record<string, unknown>,
  agentId: string,
): Record<RequiredStringField, string> {
  const values = {} as Record<RequiredStringField, string>;

  for (const field of REQUIRED_STRING_FIELDS) {
    const value = requireStringField(raw, field);

    // Comparaciones exactas: sin recortar y distinguiendo mayúsculas (1.3, 2.2, 2.3).
    if (field === 'id' && value !== agentId) {
      throw new ManifestValidationError(
        'id_folder_mismatch',
        `el campo "id" vale "${value}" y no coincide con el nombre de la carpeta "${agentId}".`,
      );
    }
    if (field === 'icon' && !isAllowedIconName(value)) {
      throw new ManifestValidationError(
        'invalid_field_value',
        `el campo "icon" vale "${value}" y no está en la lista de iconos permitidos.`,
      );
    }
    if (field === 'inputMode' && !isInputMode(value)) {
      throw new ManifestValidationError(
        'invalid_field_value',
        `el campo "inputMode" vale "${value}" y no es un modo de entrada permitido.`,
      );
    }
    if (field === 'outputRenderer' && !isOutputRenderer(value)) {
      throw new ManifestValidationError(
        'invalid_field_value',
        `el campo "outputRenderer" vale "${value}" y no es un renderizador permitido.`,
      );
    }

    values[field] = value;
  }

  return values;
}

/* ────────────────────────────────────────────────────────── */
/*  Validación de campos opcionales                            */
/* ────────────────────────────────────────────────────────── */

interface OptionalFields {
  order: number;
  isDefault: boolean;
  supportsInstruction: boolean;
  promptFile: string;
  schemaFile: string;
  accentColor: string;
  modelProvider: ModelProviderType;
  modelName: string;
  tools: readonly string[];
  landing: AgentLanding | null;
}

type DegradeReporter = (code: AgentManifestWarningCode, message: string) => void;

function readBooleanField(
  raw: Record<string, unknown>,
  field: 'isDefault' | 'supportsInstruction',
  degrade: DegradeReporter,
): boolean {
  const value = raw[field];
  if (value === undefined || value === null) return MANIFEST_DEFAULTS[field];
  if (typeof value === 'boolean') return value;

  degrade(
    'invalid_optional_field',
    `el campo opcional "${field}" no es booleano: se aplica el valor por defecto ${String(
      MANIFEST_DEFAULTS[field],
    )}.`,
  );
  return MANIFEST_DEFAULTS[field];
}

function readFileNameField(
  raw: Record<string, unknown>,
  field: 'promptFile' | 'schemaFile',
  degrade: DegradeReporter,
): string {
  const fallback = MANIFEST_DEFAULTS[field];
  const value = raw[field];
  if (value === undefined || value === null) return fallback;

  const trimmed = trimmedString(value);
  if (trimmed === null) {
    degrade(
      'invalid_optional_field',
      `el campo opcional "${field}" no es una cadena con contenido: se aplica el valor por defecto "${fallback}".`,
    );
    return fallback;
  }
  // El nombre se concatena a la carpeta del agente: nunca puede contener
  // separadores de ruta ni secuencias de recorrido (Requirement 16.1).
  if (!isSafeFileName(trimmed)) {
    degrade(
      'invalid_optional_field',
      `el campo opcional "${field}" vale "${trimmed}" y no es un nombre de archivo simple: se aplica el valor por defecto "${fallback}".`,
    );
    return fallback;
  }

  return trimmed;
}

function readAccentColor(raw: Record<string, unknown>, degrade: DegradeReporter): string {
  const value = raw.accentColor;
  if (value === undefined || value === null) return DEFAULT_ACCENT_COLOR;

  const trimmed = trimmedString(value);
  if (
    trimmed === null ||
    trimmed.length > MAX_ACCENT_COLOR_LENGTH ||
    !HEX_COLOR_PATTERN.test(trimmed)
  ) {
    degrade(
      'invalid_optional_field',
      `el campo opcional "accentColor" no es un color hexadecimal: se aplica el valor por defecto "${DEFAULT_ACCENT_COLOR}".`,
    );
    return DEFAULT_ACCENT_COLOR;
  }

  return trimmed;
}

function readOptionalFields(
  raw: Record<string, unknown>,
  degrade: DegradeReporter,
): OptionalFields {
  const normalizedOrder = normalizeOrder(raw.order);
  if (normalizedOrder.degraded === 'type') {
    degrade(
      'invalid_optional_field',
      `el campo opcional "order" no es un número: se aplica el valor por defecto ${DEFAULT_ORDER}.`,
    );
  } else if (normalizedOrder.degraded === 'range') {
    degrade(
      'order_out_of_range',
      `el campo opcional "order" vale ${String(raw.order)} y no es un entero entre ${ORDER_MIN} y ${ORDER_MAX}: se aplica el valor por defecto ${DEFAULT_ORDER}.`,
    );
  }

  const landingValue = raw.landing;
  let landing: AgentLanding | null = null;
  if (landingValue !== undefined && landingValue !== null) {
    landing = normalizeLanding(landingValue);
    if (landing === null) {
      degrade(
        'invalid_optional_field',
        'el campo opcional "landing" no tiene la forma esperada: se aplica el valor por defecto nulo.',
      );
    }
  }

  let modelProvider: ModelProviderType = DEFAULT_MODEL_PROVIDER;
  if (raw.modelProvider !== undefined && raw.modelProvider !== null) {
    if (isModelProvider(raw.modelProvider)) {
      modelProvider = raw.modelProvider;
    } else {
      degrade(
        'invalid_optional_field',
        `el campo opcional "modelProvider" vale "${String(raw.modelProvider)}" y no es un proveedor permitido: se aplica el valor por defecto "${DEFAULT_MODEL_PROVIDER}".`,
      );
    }
  }

  let modelName: string = DEFAULT_MODEL_NAME;
  if (raw.modelName !== undefined && raw.modelName !== null) {
    const trimmed = trimmedString(raw.modelName);
    if (trimmed !== null && trimmed.length <= 120) {
      modelName = trimmed;
    } else {
      degrade(
        'invalid_optional_field',
        `el campo opcional "modelName" no es una cadena válida: se aplica el valor por defecto "${DEFAULT_MODEL_NAME}".`,
      );
    }
  }

  let tools: readonly string[] = DEFAULT_TOOLS;
  if (raw.tools !== undefined && raw.tools !== null) {
    if (Array.isArray(raw.tools)) {
      const valid: string[] = [];
      for (const entry of raw.tools) {
        if (isKnownToolName(entry)) {
          valid.push(entry);
        } else {
          degrade(
            'invalid_optional_field',
            `el campo opcional "tools" contiene "${String(entry)}" que no es un nombre de herramienta conocido: se omite.`,
          );
        }
      }
      tools = valid;
    } else {
      degrade(
        'invalid_optional_field',
        'el campo opcional "tools" no es un arreglo: se aplica el valor por defecto vacío.',
      );
    }
  }

  return {
    order: normalizedOrder.order,
    isDefault: readBooleanField(raw, 'isDefault', degrade),
    supportsInstruction: readBooleanField(raw, 'supportsInstruction', degrade),
    promptFile: readFileNameField(raw, 'promptFile', degrade),
    schemaFile: readFileNameField(raw, 'schemaFile', degrade),
    accentColor: readAccentColor(raw, degrade),
    modelProvider,
    modelName,
    tools,
    landing,
  };
}

/* ────────────────────────────────────────────────────────── */
/*  Archivos requeridos                                       */
/* ────────────────────────────────────────────────────────── */

/**
 * Comprueba que el archivo existe, es un archivo regular, es legible y tiene
 * más de 0 bytes (Requirement 2.4).
 */
function assertReadableNonEmptyFile(filePath: string, label: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new ManifestValidationError(
        'missing_required_file',
        `falta el archivo requerido "${label}".`,
      );
    }
    throw new ManifestValidationError(
      'unreadable_required_file',
      `el archivo requerido "${label}" no se pudo leer: ${errorMessage(error)}.`,
    );
  }

  if (!stat.isFile()) {
    throw new ManifestValidationError(
      'missing_required_file',
      `el archivo requerido "${label}" no es un archivo.`,
    );
  }
  if (stat.size === 0) {
    throw new ManifestValidationError(
      'empty_required_file',
      `el archivo requerido "${label}" está vacío.`,
    );
  }

  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch (error) {
    throw new ManifestValidationError(
      'unreadable_required_file',
      `el archivo requerido "${label}" no se pudo leer: ${errorMessage(error)}.`,
    );
  }
}

/** El esquema, además, debe contener JSON válido (Requirement 2.4). */
function assertValidSchemaFile(filePath: string, label: string): void {
  assertReadableNonEmptyFile(filePath, label);

  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    throw new ManifestValidationError(
      'unreadable_required_file',
      `el archivo requerido "${label}" no se pudo leer: ${errorMessage(error)}.`,
    );
  }

  try {
    JSON.parse(text);
  } catch (error) {
    throw new ManifestValidationError(
      'invalid_schema_json',
      `el archivo de esquema "${label}" no contiene JSON válido: ${errorMessage(error)}.`,
    );
  }
}

/* ────────────────────────────────────────────────────────── */
/*  Validación de una carpeta                                  */
/* ────────────────────────────────────────────────────────── */

function parseManifestText(manifestText: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText);
  } catch (error) {
    throw new ManifestValidationError(
      'invalid_manifest_json',
      `manifest.json no contiene JSON válido: ${errorMessage(error)}.`,
    );
  }

  if (!isPlainObject(parsed)) {
    throw new ManifestValidationError(
      'invalid_manifest_json',
      'manifest.json no contiene un objeto JSON.',
    );
  }

  return parsed;
}

/**
 * Valida el manifiesto de una carpeta descubierta y resuelve su definición.
 * Nunca lanza: toda excepción se convierte en una única advertencia.
 */
export function validateAgentFolder(folder: DiscoveredAgentFolder): ManifestValidationResult {
  const degradations: AgentRegistryWarning[] = [];
  const degrade: DegradeReporter = (code, message) => {
    degradations.push({
      code,
      relativePath: folder.relativeDir,
      message: `Agente "${folder.relativeDir}": ${message}`,
    });
  };

  try {
    const raw = parseManifestText(folder.manifestText);
    const required = readRequiredFields(raw, folder.agentId);
    const optional = readOptionalFields(raw, degrade);

    const paths: AgentPaths = {
      dir: folder.dir,
      manifestPath: folder.manifestPath,
      agentsFilePath: path.join(folder.dir, AGENTS_FILE_NAME),
      promptPath: path.join(folder.dir, optional.promptFile),
      schemaPath: path.join(folder.dir, optional.schemaFile),
    };

    assertReadableNonEmptyFile(paths.agentsFilePath, AGENTS_FILE_NAME);
    assertReadableNonEmptyFile(paths.promptPath, optional.promptFile);
    assertValidSchemaFile(paths.schemaPath, optional.schemaFile);

    const manifest: AgentManifest = {
      id: folder.agentId,
      name: required.name.trim(),
      tagline: required.tagline.trim(),
      description: required.description.trim(),
      icon: required.icon as AgentManifest['icon'],
      accentColor: optional.accentColor,
      order: optional.order,
      isDefault: optional.isDefault,
      inputMode: required.inputMode as AgentManifest['inputMode'],
      inputPlaceholder: required.inputPlaceholder.trim(),
      actionLabel: required.actionLabel.trim(),
      supportsInstruction: optional.supportsInstruction,
      outputRenderer: required.outputRenderer as AgentManifest['outputRenderer'],
      promptFile: optional.promptFile,
      schemaFile: optional.schemaFile,
      modelProvider: optional.modelProvider,
      modelName: optional.modelName,
      tools: optional.tools,
      landing: optional.landing,
    };

    return {
      ok: true,
      definition: { agentId: folder.agentId, manifest, paths },
      warnings: degradations,
    };
  } catch (error) {
    // Requirement 2.5 y 2.8: exactamente una advertencia por carpeta omitida.
    const isKnown = error instanceof ManifestValidationError;
    return {
      ok: false,
      warnings: [
        {
          code: isKnown ? error.code : 'validation_exception',
          relativePath: folder.relativeDir,
          message: isKnown
            ? `Carpeta "${folder.relativeDir}" omitida: ${error.message}`
            : `Carpeta "${folder.relativeDir}" omitida: la validación lanzó una excepción: ${errorMessage(error)}.`,
        },
      ],
    };
  }
}

/**
 * Valida todas las carpetas descubiertas, conservando las válidas y omitiendo
 * las inválidas con una advertencia cada una (Requirements 2.5, 2.8, 2.9).
 */
export function validateAgentFolders(
  folders: readonly DiscoveredAgentFolder[],
  logger: AgentRegistryLogger | null = null,
): AgentValidationResult {
  const definitions: ResolvedAgentDefinition[] = [];
  const warnings: AgentRegistryWarning[] = [];

  for (const folder of folders) {
    const result = validateAgentFolder(folder);
    for (const warning of result.warnings) {
      warnings.push(warning);
      logger?.(warning);
    }
    if (result.ok) definitions.push(result.definition);
  }

  return { definitions, warnings };
}
