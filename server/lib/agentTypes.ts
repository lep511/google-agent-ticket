/**
 * Tipos y constantes del catálogo de agentes.
 *
 * Este módulo es puramente declarativo: no lee el sistema de archivos ni
 * valida manifiestos. Lo consumen `agentRegistry.ts`, `promptBuilder.ts` y los
 * endpoints de `server.ts`.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.6, 4.2, 6.1, 16.4
 */

/* ────────────────────────────────────────────────────────── */
/*  Enumeraciones del manifiesto                               */
/* ────────────────────────────────────────────────────────── */

/** Tipos de entrada principal admitidos por un agente (Requirement 2.2). */
export const INPUT_MODES = ['ticker', 'text'] as const;

export type InputMode = (typeof INPUT_MODES)[number];

/** Renderizadores de salida admitidos por un agente (Requirement 2.2). */
export const OUTPUT_RENDERERS = ['financial_report', 'simple_report'] as const;

export type OutputRenderer = (typeof OUTPUT_RENDERERS)[number];

/**
 * Lista blanca de iconos de `lucide-react` que un manifiesto puede declarar
 * (Requirements 2.3, 16.4). Un nombre fuera de esta lista invalida el
 * manifiesto, de modo que nunca llega un identificador arbitrario a la UI.
 */
export const ALLOWED_ICONS = [
  'Activity',
  'AlertCircle',
  'AlertTriangle',
  'BarChart3',
  'Bot',
  'Brain',
  'Briefcase',
  'Building2',
  'Calendar',
  'CheckCircle',
  'CheckCircle2',
  'ChevronDown',
  'ChevronRight',
  'Code',
  'Compass',
  'Database',
  'FileText',
  'Globe',
  'HelpCircle',
  'Info',
  'Landmark',
  'Lightbulb',
  'LineChart',
  'MessageSquare',
  'Newspaper',
  'PieChart',
  'Printer',
  'Search',
  'ShieldAlert',
  'Sparkles',
  'TrendingDown',
  'TrendingUp',
  'Users',
  'Wallet',
] as const;

export type AllowedIconName = (typeof ALLOWED_ICONS)[number];

/* ────────────────────────────────────────────────────────── */
/*  Nombres de archivo del agente                              */
/* ────────────────────────────────────────────────────────── */

/** Manifiesto de la carpeta de agente. */
export const MANIFEST_FILE_NAME = 'manifest.json';

/** Instrucciones del agente, obligatorias y subidas al entorno remoto. */
export const AGENTS_FILE_NAME = 'AGENTS.md';

/* ────────────────────────────────────────────────────────── */
/*  Límites                                                    */
/* ────────────────────────────────────────────────────────── */

/** Máximo de subcarpetas directas de `agent/` que se enumeran (Requirement 1.1). */
export const MAX_AGENT_FOLDERS = 100;

/** Tamaño máximo de `manifest.json`, 64 KB (Requirement 1.5). */
export const MAX_MANIFEST_BYTES = 64 * 1000;

/** Tamaño máximo de la plantilla de prompt, 256 KiB (Requirement 7.9). */
export const MAX_PROMPT_BYTES = 256 * 1024;

/** Tamaño máximo del archivo de esquema, 256 KiB (Requirement 7.9). */
export const MAX_SCHEMA_BYTES = 256 * 1024;

/** Tamaño máximo de un archivo de ejecución subido como fuente inline, 1 MB (Requirement 6.6). */
export const MAX_RUNTIME_FILE_BYTES = 1024 * 1024;

/** Profundidad máxima de subcarpetas recorridas por agente (Requirement 6.1). */
export const MAX_RUNTIME_DIR_DEPTH = 5;

/** Número máximo de archivos de ejecución por agente (Requirement 6.1). */
export const MAX_RUNTIME_FILE_COUNT = 200;

/** Longitudes máximas de los campos obligatorios del manifiesto (Requirement 2.1). */
export const FIELD_MAX_LENGTHS = {
  id: 64,
  name: 64,
  icon: 64,
  inputMode: 64,
  outputRenderer: 64,
  tagline: 160,
  inputPlaceholder: 160,
  actionLabel: 160,
  description: 1000,
} as const;

/** Rango admitido para `order` antes de aplicar el valor por defecto (Requirement 1.7). */
export const ORDER_MIN = 0;
export const ORDER_MAX = 9999;

/* ────────────────────────────────────────────────────────── */
/*  Valores por defecto de los campos opcionales               */
/* ────────────────────────────────────────────────────────── */

/** Blanco translúcido: acento por defecto, alineado con `border-white/10`. */
export const DEFAULT_ACCENT_COLOR = '#FFFFFF1A';

export const DEFAULT_ORDER = 100;
export const DEFAULT_IS_DEFAULT = false;
export const DEFAULT_SUPPORTS_INSTRUCTION = false;
export const DEFAULT_PROMPT_FILE = 'prompt.md';
export const DEFAULT_SCHEMA_FILE = 'output.schema.json';

/**
 * Valores por defecto que el registro aplica cuando el manifiesto omite un
 * campo opcional o lo declara con un tipo incorrecto (Requirements 2.6, 2.7).
 */
export const MANIFEST_DEFAULTS = {
  order: DEFAULT_ORDER,
  isDefault: DEFAULT_IS_DEFAULT,
  supportsInstruction: DEFAULT_SUPPORTS_INSTRUCTION,
  promptFile: DEFAULT_PROMPT_FILE,
  schemaFile: DEFAULT_SCHEMA_FILE,
  accentColor: DEFAULT_ACCENT_COLOR,
  landing: null,
} as const;

/* ────────────────────────────────────────────────────────── */
/*  Manifiesto                                                 */
/* ────────────────────────────────────────────────────────── */

/** Punto destacado de la vista de aterrizaje. */
export interface AgentLandingHighlight {
  title: string;
  subtitle?: string;
  icon?: AllowedIconName;
}

/** Grupo de puntos destacados; el manifiesto declara dos grupos (una tarjeta cada uno). */
export interface AgentLandingHighlightGroup {
  title: string;
  items: AgentLandingHighlight[];
}

/** Contenido de la vista de aterrizaje declarado por el manifiesto (Requirement 4.4). */
export interface AgentLanding {
  title: string;
  subtitle: string;
  highlights: AgentLandingHighlightGroup[];
}

/**
 * Contenido de `manifest.json` tal como se lee de disco: sin validar y sin
 * valores por defecto aplicados.
 */
export type RawAgentManifest = Record<string, unknown>;

/**
 * Manifiesto validado y normalizado: los campos obligatorios están presentes
 * y los opcionales llevan su valor por defecto resuelto (Requirement 2.6).
 */
export interface AgentManifest {
  id: string;
  name: string;
  tagline: string;
  description: string;
  icon: AllowedIconName;
  accentColor: string;
  order: number;
  isDefault: boolean;
  inputMode: InputMode;
  inputPlaceholder: string;
  actionLabel: string;
  supportsInstruction: boolean;
  outputRenderer: OutputRenderer;
  promptFile: string;
  schemaFile: string;
  landing: AgentLanding | null;
}

/* ────────────────────────────────────────────────────────── */
/*  Catálogo                                                   */
/* ────────────────────────────────────────────────────────── */

/**
 * Entrada pública del catálogo: exactamente los campos que expone
 * `GET /api/agents` (Requirements 4.2, 4.5, 16.3). No incluye rutas de disco.
 */
export interface AgentCatalogEntry {
  id: string;
  name: string;
  tagline: string;
  description: string;
  icon: AllowedIconName;
  accentColor: string;
  order: number;
  isDefault: boolean;
  inputMode: InputMode;
  inputPlaceholder: string;
  actionLabel: string;
  supportsInstruction: boolean;
  outputRenderer: OutputRenderer;
  landing: AgentLanding | null;
}

/** Respuesta de `GET /api/agents` (Requirements 3.4, 3.8, 4.1). */
export interface AgentCatalogResponse {
  agents: AgentCatalogEntry[];
  defaultAgentId: string | null;
}

/** Rutas de disco de una carpeta de agente; nunca se exponen al cliente. */
export interface AgentPaths {
  /** Carpeta del agente, `agent/<agentId>`. */
  dir: string;
  manifestPath: string;
  agentsFilePath: string;
  promptPath: string;
  schemaPath: string;
}

/**
 * Definición resuelta de un agente: su manifiesto normalizado más las rutas
 * de disco desde las que se cargan la plantilla, el esquema y las fuentes
 * inline (Requirements 5.1, 16.1).
 */
export interface ResolvedAgentDefinition {
  agentId: string;
  manifest: AgentManifest;
  paths: AgentPaths;
}

/* ────────────────────────────────────────────────────────── */
/*  Guardas de tipo de las enumeraciones                       */
/* ────────────────────────────────────────────────────────── */

/** Comparación exacta y sensible a mayúsculas y minúsculas (Requirement 2.2). */
export function isInputMode(value: unknown): value is InputMode {
  return typeof value === 'string' && (INPUT_MODES as readonly string[]).includes(value);
}

/** Comparación exacta y sensible a mayúsculas y minúsculas (Requirement 2.2). */
export function isOutputRenderer(value: unknown): value is OutputRenderer {
  return typeof value === 'string' && (OUTPUT_RENDERERS as readonly string[]).includes(value);
}

/** Comparación exacta contra la lista blanca de iconos (Requirements 2.3, 16.4). */
export function isAllowedIconName(value: unknown): value is AllowedIconName {
  return typeof value === 'string' && (ALLOWED_ICONS as readonly string[]).includes(value);
}
