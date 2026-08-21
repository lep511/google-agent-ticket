/**
 * Entrada efectiva y validación previa a la ejecución de `POST /api/analyze`.
 *
 * El endpoint acepta el valor principal en el campo `input` y mantiene `ticker`
 * como alias heredado: se usa `input` cuando contiene al menos un carácter tras
 * recortar los espacios, y `ticker` solo cuando `input` está ausente, es nulo o
 * queda vacío (Requirements 9.2, 9.3). Con ninguno de los dos disponible, la
 * respuesta enumera los campos aceptados ().
 *
 * Sobre ese valor se aplican, en este orden, el límite común de 10.000
 * caracteres () y las reglas del `inputMode` del agente resuelto:
 * `ticker` exige de 1 a 10 caracteres `A`-`Z` y `0`-`9` tras recortar y pasar a
 * mayúsculas (), y `text` exige de 1 a 2.000 caracteres tras
 * recortar (). La instrucción se valida únicamente cuando el
 * manifiesto declara `supportsInstruction` verdadero (Requirements 5.9, 8.6);
 * en caso contrario se descarta sin rechazar la petición ().
 *
 * El módulo es puro: no toca el disco, no crea interacciones remotas y no
 * escribe logs. Devuelve el valor normalizado o un único resultado 400 que
 * identifica el campo y el límite incumplido, para que el endpoint responda
 * antes de cargar las fuentes inline, de ensamblar el prompt y de escribir las
 * cabeceras SSE (Requirements 8.3, 8.4, 8.5).
 *
 
 */

import type { InputMode } from './agent/agentTypes.ts';

/* ────────────────────────────────────────────────────────── */
/*  Campos y límites                                           */
/* ────────────────────────────────────────────────────────── */

/** Campo principal del valor de entrada (). */
export const INPUT_FIELD = 'input';

/** Alias heredado del valor de entrada (). */
export const LEGACY_INPUT_FIELD = 'ticker';

/** Campo de la instrucción opcional (Requirements 5.9, 8.6). */
export const INSTRUCTION_FIELD = 'instruction';

/** Campos aceptados como valor de entrada, en orden de precedencia. */
export const ACCEPTED_INPUT_FIELDS = [INPUT_FIELD, LEGACY_INPUT_FIELD] as const;

export type AnalyzeInputField = (typeof ACCEPTED_INPUT_FIELDS)[number];

/** Límite común del valor de entrada efectivo, en caracteres (). */
export const MAX_EFFECTIVE_INPUT_LENGTH = 10_000;

/** Longitud mínima de un símbolo en modo `ticker` (). */
export const TICKER_MIN_LENGTH = 1;

/** Longitud máxima de un símbolo en modo `ticker` (). */
export const TICKER_MAX_LENGTH = 10;

/**
 * Símbolo admitido en modo `ticker`: de 1 a 10 caracteres `A`-`Z` y `0`-`9`,
 * comprobado sobre el valor ya recortado y en mayúsculas ().
 */
export const TICKER_PATTERN = /^[A-Z0-9]{1,10}$/;

/** Longitud mínima del texto en modo `text` (). */
export const TEXT_MIN_LENGTH = 1;

/** Longitud máxima del texto en modo `text` (). */
export const TEXT_MAX_LENGTH = 2000;

/** Longitud máxima de la instrucción tras recortar (Requirements 5.9, 8.6). */
export const MAX_INSTRUCTION_LENGTH = 2000;

/* ────────────────────────────────────────────────────────── */
/*  Errores de validación                                      */
/* ────────────────────────────────────────────────────────── */

/** Motivos por los que la petición se rechaza antes de ejecutar nada. */
export type AnalyzeInputErrorCode =
  /** Ni `input` ni `ticker` contienen un valor utilizable (Requirements 8.3, 9.5). */
  | 'missing_input'
  /** El campo recibido está presente pero no es una cadena (). */
  | 'invalid_input_type'
  /** El valor de entrada efectivo supera 10.000 caracteres (). */
  | 'input_too_long'
  /** El valor no es un símbolo válido en modo `ticker` (). */
  | 'invalid_ticker_format'
  /** El texto queda vacío tras recortar en modo `text` (). */
  | 'text_too_short'
  /** El texto supera 2.000 caracteres en modo `text` (). */
  | 'text_too_long'
  /** `instruction` está presente y no es una cadena (). */
  | 'invalid_instruction_type'
  /** `instruction` supera 2.000 caracteres (Requirements 5.9, 8.6). */
  | 'instruction_too_long';

/** Campo que identifica el error de validación. */
export type AnalyzeInputErrorField = AnalyzeInputField | typeof INSTRUCTION_FIELD;

/**
 * Cuerpo de la única respuesta de error de validación: un mensaje legible, el
 * campo causante y el límite incumplido, sin rutas del sistema de archivos
 * (Requirements 8.5, 16.3).
 */
export interface AnalyzeInputErrorBody {
  error: string;
  code: AnalyzeInputErrorCode;
  field: AnalyzeInputErrorField;
  /** Descripción del límite incumplido, tal como se comunica al cliente. */
  limit: string;
}

/** Resultado HTTP del rechazo por validación: siempre 400 y no SSE. */
export interface AnalyzeInputRejection {
  status: 400;
  body: AnalyzeInputErrorBody;
}

/** Valor de entrada aceptado, ya normalizado para el ensamblador de prompt. */
export interface ValidatedAnalyzeInput {
  /** Campo del que salió el valor: `input` o el alias heredado `ticker`. */
  field: AnalyzeInputField;
  /** Verdadero cuando el valor vino del alias heredado (). */
  usedLegacyAlias: boolean;
  /** Valor tal como llegó en la petición, sin recortar. */
  rawInput: string;
  /**
   * Valor efectivo: recortado y, en modo `ticker`, en mayúsculas. Es el valor
   * que sustituye a `{{input}}` en la plantilla ().
   */
  input: string;
  /** `inputMode` del agente resuelto con el que se validó. */
  inputMode: InputMode;
  /**
   * Instrucción aplicable, ya recortada, o `null` cuando el agente no declara
   * `supportsInstruction` o la petición no la incluye (Requirements 5.7, 7.7).
   */
  instruction: string | null;
}

/**
 * Resultado de la validación: o el valor aceptado, o el único rechazo 400 que
 * el endpoint debe responder. Exactamente uno de los dos campos está presente.
 */
export interface AnalyzeInputValidation {
  ok: boolean;
  /** Valor aceptado; `null` cuando la petición se rechaza. */
  value: ValidatedAnalyzeInput | null;
  /** Rechazo listo para responder; `null` cuando la petición se acepta. */
  rejection: AnalyzeInputRejection | null;
}

function reject(
  code: AnalyzeInputErrorCode,
  field: AnalyzeInputErrorField,
  limit: string,
  error: string,
): AnalyzeInputValidation {
  return {
    ok: false,
    value: null,
    rejection: { status: 400, body: { error, code, field, limit } },
  };
}

function accept(value: ValidatedAnalyzeInput): AnalyzeInputValidation {
  return { ok: true, value, rejection: null };
}

/* ────────────────────────────────────────────────────────── */
/*  Entrada efectiva                                           */
/* ────────────────────────────────────────────────────────── */

/** Cuerpo de la petición, tal como llega sin validar. */
export interface AnalyzeRequestBody {
  input?: unknown;
  ticker?: unknown;
  instruction?: unknown;
}

/** Selección del campo que aporta el valor de entrada efectivo. */
export interface EffectiveInputSelection {
  /** Campo elegido, o `null` cuando ninguno aporta un valor utilizable. */
  field: AnalyzeInputField | null;
  /** Valor literal del campo elegido, sin recortar; `null` si no hay ninguno. */
  raw: string | null;
  /**
   * Campos presentes con un tipo distinto de cadena, en orden de precedencia.
   * Sirve para que el error identifique el campo recibido ().
   */
  nonStringFields: AnalyzeInputField[];
}

/**
 * Elige el valor de entrada efectivo entre `input` y el alias heredado
 * `ticker` (Requirements 9.2, 9.3).
 *
 * Un campo solo se considera utilizable si es una cadena con al menos un
 * carácter tras recortar los espacios inicial y final, de modo que `input`
 * vacío, nulo o de otro tipo deja pasar el alias.
 */
export function selectEffectiveInput(body: AnalyzeRequestBody): EffectiveInputSelection {
  const nonStringFields: AnalyzeInputField[] = [];
  let selected: EffectiveInputSelection = { field: null, raw: null, nonStringFields };

  for (const field of ACCEPTED_INPUT_FIELDS) {
    const received = body?.[field];

    if (typeof received !== 'string') {
      if (received !== undefined && received !== null) nonStringFields.push(field);
      continue;
    }

    if (received.trim().length === 0) continue;
    if (selected.field === null) selected = { field, raw: received, nonStringFields };
  }

  return selected;
}

/* ────────────────────────────────────────────────────────── */
/*  Validación                                                 */
/* ────────────────────────────────────────────────────────── */

export interface ValidateAnalyzeInputOptions {
  body: AnalyzeRequestBody;
  /** `inputMode` del agente resuelto (Requirements 8.1, 8.2). */
  inputMode: InputMode;
  /** `supportsInstruction` del agente resuelto (Requirements 5.7, 8.6). */
  supportsInstruction: boolean;
}

/**
 * Valida el cuerpo de una petición de ejecución contra el agente ya resuelto.
 *
 * Devuelve el valor normalizado o un único rechazo 400 que identifica el campo
 * y el límite incumplido. El llamador debe invocarla antes de cargar las
 * fuentes inline, de ensamblar el prompt y de escribir las cabeceras SSE, y no
 * debe escribir logs de ejecución para una petición rechazada
 * (Requirements 8.4, 8.5).
 */
export function validateAnalyzeInput(
  options: ValidateAnalyzeInputOptions,
): AnalyzeInputValidation {
  const { body, inputMode, supportsInstruction } = options;

  const selection = selectEffectiveInput(body);

  // Requirements 8.3, 9.5: sin valor utilizable se enumeran los campos aceptados.
  if (selection.field === null || selection.raw === null) {
    const acceptedFields = ACCEPTED_INPUT_FIELDS.join('" o "');
    const [nonStringField] = selection.nonStringFields;

    if (nonStringField !== undefined) {
      const receivedType = body[nonStringField] === null ? 'null' : typeof body[nonStringField];
      return reject(
        'invalid_input_type',
        nonStringField,
        'debe ser una cadena de texto',
        `El campo "${nonStringField}" debe ser una cadena de texto y llegó como ${receivedType}. Campos de entrada aceptados: "${acceptedFields}".`,
      );
    }

    return reject(
      'missing_input',
      INPUT_FIELD,
      'al menos 1 carácter tras recortar los espacios',
      `Falta el valor de entrada. Campos de entrada aceptados: "${acceptedFields}".`,
    );
  }

  const { field, raw } = selection;

  //  límite común, comprobado antes de las reglas del modo.
  if (raw.length > MAX_EFFECTIVE_INPUT_LENGTH) {
    return reject(
      'input_too_long',
      field,
      `${MAX_EFFECTIVE_INPUT_LENGTH} caracteres`,
      `El campo "${field}" tiene ${raw.length} caracteres y supera el límite de ${MAX_EFFECTIVE_INPUT_LENGTH} caracteres.`,
    );
  }

  const trimmed = raw.trim();

  let input: string;
  if (inputMode === 'ticker') {
    //  de 1 a 10 caracteres A-Z y 0-9 tras recortar y pasar a
    // mayúsculas.
    const normalized = trimmed.toUpperCase();
    if (!TICKER_PATTERN.test(normalized)) {
      return reject(
        'invalid_ticker_format',
        field,
        `de ${TICKER_MIN_LENGTH} a ${TICKER_MAX_LENGTH} caracteres A-Z y 0-9`,
        `El campo "${field}" debe ser un símbolo de ${TICKER_MIN_LENGTH} a ${TICKER_MAX_LENGTH} caracteres A-Z y 0-9.`,
      );
    }
    input = normalized;
  } else {
    //  de 1 a 2.000 caracteres tras recortar.
    if (trimmed.length < TEXT_MIN_LENGTH) {
      return reject(
        'text_too_short',
        field,
        `al menos ${TEXT_MIN_LENGTH} carácter tras recortar los espacios`,
        `El campo "${field}" debe tener al menos ${TEXT_MIN_LENGTH} carácter tras recortar los espacios.`,
      );
    }
    if (trimmed.length > TEXT_MAX_LENGTH) {
      return reject(
        'text_too_long',
        field,
        `${TEXT_MAX_LENGTH} caracteres`,
        `El campo "${field}" tiene ${trimmed.length} caracteres tras recortar los espacios y supera el límite de ${TEXT_MAX_LENGTH} caracteres.`,
      );
    }
    input = trimmed;
  }

  //  cuando el agente no admite instrucción, el campo se
  // descarta sin validarlo y sin rechazar la petición.
  if (!supportsInstruction) {
    return accept({
      field,
      usedLegacyAlias: field === LEGACY_INPUT_FIELD,
      rawInput: raw,
      input,
      inputMode,
      instruction: null,
    });
  }

  const receivedInstruction = body?.[INSTRUCTION_FIELD];

  //  presente y de otro tipo, rechazo identificando el campo.
  if (
    receivedInstruction !== undefined &&
    receivedInstruction !== null &&
    typeof receivedInstruction !== 'string'
  ) {
    return reject(
      'invalid_instruction_type',
      INSTRUCTION_FIELD,
      'debe ser una cadena de texto',
      `El campo "${INSTRUCTION_FIELD}" debe ser una cadena de texto y llegó como ${typeof receivedInstruction}.`,
    );
  }

  const instruction = typeof receivedInstruction === 'string' ? receivedInstruction.trim() : null;

  // Requirements 5.9, 8.6: límite de 2.000 caracteres tras recortar.
  if (instruction !== null && instruction.length > MAX_INSTRUCTION_LENGTH) {
    return reject(
      'instruction_too_long',
      INSTRUCTION_FIELD,
      `${MAX_INSTRUCTION_LENGTH} caracteres`,
      `El campo "${INSTRUCTION_FIELD}" tiene ${instruction.length} caracteres tras recortar los espacios y supera el límite de ${MAX_INSTRUCTION_LENGTH} caracteres.`,
    );
  }

  return accept({
    field,
    usedLegacyAlias: field === LEGACY_INPUT_FIELD,
    rawInput: raw,
    input,
    inputMode,
    instruction,
  });
}
