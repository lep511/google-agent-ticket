/**
 * Prompt assembler: builds the final prompt of a run from the resolved agent's
 * template, the effective input value, the optional instruction and the literal
 * contents of the schema file.
 *
 * Assembly sequence:
 *  1. Read the template and the schema from the paths of the catalog entry
 *     (`agentRegistry.readAgentPromptTemplate` and `readAgentSchema`), which
 *     already fail with an explicit error naming the file when the read or the
 *     parse fails, or when the file exceeds 256 KiB ().
 *  2. Look for unsupported placeholders **in the template text only**, before
 *     substituting anything, so an input value, an instruction or a schema that
 *     happens to contain the `{{...}}` shape does not break the build
 *     (Requirements 7.4, 7.5).
 *  3. Replace every occurrence of `{{input}}`, `{{instruction}}` and
 *     `{{schema}}` (Requirements 7.1, 7.2, 7.6, 7.7).
 *  4. Leave the shared JSON output rules block present exactly once in the final
 *     prompt ().
 *
 * On step 4: the block is appended at the end, after all the text coming from
 * the template, unless the template itself already declares those two rules
 * (wrapping the answer in a ```json block, and not renaming the schema keys).
 * That check is the only thing keeping the block present exactly once
 * (Requirements 7.3, 7.8).
 *
 * No template in the repository declares both rules today. The `prompt.md` of
 * `financial_analyst_agent` describes its schema but mentions neither the
 * ```json wrapper nor the no-renaming rule, so `declaresJsonOutputRules` returns
 * false and the block is appended to it like to every other agent. The branch
 * that skips the block exists for templates that choose to spell those rules out
 * themselves, not for any particular agent.
 */

import {
  readAgentPromptTemplate,
  readAgentSchema,
  type AgentSchemaSource,
  type AgentSourceFile,
} from './agent/agentRegistry.ts';
import type { ResolvedAgentDefinition } from './agent/agentTypes.ts';

/* ────────────────────────────────────────────────────────── */
/*  Marcadores soportados                                      */
/* ────────────────────────────────────────────────────────── */

/** Marcador del valor de entrada efectivo (). */
export const INPUT_PLACEHOLDER = '{{input}}';

/** Marcador de la instrucción opcional (Requirements 7.1, 7.6, 7.7). */
export const INSTRUCTION_PLACEHOLDER = '{{instruction}}';

/** Marcador del contenido literal del archivo de esquema (). */
export const SCHEMA_PLACEHOLDER = '{{schema}}';

/** Únicos marcadores admitidos en una plantilla (). */
export const SUPPORTED_PLACEHOLDERS = [
  INPUT_PLACEHOLDER,
  INSTRUCTION_PLACEHOLDER,
  SCHEMA_PLACEHOLDER,
] as const;

/**
 * Forma `{{...}}` sin `}` intermedios: captura tanto los marcadores soportados
 * como cualquier otro, incluidas las variantes con espacios (`{{ input }}`), que
 * no son marcadores soportados y por tanto detienen el ensamblado.
 */
const PLACEHOLDER_PATTERN = /\{\{[^{}]*\}\}/g;

/* ────────────────────────────────────────────────────────── */
/*  Bloque común de reglas de salida JSON                      */
/* ────────────────────────────────────────────────────────── */

/**
 * Reglas de salida comunes a todos los agentes (): el resultado
 * final va envuelto en un bloque ```json y las claves del esquema no se
 * renombran. Así cada `prompt.md` solo describe lo específico de su agente.
 */
export const JSON_OUTPUT_RULES_BLOCK = [
  'CRITICAL: You MUST output the final report as a raw JSON object wrapped in a ```json ... ``` markdown block in your final text response.',
  'The JSON must match the schema above EXACTLY. **HEAVILY PENALIZED:** Do NOT rename the schema keys, do NOT add root-level keys that the schema does not declare and do NOT omit keys that the schema declares.',
].join(' ');

/** Exige envolver el resultado en un bloque ```json. */
const JSON_WRAPPING_RULE_PATTERN = /```json/;

/** Prohíbe renombrar las claves del esquema. */
const NO_RENAME_RULE_PATTERN = /do\s+not\s+rename/i;

/**
 * Indica si un texto de plantilla ya declara las dos reglas del bloque común.
 * Cuando las declara, el bloque no se añade: ya está presente exactamente una
 * vez en el prompt final (Requirements 7.3, 7.8).
 */
export function declaresJsonOutputRules(templateText: string): boolean {
  return (
    JSON_WRAPPING_RULE_PATTERN.test(templateText) && NO_RENAME_RULE_PATTERN.test(templateText)
  );
}

/* ────────────────────────────────────────────────────────── */
/*  Errores                                                    */
/* ────────────────────────────────────────────────────────── */

/** Motivos por los que el ensamblado del prompt no puede completarse. */
export type PromptBuildErrorCode = 'unsupported_placeholder';

/**
 * Error explícito del ensamblador: nombra el marcador no soportado y el
 * archivo de plantilla por su ruta relativa a la raíz del repositorio, nunca
 * por su ruta absoluta (Requirements 7.4, 16.3).
 *
 * Los fallos de lectura, de análisis y de tamaño de la plantilla y del esquema
 * se propagan como `AgentSourceError` desde el registro, que ya nombra el
 * archivo afectado ().
 */
export class PromptBuildError extends Error {
  constructor(
    readonly code: PromptBuildErrorCode,
    readonly agentId: string,
    readonly relativePath: string,
    /** Marcador causante, tal como aparece en la plantilla. */
    readonly placeholder: string,
    message: string,
  ) {
    super(message);
    this.name = 'PromptBuildError';
  }
}

/* ────────────────────────────────────────────────────────── */
/*  Ensamblado                                                 */
/* ────────────────────────────────────────────────────────── */

export interface BuildAgentPromptOptions {
  /** Agente resuelto por el registro; de él salen el manifiesto y las rutas. */
  definition: ResolvedAgentDefinition;
  /** Valor de entrada efectivo, ya validado por el endpoint (). */
  input: string;
  /**
   * Instrucción recibida en la petición. Se aplica solo cuando el manifiesto
   * declara `supportsInstruction` verdadero (Requirements 7.6, 7.7).
   */
  instruction?: string | null;
  /** Plantilla ya leída; si se omite, se lee del disco. */
  template?: AgentSourceFile;
  /** Esquema ya leído; si se omite, se lee del disco. */
  schema?: AgentSchemaSource;
}

export interface BuiltAgentPrompt {
  agentId: string;
  /** Prompt final que se envía al cliente remoto. */
  prompt: string;
  /** Ruta relativa de la plantilla usada, `agent/<agentId>/<promptFile>`. */
  templateRelativePath: string;
  /** Ruta relativa del esquema usado, `agent/<agentId>/<schemaFile>`. */
  schemaRelativePath: string;
  /** Valor con el que se sustituyó `{{instruction}}`; vacío si no se aplicó. */
  effectiveInstruction: string;
  /** Verdadero cuando el bloque común se añadió al final del prompt. */
  jsonRulesBlockAppended: boolean;
  /** Duración del ensamblado en milisegundos (). */
  durationMs: number;
}

/**
 * Busca marcadores no soportados en el texto de la plantilla y falla con un
 * error que nombra el primero que encuentra (Requirements 7.4, 7.5). Se llama
 * antes de cualquier sustitución, así que el texto insertado por las
 * sustituciones queda fuera de la búsqueda.
 */
function assertOnlySupportedPlaceholders(
  templateText: string,
  agentId: string,
  relativePath: string,
): void {
  const supported = new Set<string>(SUPPORTED_PLACEHOLDERS);

  for (const match of templateText.matchAll(PLACEHOLDER_PATTERN)) {
    const placeholder = match[0];
    if (supported.has(placeholder)) continue;

    throw new PromptBuildError(
      'unsupported_placeholder',
      agentId,
      relativePath,
      placeholder,
      `La plantilla "${relativePath}" del agente "${agentId}" contiene el marcador no soportado "${placeholder}"; los marcadores admitidos son ${[
        ...supported,
      ].join(', ')}.`,
    );
  }
}

/** Sustituye todas las apariciones de un literal, sin interpretar `$`. */
function replaceAll(text: string, placeholder: string, value: string): string {
  return text.split(placeholder).join(value);
}

/**
 * Ensambla el prompt final del agente resuelto.
 *
 * @throws {PromptBuildError} si la plantilla contiene un marcador no soportado.
 * @throws {AgentSourceError} si la lectura o el análisis de la plantilla o del
 * esquema falla, o si alguno supera 256 KiB ().
 */
export function buildAgentPrompt(options: BuildAgentPromptOptions): BuiltAgentPrompt {
  const startedAt = Date.now();
  const { definition, input, instruction } = options;
  const { agentId, manifest } = definition;

  //  las lecturas ya fallan nombrando el archivo afectado.
  const template = options.template ?? readAgentPromptTemplate(definition);
  const schema = options.schema ?? readAgentSchema(definition);

  // Requirements 7.4, 7.5: solo se examina el texto de la plantilla original.
  assertOnlySupportedPlaceholders(template.text, agentId, template.relativePath);

  // Requirements 7.6, 7.7: la instrucción se aplica solo cuando el manifiesto
  // la admite, y queda vacía si está ausente o solo tiene espacios.
  const effectiveInstruction =
    manifest.supportsInstruction && typeof instruction === 'string' ? instruction.trim() : '';

  let prompt = replaceAll(template.text, INPUT_PLACEHOLDER, input.trim());
  prompt = replaceAll(prompt, INSTRUCTION_PLACEHOLDER, effectiveInstruction);
  prompt = replaceAll(prompt, SCHEMA_PLACEHOLDER, schema.text);

  //  el bloque común queda exactamente una vez, al final del
  // prompt, salvo que la plantilla ya declare esas mismas reglas.
  const jsonRulesBlockAppended = !declaresJsonOutputRules(template.text);
  if (jsonRulesBlockAppended) {
    prompt = `${prompt.replace(/\s+$/, '')}\n\n${JSON_OUTPUT_RULES_BLOCK}\n`;
  }

  return {
    agentId,
    prompt,
    templateRelativePath: template.relativePath,
    schemaRelativePath: schema.relativePath,
    effectiveInstruction,
    jsonRulesBlockAppended,
    durationMs: Date.now() - startedAt,
  };
}
