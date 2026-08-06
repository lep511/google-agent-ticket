import fc from 'fast-check';

/**
 * Configuración compartida de `fast-check` para todas las pruebas basadas en
 * propiedades de esta especificación.
 *
 * Diseño → Testing Strategy: "un mínimo de 100 iteraciones por propiedad".
 * `FC_NUM_RUNS` permite subir el número de iteraciones en ejecuciones largas,
 * pero nunca bajar del mínimo declarado.
 */
export const MIN_PROPERTY_RUNS = 100;

const requestedRuns = Number.parseInt(process.env.FC_NUM_RUNS ?? '', 10);
export const PROPERTY_RUNS = Number.isFinite(requestedRuns)
  ? Math.max(MIN_PROPERTY_RUNS, requestedRuns)
  : MIN_PROPERTY_RUNS;

fc.configureGlobal({
  numRuns: PROPERTY_RUNS,
  // Reporta el contraejemplo completo, sin recortar, para poder triarlo.
  verbose: fc.VerbosityLevel.Verbose,
  // Semilla estable por defecto: los fallos son reproducibles entre ejecuciones.
  ...(process.env.FC_SEED ? { seed: Number.parseInt(process.env.FC_SEED, 10) } : {}),
});
