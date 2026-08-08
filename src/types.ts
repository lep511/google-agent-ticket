export interface AnalysisReport {
  generated_at: string;
  ticker: string;
  summary: string;
  quant_data?: any;
  fundamental_data?: any;
  insider_data?: any;
  downside_thesis?: any;
  financial_charts?: {
    stock_price_4m: { date: string; price: number }[];
    financial_performance_4q: { quarter: string; revenue?: number; net_income?: number; shares_outstanding?: number }[];
  };
  final_report?: string;
  chartImage?: string;
}

export interface RawAnalysisReport {
  generated_at?: string;
  ticker?: string;
  summary?: string;
  quant_data?: any;
  fundamental_data?: any;
  insider_data?: any;
  downside_thesis?: any;
  financial_charts?: {
    stock_price_4m: { date: string; price: number }[];
    financial_performance_4q: { quarter: string; revenue?: number; net_income?: number; shares_outstanding?: number }[];
  };
  final_report?: string;
  chartImage?: string;
}
/* ──────────────────────────────────────────────────────────── */
/*  Catálogo de agentes                                         */
/*                                                              */
/*  Espejo en el cliente de la superficie pública que expone el */
/*  backend (`server/lib/agentTypes.ts`). Se declara aparte a   */
/*  propósito: el bundle del navegador no debe importar código  */
/*  de servidor.                                                */
/*                                                              */

/* ──────────────────────────────────────────────────────────── */

/** Tipos de entrada principal que puede declarar un agente. */
export const INPUT_MODES = ['ticker', 'text'] as const;

export type InputMode = (typeof INPUT_MODES)[number];

/** Renderizadores de salida que puede declarar un agente. */
export const OUTPUT_RENDERERS = ['financial_report', 'simple_report'] as const;

export type OutputRenderer = (typeof OUTPUT_RENDERERS)[number];

/**
 * Nombre de icono de `lucide-react`. El backend ya lo valida contra su lista
 * permitida; el selector lo resuelve contra el mapa de iconos importados y
 * degrada a un icono genérico si no lo encuentra.
 */
export type AgentIconName = string;

/** Punto destacado de la vista de aterrizaje. */
export interface AgentLandingHighlight {
  title: string;
  subtitle?: string;
  icon?: AgentIconName;
}

/** Grupo de puntos destacados; cada grupo se pinta como una tarjeta. */
export interface AgentLandingHighlightGroup {
  title: string;
  items: AgentLandingHighlight[];
}

/** Contenido de la vista de aterrizaje declarado por el manifiesto del agente. */
export interface AgentLanding {
  title: string;
  subtitle: string;
  highlights: AgentLandingHighlightGroup[];
}

/**
 * Entrada de catálogo tal como la devuelve `GET /api/agents`: exactamente los
 * campos del criterio 4.2, sin rutas de disco ni contenido de archivos.
 */
export interface AgentCatalogEntry {
  id: string;
  name: string;
  tagline: string;
  description: string;
  icon: AgentIconName;
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

/**
 * Respuesta de `GET /api/agents`. `defaultAgentId` es nulo cuando el catálogo
 * está vacío.
 */
export interface AgentCatalogResponse {
  agents: AgentCatalogEntry[];
  defaultAgentId: string | null;
}

/** Evento SSE `agent_info`: primer evento de toda ejecución. */
export interface AgentInfoEvent {
  type: 'agent_info';
  agentId: string;
  agentName: string;
  outputRenderer: OutputRenderer;
}

/* ──────────────────────────────────────────────────────────── */
/*  Contrato de salida `simple_report`                          */
/* ──────────────────────────────────────────────────────────── */

/** Bloque temático del informe; `body` es Markdown. */
export interface SimpleReportSection {
  title: string;
  body: string;
}

/** Fuente consultada por el agente. */
export interface SimpleReportSource {
  title: string;
  url: string;
  date?: string;
}

/** Objeto que producen los agentes con `outputRenderer` igual a `simple_report`. */
export interface SimpleReport {
  summary: string;
  key_points: string[];
  sections: SimpleReportSection[];
  sources: SimpleReportSource[];
}

/**
 * Informe simple recién extraído del texto del modelo: cualquier campo puede
 * faltar o llegar incompleto, así que la vista degrada campo a campo.
 */
export interface RawSimpleReport {
  summary?: string;
  key_points?: string[];
  sections?: Partial<SimpleReportSection>[];
  sources?: Partial<SimpleReportSource>[];
}

/* ──────────────────────────────────────────────────────────── */
/*  Guardas de tipo                                             */
/* ──────────────────────────────────────────────────────────── */

export function isInputMode(value: unknown): value is InputMode {
  return typeof value === 'string' && (INPUT_MODES as readonly string[]).includes(value);
}

export function isOutputRenderer(value: unknown): value is OutputRenderer {
  return typeof value === 'string' && (OUTPUT_RENDERERS as readonly string[]).includes(value);
}
