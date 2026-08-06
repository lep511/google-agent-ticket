# Implementation Plan: Selección de Múltiples Agentes

Plan de Implementación: Selección de Múltiples Agentes

## Overview

La implementación avanza en tres bloques encadenados. Primero se prepara la infraestructura de pruebas (el proyecto todavía no tiene ejecutor) y se migra el agente financiero a `agent/financial_analyst_agent/` extrayendo su prompt y su esquema desde `server.ts`, verificando equivalencia carácter a carácter. Después se construye el backend del catálogo (`server/lib/agentRegistry.ts`, `server/lib/promptBuilder.ts`, `GET /api/agents`, `POST /api/analyze` extendido, logs y descarga por agente). Por último se adapta el frontend (selector, estado persistido, vista de aterrizaje y barra de entrada dinámicas, renderizadores de salida) y se añaden los dos agentes de ejemplo y la documentación.

Lenguaje de implementación: TypeScript, tal como declara el diseño. Ejecutor de pruebas: Vitest, por coherencia con Vite ya presente en el proyecto; `fast-check` como biblioteca de pruebas basadas en propiedades.

## Tasks

- [x] 1. Infraestructura de pruebas y tipos compartidos
  - [x] 1.1 Configurar el ejecutor de pruebas y `fast-check`
    - Añadir `vitest` y `fast-check` como dependencias de desarrollo con versiones fijadas
    - Crear `vitest.config.ts` con entornos separados: `node` para `server/**` y `jsdom` (con `@testing-library/react`) para `src/**`
    - Añadir los scripts `test` (`vitest --run`) y `test:watch` a `package.json`, sin alterar `dev`, `build`, `start` ni `lint`
    - Crear la carpeta `tests/` con `tests/helpers/tempCatalog.ts`: utilidad para materializar catálogos de agentes en un directorio temporal y limpiarlo tras cada prueba
    - Crear `tests/helpers/fakeAgentClient.ts`: doble de prueba de `agentClient`/`agentClientPerseus` que registra las interacciones creadas y emite eventos SSE deterministas, para que ninguna prueba dependa de Gemini
    - Fijar un mínimo de 100 iteraciones por propiedad como configuración compartida de `fast-check`
    - _Diseño: Testing Strategy, Dependencies_

  - [x] 1.2 Definir los tipos y constantes del catálogo en el backend
    - Crear `server/lib/agentTypes.ts` con los tipos del manifiesto, de la entrada de catálogo y de la definición resuelta (manifiesto + rutas)
    - Declarar las enumeraciones `inputMode` (`ticker`, `text`) y `outputRenderer` (`financial_report`, `simple_report`)
    - Declarar la lista blanca de iconos de `lucide-react` permitidos y las constantes de límites (100 carpetas, 64 KB de manifiesto, 256 KiB de plantilla y esquema, 1 MB por archivo de ejecución, profundidad 5, 200 archivos)
    - Declarar los valores por defecto: `order` 100, `isDefault` falso, `supportsInstruction` falso, `promptFile` `prompt.md`, `schemaFile` `output.schema.json`, `accentColor` blanco translúcido, `landing` nulo
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 4.2, 6.1, 16.4_

- [x] 2. Migración del agente financiero con equivalencia de comportamiento
  - [x] 2.1 Trasladar los archivos de ejecución y crear el manifiesto
    - Mover `agent/agent.yaml`, `agent/AGENTS.md` y `agent/requirements.txt` a `agent/financial_analyst_agent/` sin modificar su contenido
    - Dejar la raíz de `agent/` sin archivos de ejecución sueltos
    - Crear `agent/financial_analyst_agent/manifest.json` con `id` `financial_analyst_agent`, `isDefault` verdadero, `inputMode` `ticker`, `outputRenderer` `financial_report`, `supportsInstruction` verdadero, `actionLabel` `Analyze` y el bloque `landing` con el título, subtítulo y los dos grupos de `highlights` que hoy muestra `LandingView`
    - _Requirements: 15.1, 15.4, 9.1_

  - [x] 2.2 Extraer la plantilla de prompt y el esquema de salida desde `server.ts`
    - Crear `agent/financial_analyst_agent/prompt.md` con el prompt financiero actual, sustituyendo el ticker por `{{input}}`, la instrucción por `{{instruction}}` y el esquema embebido por `{{schema}}`
    - Crear `agent/financial_analyst_agent/output.schema.json` con el esquema JSON hoy embebido (`verdict`, `deep_insights`, `findings`, `financial_charts`)
    - Eliminar de `server.ts` la constante del esquema y la construcción literal del prompt, dejando el punto de extensión donde se invocará el ensamblador
    - _Requirements: 7.8, 15.1_

  - [ ]* 2.3 Escribir la prueba de equivalencia del prompt financiero
    - Prueba de ejemplo que compara el prompt ensamblado desde `prompt.md` + `output.schema.json` con el prompt embebido en la versión previa de `server.ts`, fijado como archivo de referencia en `tests/fixtures/legacy_financial_prompt.txt`
    - Comparación carácter a carácter admitiendo solo diferencias de espacios al final de línea y al final del texto
    - Cubrir varios valores de entrada y los casos con y sin instrucción
    - _Requirements: 7.8_

- [x] 3. Registro de agentes: descubrimiento, validación y orden
  - [x] 3.1 Implementar el descubrimiento de carpetas y la caché por marca de tiempo
    - Crear `server/lib/agentRegistry.ts` con la enumeración de hasta 100 subcarpetas directas de `agent/` y la lectura de cada `manifest.json`
    - Mantener el catálogo en memoria y reconstruirlo solo cuando cambia la marca de tiempo de modificación de `agent/`
    - Descartar con advertencia las carpetas sin `manifest.json`, con manifiesto mayor de 64 KB, con nombre fuera de snake_case o con error del sistema de archivos, conservando el resto del catálogo
    - Garantizar que cada agentId aparece una sola vez y que el descubrimiento no lee el contenido de los archivos de ejecución
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.9, 1.10, 1.11, 4.6, 4.7, 6.4, 9.9_

  - [ ]* 3.2 Escribir prueba de propiedad para el descubrimiento del catálogo
    - **Property 1: Descubrimiento completo del catálogo**
    - **Validates: Requirements 1.1, 1.2, 1.11, 17.1**

  - [x] 3.3 Implementar la validación de manifiestos y los valores por defecto
    - Validar presencia, tipo, no vacuidad y longitudes máximas de `id`, `name`, `tagline`, `description`, `icon`, `inputMode`, `inputPlaceholder`, `actionLabel` y `outputRenderer`
    - Validar `inputMode`, `outputRenderer` e `icon` por comparación exacta contra sus valores permitidos y la lista blanca de iconos
    - Exigir que `AGENTS.md`, el archivo de prompt y el archivo de esquema existan, sean legibles, no estén vacíos, y que el esquema contenga JSON válido
    - Exigir que `id` coincida carácter a carácter con el nombre de la carpeta
    - Aplicar los valores por defecto de los campos opcionales omitidos y degradar a valor por defecto con advertencia los campos opcionales con tipo incorrecto, conservando la entrada
    - Capturar cualquier excepción de validación, omitir esa carpeta con exactamente una advertencia (ruta relativa y primer campo o archivo causante) y continuar con las restantes
    - Normalizar `order` a entero entre 0 y 9999, usando 100 fuera de rango
    - _Requirements: 1.3, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 16.4_

  - [ ]* 3.4 Escribir prueba de propiedad para la robustez del catálogo
    - **Property 11: Robustez del catálogo**
    - **Validates: Requirements 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 9.9, 16.4**

  - [ ]* 3.5 Escribir prueba de propiedad para los valores por defecto del manifiesto
    - **Property 14: Valores por defecto del manifiesto**
    - **Validates: Requirements 2.6**

  - [x] 3.6 Implementar el orden total del catálogo
    - Ordenar por `order` ascendente, luego por `name` alfabético sin distinguir mayúsculas y minúsculas, luego por agentId ascendente
    - _Requirements: 1.7, 1.8_

  - [ ]* 3.7 Escribir prueba de propiedad para el orden total del catálogo
    - **Property 15: Orden total del catálogo**
    - **Validates: Requirements 1.8**

  - [x] 3.8 Implementar la resolución del agente por defecto
    - Aplicar la precedencia: único `isDefault` verdadero, luego `financial_analyst_agent`, luego la primera entrada según el orden total
    - Registrar advertencia cuando el número de entradas con `isDefault` verdadero es distinto de uno y cuando el catálogo queda vacío
    - Exponer un único `defaultAgentId` estable entre reconstrucciones y volver a resolverlo en cada reconstrucción
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 3.9 Escribir prueba de propiedad para la unicidad del agente por defecto
    - **Property 4: Unicidad del agente por defecto**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6, 3.7**

  - [ ]* 3.10 Escribir pruebas de ejemplo de la caché, la normalización y la degradación del manifiesto
    - Catálogo servido desde memoria sin releer manifiestos mientras la marca de tiempo de `agent/` no cambia, y reconstruido cuando cambia
    - `order` ausente, no entero o fuera del rango 0-9999 normalizado a 100; `order` válido conservado
    - Campo opcional con tipo incorrecto: se aplica su valor por defecto, la entrada se conserva y se registra una advertencia
    - Excepción lanzada durante la validación: la carpeta se omite con una advertencia y el resto del catálogo se conserva
    - Reconstrucción de un catálogo de 50 carpetas dentro de 3 s
    - _Requirements: 1.7, 1.9, 1.10, 2.7, 2.8, 4.7_

- [x] 4. Registro de agentes: resolución de identificadores y fuentes inline
  - [x] 4.1 Implementar la resolución de `agentId` con contención de rutas
    - Resolver por coincidencia exacta contra los identificadores descubiertos y construir las rutas solo desde la entrada de catálogo, nunca concatenando el valor recibido
    - Tratar como desconocido todo valor ausente, vacío, con separadores de ruta, secuencias de recorrido o caracteres fuera de snake_case, devolviendo el agente por defecto con advertencia
    - Exponer las operaciones de listar catálogo, obtener agente por id, obtener agente por defecto, obtener plantilla y obtener esquema
    - _Requirements: 5.1, 5.2, 16.1, 16.2_

  - [ ]* 4.2 Escribir prueba de propiedad para la resolución total del agente
    - **Property 3: Resolución total del agente**
    - **Validates: Requirements 5.1, 5.2**

  - [ ]* 4.3 Escribir prueba de propiedad para la contención de rutas del identificador
    - **Property 19: Contención de rutas del identificador de agente**
    - **Validates: Requirements 16.1, 16.2**

  - [ ]* 4.4 Escribir prueba de propiedad para la identidad estable del identificador
    - **Property 5: Identidad estable del identificador**
    - **Validates: Requirements 1.2, 1.3, 1.11**

  - [x] 4.5 Implementar la carga de fuentes inline aisladas por agente
    - Trasladar la lógica recursiva de `loadAgentFiles` desde `server.ts` al registro, con destino `/.agents` y preservando la ruta relativa de cada archivo
    - Recorrer únicamente la carpeta del agente resuelto, con profundidad máxima 5 y máximo 200 archivos, descartando con advertencia lo que exceda los límites
    - Excluir `manifest.json`, el archivo de prompt y el archivo de esquema declarados en el manifiesto
    - Excluir todo archivo cuya ruta resuelta quede fuera de la carpeta del agente, incluidos enlaces simbólicos, archivos sueltos de la raíz de `agent/` y archivos de otras carpetas de agente
    - Omitir con advertencia los archivos ilegibles y los mayores de 1 MB; fallar con error explícito que nombra el agentId si el conjunto queda vacío
    - Cargar el contenido solo durante la resolución de una ejecución
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [ ]* 4.6 Escribir prueba de propiedad para el aislamiento del contexto del agente
    - **Property 2: Aislamiento del contexto del agente**
    - **Validates: Requirements 6.1, 6.2, 6.3**

  - [ ]* 4.7 Escribir pruebas de ejemplo de los límites de las fuentes inline
    - Archivo ilegible: se omite con advertencia y las demás fuentes inline se conservan
    - Archivo mayor de 1 MB: se omite con advertencia que indica su ruta relativa y su tamaño
    - Conjunto vacío tras exclusiones y límites: error explícito que nombra el agentId, sin interacción remota
    - Profundidad mayor de 5 niveles y más de 200 archivos: descarte con advertencia que indica la ruta y el límite excedido
    - _Requirements: 6.1, 6.5, 6.6, 6.7_

- [ ] 5. Checkpoint - Registro de agentes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Ensamblador de prompt
  - [x] 6.1 Implementar `server/lib/promptBuilder.ts`
    - Sustituir todas las apariciones de `{{input}}` por el valor de entrada efectivo validado y recortado, y de `{{schema}}` por el contenido literal del archivo de esquema
    - Sustituir `{{instruction}}` por el valor recibido solo cuando el agente declara `supportsInstruction` verdadero, y por cadena vacía en cualquier otro caso o cuando la instrucción queda vacía
    - Insertar exactamente una vez el bloque común de reglas de salida JSON al final del prompt, después de todo el texto de la plantilla
    - Fallar con error explícito que nombra el marcador cuando la plantilla original contiene un `{{...}}` no soportado, examinando solo la plantilla y no el texto sustituido
    - Fallar con error explícito que nombra el archivo si la lectura o el análisis de la plantilla o del esquema falla, o si alguno supera 256 KiB
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.9, 7.10_

  - [ ]* 6.2 Escribir prueba de propiedad para el ensamblado completo del prompt
    - **Property 16: Ensamblado completo del prompt**
    - **Validates: Requirements 7.1, 7.2, 7.3**

  - [ ]* 6.3 Escribir prueba de propiedad para los marcadores sin resolver
    - **Property 17: Los marcadores sin resolver detienen la ejecución**
    - **Validates: Requirements 7.4, 7.5**

  - [ ]* 6.4 Escribir prueba de propiedad para el tratamiento de la instrucción
    - **Property 18: Tratamiento de la instrucción según el manifiesto**
    - **Validates: Requirements 7.6, 5.7**

  - [ ]* 6.5 Escribir pruebas unitarias de ejemplo del ensamblador
    - Valor de entrada, instrucción y esquema que contienen la forma `{{...}}` y no provocan fallo
    - Plantilla y esquema que superan 256 KiB
    - Instrucción ausente y vacía tras recortar espacios
    - Tiempo de ensamblado dentro de 500 ms
    - _Requirements: 7.5, 7.7, 7.9, 7.10_

- [x] 7. Endpoint de catálogo `GET /api/agents`
  - [x] 7.1 Implementar el endpoint de catálogo en `server.ts`
    - Responder 200 con la lista ordenada y el `defaultAgentId` resuelto, construyendo la respuesta solo desde el catálogo en memoria
    - Incluir exactamente los campos `id`, `name`, `tagline`, `description`, `icon`, `accentColor`, `order`, `isDefault`, `inputMode`, `inputPlaceholder`, `actionLabel`, `supportsInstruction`, `outputRenderer` y `landing`
    - Reportar `isDefault` verdadero solo en la entrada cuyo agentId coincide con `defaultAgentId`
    - Exponer `landing` con `title`, `subtitle` y grupos de `highlights`, o nulo cuando el manifiesto lo omite
    - Excluir rutas del sistema de archivos y el contenido de `AGENTS.md`, del prompt y del esquema
    - Responder 200 con lista vacía y `defaultAgentId` nulo cuando no hay agentes válidos, y 500 con mensaje sin rutas cuando la enumeración de `agent/` falla, conservando el catálogo vigente
    - Responder las entradas válidas aunque otras carpetas hayan sido descartadas por la validación
    - _Requirements: 2.9, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.8, 16.3, 16.5_

  - [ ]* 7.2 Escribir prueba de propiedad para la superficie mínima del catálogo
    - **Property 13: Superficie mínima del catálogo**
    - **Validates: Requirements 4.2, 4.5, 16.3**

  - [ ]* 7.3 Escribir pruebas de ejemplo del endpoint de catálogo
    - Catálogo vacío: 200 con lista vacía y `defaultAgentId` nulo
    - Error del sistema de archivos: 500 con mensaje sin rutas y catálogo previo conservado
    - Catálogo con carpetas descartadas: responde solo las entradas válidas
    - _Requirements: 2.9, 3.8, 4.8_

- [x] 8. Endpoint de ejecución `POST /api/analyze` extendido
  - [x] 8.1 Implementar la entrada efectiva y la validación por `inputMode`
    - Usar `input` como valor principal y `ticker` como alias heredado cuando `input` está ausente, nulo o vacío tras recortar espacios
    - Validar `ticker` como 1 a 10 caracteres `A`-`Z` y `0`-`9` tras recortar y pasar a mayúsculas, y `text` como 1 a 2000 caracteres tras recortar
    - Responder 400 con error que identifica el campo y el límite ante entrada ausente, no cadena, vacía, fuera de formato, mayor de 10.000 caracteres, o `instruction` no cadena o mayor de 2000 caracteres
    - Validar antes de cargar fuentes inline, antes de ensamblar el prompt y antes de abrir el flujo SSE, con una única respuesta de error no SSE y sin escribir logs
    - _Requirements: 5.9, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.2, 9.3, 9.4, 9.5_

  - [ ]* 8.2 Escribir prueba de propiedad para la validación previa a la ejecución
    - **Property 10: Validación previa a la ejecución**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**

  - [ ]* 8.3 Escribir prueba de propiedad para la compatibilidad hacia atrás
    - **Property 9: Compatibilidad hacia atrás**
    - **Validates: Requirements 9.1, 9.2, 9.3**

  - [x] 8.4 Ejecutar el agente resuelto y emitir el evento `agent_info`
    - Resolver el agente antes de escribir las cabeceras SSE y cargar sus fuentes inline y su prompt desde el registro y el ensamblador
    - Emitir exactamente un evento `agent_info` con `agentId`, `agentName` y `outputRenderer` antes de cualquier otro evento de la ejecución
    - Conservar sin cambios las cabeceras SSE y los tipos `thinking`, `text`, `tool_call`, `tool_result`, `complete`, `error`, `done` y `final_stats`
    - Pasar `instruction` al ensamblador solo cuando el agente declara `supportsInstruction`, descartándola en otro caso
    - Seleccionar `agentClientPerseus` solo cuando `model` es exactamente `perseus` tras recortar espacios, y `agentClient` en cualquier otro caso
    - Rechazar antes de las cabeceras SSE, con error de configuración y sin invocar cliente ni escribir logs, cuando el catálogo está vacío
    - Ante fallo o interrupción del cliente tras las cabeceras SSE, emitir `error`, luego `done`, cerrar el flujo y conservar eventos y logs escritos
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.10, 16.2, 16.5_

  - [ ]* 8.5 Escribir pruebas de ejemplo del flujo SSE
    - `agent_info` es el primer evento y aparece una sola vez, con el doble de prueba del cliente remoto
    - `agentId` desconocido: ejecuta el agente por defecto e informa el agentId efectivo sin rechazar la petición
    - Catálogo vacío: error de configuración sin cabeceras SSE ni logs
    - Fallo del cliente a mitad del flujo: secuencia `error` seguida de `done`
    - `model` igual a `perseus` frente a cualquier otro valor: cliente seleccionado
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.8, 5.10_

- [x] 9. Trazabilidad de ejecuciones y descarga de logs
  - [x] 9.1 Nombrar los logs por agente y actualizar `final_stats`
    - Escribir `run_log_<agentId>_<input>_<runId>.jsonl` y `run_log_<agentId>_<input>_<runId>.txt`
    - Emitir en `final_stats` una `jsonlLogUrl` que apunta al `.jsonl` de esa ejecución bajo `/run_logs`
    - _Requirements: 10.1, 10.2_

  - [ ]* 9.2 Escribir prueba de propiedad para la trazabilidad de ejecuciones
    - **Property 12: Trazabilidad de ejecuciones**
    - **Validates: Requirements 10.1, 10.2**

  - [x] 9.3 Extender `GET /api/download_jsonl` con el parámetro `agent`
    - Aceptar `agent` opcional: con él, devolver el `.jsonl` más reciente de esa entrada y ese agentId; sin él, el más reciente de esa entrada para cualquier agentId
    - Reconocer el patrón nuevo `run_log_<agentId>_<input>_<runId>` y el patrón heredado `run_log_<input>_<runId>`, comparando la entrada sin distinguir mayúsculas y minúsculas y seleccionando el `runId` más alto
    - Responder 400 identificando el parámetro `ticker` cuando está ausente, vacío o contiene caracteres fuera de `A`-`Z`, `a`-`z` y `0`-`9`, sin enumerar `run_logs/`
    - Responder 404 cuando no existe ningún `.jsonl` para los parámetros recibidos
    - Mantener el servicio estático `/run_logs` sirviendo los logs históricos con su nombre original, sin renombrarlos
    - _Requirements: 9.6, 9.7, 9.8, 10.3, 10.4, 10.5_

  - [ ]* 9.4 Escribir prueba de propiedad para la selección del log más reciente
    - **Property 20: Selección del log más reciente**
    - **Validates: Requirements 10.3, 10.4**

  - [ ]* 9.5 Escribir pruebas de ejemplo del endpoint de descarga
    - `ticker` ausente, vacío o con caracteres no permitidos: 400 sin enumerar `run_logs/`
    - Sin coincidencias: 404
    - Log histórico con nombre anterior servido por `/run_logs` sin renombrado
    - _Requirements: 9.7, 9.8, 10.5_

- [ ] 10. Checkpoint - Backend completo
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Agentes de ejemplo del catálogo inicial
  - [x] 11.1 Crear `agent/market_news_agent/`
    - `manifest.json` con `inputMode` `ticker`, `outputRenderer` `simple_report`, icono de la lista permitida, `actionLabel` de resumen de noticias y bloque `landing`
    - `agent.yaml` con `base_agent` `antigravity-preview-05-2026`, entorno remoto sin fuentes preconfiguradas y `google_search` como única herramienta
    - `AGENTS.md` con reglas de espacio de trabajo, flujo de trabajo, reglas anti-alucinación y formato de salida, siguiendo el patrón del analista financiero
    - `requirements.txt` con las mismas dependencias mínimas
    - `prompt.md` con marcadores `{{input}}`, `{{instruction}}` y `{{schema}}`, y `output.schema.json` conforme al contrato `simple_report`
    - _Requirements: 15.2, 15.5, 15.6_

  - [x] 11.2 Crear `agent/company_profile_agent/`
    - Misma estructura de seis archivos que la tarea anterior, con `inputMode` `text` y `outputRenderer` `simple_report`
    - `agent.yaml` con `base_agent` `antigravity-preview-05-2026`, entorno sin fuentes preconfiguradas y `google_search` como única herramienta
    - `prompt.md` orientado a perfil corporativo (modelo de negocio, segmentos, competidores, riesgos) y `output.schema.json` conforme al contrato `simple_report`
    - _Requirements: 15.3, 15.5, 15.6_

  - [ ]* 11.3 Escribir prueba de propiedad para la conformidad del esquema de informe simple
    - **Property 28: Conformidad del esquema de informe simple**
    - **Validates: Requirements 15.5**

- [x] 12. Frontend: tipos, catálogo y estado del agente activo
  - [x] 12.1 Añadir los tipos de agente en `src/types.ts`
    - Tipos de la entrada de catálogo, de la respuesta de `GET /api/agents`, del evento `agent_info`, del contrato `simple_report` (`summary`, `key_points`, `sections`, `sources`) y de los valores de `inputMode` y `outputRenderer`
    - _Requirements: 4.2, 14.3_

  - [x] 12.2 Implementar el estado de agente activo con `localStorage` en `src/App.tsx`
    - Solicitar el catálogo al montar y fijar como agente activo el agentId almacenado en `tickr.selectedAgentId` cuando está en el catálogo
    - Fijar el `defaultAgentId` y sobrescribir el valor almacenado cuando el agentId almacenado no está en el catálogo
    - Persistir la selección al cambiar y vaciar informe, eventos, métricas y error previos en cada cambio de agente
    - Enviar el agentId del agente activo en el cuerpo de `POST /api/analyze` y conservar el agente y el renderizador de la ejecución en curso
    - Reconciliar la selección cuando el evento `agent_info` informa un agentId distinto del enviado, almacenando el informado
    - Continuar con el último agente conocido cuando la petición del catálogo falla
    - _Requirements: 11.8, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [ ]* 12.3 Escribir prueba de propiedad para la persistencia de la selección
    - **Property 6: Persistencia idempotente de la selección**
    - **Validates: Requirements 12.1, 12.2, 12.3**

  - [ ]* 12.4 Escribir prueba de propiedad para la ausencia de contaminación entre agentes
    - **Property 8: Ausencia de contaminación entre agentes**
    - **Validates: Requirements 12.4**

  - [ ]* 12.5 Escribir prueba de propiedad para la reconciliación de la selección con la ejecución
    - **Property 26: Reconciliación de la selección con la ejecución**
    - **Validates: Requirements 12.5, 12.6**

- [x] 13. Selector de agentes en la interfaz
  - [x] 13.1 Implementar `src/components/AgentSelector.tsx`
    - Botón disparador con icono y `name` del agente activo más indicador de despliegue, sobre la paleta `stone`
    - Panel emergente `bg-black/20 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl` con una tarjeta por agente: icono, `name`, `tagline`, etiqueta de `inputMode` y marca de "Predeterminado" en el agente por defecto
    - Marcar el agente activo con su color de acento y un icono de comprobación
    - Cerrar con `Escape`, clic fuera o selección; mover el foco con flechas, `Home` y `End`, y confirmar con `Enter` o `Espacio`
    - Estados de carga, de error con acción de reintento y vacío explicativo
    - Animaciones con `motion` y `AnimatePresence`, tipografías `font-sans` y `font-display`, iconos resueltos solo desde la lista permitida
    - _Requirements: 11.1, 11.2, 11.3, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10_

  - [x] 13.2 Integrar el selector en la cabecera y bloquear el cambio durante la ejecución
    - Montar el selector en la cabecera de `src/App.tsx` conectado al estado de agente activo
    - Impedir el cambio de agente mientras hay una ejecución en curso y mostrar el texto que explica el motivo
    - Sustituir la etiqueta fija del modelo en la cabecera del panel de ejecución por el `name` del agente activo, con el nombre del modelo como texto secundario
    - Mantener deshabilitado el botón de ejecución cuando el catálogo está vacío
    - _Requirements: 11.4, 11.9, 12.7_

  - [ ]* 13.3 Escribir prueba de propiedad para la fidelidad del selector
    - **Property 21: Fidelidad del selector a la identidad del agente**
    - **Validates: Requirements 11.1, 11.2, 11.3, 12.7**

  - [ ]* 13.4 Escribir prueba de propiedad para el bloqueo del cambio durante una ejecución
    - **Property 22: Bloqueo del cambio durante una ejecución**
    - **Validates: Requirements 11.4**

  - [ ]* 13.5 Escribir pruebas de ejemplo de interacción y estados del selector
    - Cierre con `Escape`, con clic fuera y al seleccionar
    - Navegación con flechas, `Home`, `End` y confirmación con `Enter` y `Espacio`
    - Estado de carga, estado de error con reintento y estado vacío
    - _Requirements: 11.5, 11.6, 11.7, 11.8, 11.9_

- [x] 14. Vista de aterrizaje y barra de entrada adaptativas
  - [x] 14.1 Hacer dinámica `src/LandingView.tsx`
    - Renderizar `title`, `subtitle` y los grupos de `highlights` del campo `landing` del agente activo con la composición de dos tarjetas existente
    - Degradar a `name`, `tagline` y `description` cuando el manifiesto omite `landing`
    - _Requirements: 13.1, 13.2_

  - [x] 14.2 Implementar la barra de entrada adaptativa en `src/App.tsx`
    - Campo corto en mayúsculas, monoespaciado y con icono de búsqueda para `inputMode` `ticker`; campo ancho de texto libre para `text`
    - Usar `inputPlaceholder` como texto de ayuda y `actionLabel` como etiqueta del botón de ejecución
    - Mostrar el campo de instrucción solo cuando el agente declara `supportsInstruction` verdadero
    - Mantener el botón deshabilitado mientras la entrada no cumple las reglas de longitud y conjunto de caracteres del `inputMode` activo, y habilitarlo cuando las cumple
    - Mantener visible el aviso legal bajo la barra de entrada
    - _Requirements: 8.7, 8.8, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8_

  - [ ]* 14.3 Escribir prueba de propiedad para la adaptación de la interfaz al manifiesto
    - **Property 23: Adaptación de la interfaz al manifiesto**
    - **Validates: Requirements 8.7, 8.8, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7**

- [x] 15. Renderizado del resultado por agente
  - [x] 15.1 Generalizar el extractor de resultado en `src/App.tsx`
    - Parametrizar el conjunto de claves raíz aceptadas por el `outputRenderer` de la ejecución: `verdict`, `findings` o `deep_insights` para `financial_report`; `summary`, `key_points`, `sections` o `sources` para `simple_report`
    - Conservar la estrategia actual: último bloque ```json válido con degradación a búsqueda por llaves exteriores
    - Cuando no existe objeto válido, no promover informe, conservar el texto crudo en la línea de tiempo y mostrar el aviso de informe no estructurado
    - _Requirements: 14.4, 14.5, 14.6_

  - [ ]* 15.2 Escribir prueba de propiedad para la extracción de resultado
    - **Property 24: Extracción de resultado del texto final**
    - **Validates: Requirements 14.4, 14.5, 14.6**

  - [x] 15.3 Crear `src/components/SimpleReportView.tsx`
    - Renderizar `summary`, todos los `key_points`, el `title` y el `body` de cada sección y todas las `sources` con `title`, `url` y `date`
    - Usar `FormattedMarkdown` para todo el contenido del modelo, sin insertar HTML ni scripts procedentes de ese contenido
    - Reutilizar la estética de tarjetas del proyecto
    - _Requirements: 14.3, 14.7_

  - [ ]* 15.4 Escribir prueba de propiedad para la completitud del informe simple
    - **Property 25: Completitud del informe simple**
    - **Validates: Requirements 14.3**

  - [x] 15.5 Seleccionar el renderizador según la ejecución que produjo el resultado
    - Elegir `ReportTemplate` o `SimpleReportView` a partir del `outputRenderer` recibido en el `agent_info` de esa ejecución, sin modificar el contrato de props de `ReportTemplate`
    - Mantener el renderizador correcto aunque el agente activo cambie después de iniciarse la ejecución
    - _Requirements: 14.1, 14.2, 14.3_

  - [ ]* 15.6 Escribir prueba de propiedad para la coherencia de renderizado
    - **Property 7: Coherencia de renderizado**
    - **Validates: Requirements 14.1, 14.2**

  - [ ]* 15.7 Escribir prueba de propiedad para la salida sin HTML ejecutable
    - **Property 27: Salida del modelo sin HTML ejecutable**
    - **Validates: Requirements 14.7**

- [ ] 16. Checkpoint - Frontend completo
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Integración final y documentación
  - [ ]* 17.1 Escribir las pruebas de integración del catálogo y de las ejecuciones
    - `GET /api/agents` devuelve los tres agentes del catálogo inicial con el analista financiero como por defecto
    - `POST /api/analyze` sin `agentId` reproduce el flujo actual: mismo agente, mismas fuentes inline, mismo esquema
    - `POST /api/analyze` con cada uno de los tres agentes emite `agent_info` con el renderizador correcto y escribe logs cuyo nombre incluye el agentId
    - La raíz de `agent/` contiene únicamente carpetas de agente, y el `agent.yaml` de los dos agentes nuevos declara `base_agent` `antigravity-preview-05-2026` y un entorno sin fuentes preconfiguradas
    - Usar el doble de prueba del cliente remoto para no depender de Gemini
    - _Requirements: 5.3, 9.1, 10.1, 15.1, 15.2, 15.3, 15.4, 15.6_

  - [x] 17.2 Actualizar `README.md` y `overview.md`
    - Describir la estructura de una carpeta de agente y los campos del manifiesto con sus valores por defecto
    - Documentar los pasos para añadir un agente nuevo sin modificar código TypeScript
    - Enumerar los archivos de metadata que no se suben al entorno remoto (`manifest.json`, archivo de prompt, archivo de esquema)
    - Documentar el parámetro `agent` de `GET /api/download_jsonl` y el patrón de nombres de log
    - _Requirements: 17.1, 17.2, 17.3_

- [ ] 18. Checkpoint final
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Las tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido; la tarea 1.1 no es opcional porque instala el ejecutor de pruebas del que dependen todas las demás.
- Cada tarea referencia los criterios de aceptación que implementa; las tareas de prueba basada en propiedades referencian además la propiedad del diseño que validan.
- Las 28 propiedades de la sección "Correctness Properties" del diseño están cubiertas: 1 (3.2), 2 (4.6), 3 (4.2), 4 (3.9), 5 (4.4), 6 (12.3), 7 (15.6), 8 (12.4), 9 (8.3), 10 (8.2), 11 (3.4), 12 (9.2), 13 (7.2), 14 (3.5), 15 (3.7), 16 (6.2), 17 (6.3), 18 (6.4), 19 (4.3), 20 (9.4), 21 (13.3), 22 (13.4), 23 (14.3), 24 (15.2), 25 (15.4), 26 (12.5), 27 (15.7), 28 (11.3).
- Los criterios de configuración estática, contenido del repositorio, límites de recursos y estados puntuales de interfaz se cubren con pruebas de ejemplo (2.3, 3.10, 4.7, 6.5, 7.3, 8.5, 9.5, 13.5) y con las pruebas de integración (17.1), tal como indica la sección "Testing Strategy".
- Los 17 requisitos quedan cubiertos por tareas de implementación: Requirement 1 (1.2, 3.1, 3.3, 3.6), 2 (1.2, 3.3, 7.1), 3 (3.8, 7.1), 4 (3.1, 7.1), 5 (4.1, 8.1, 8.4), 6 (4.5), 7 (2.2, 6.1), 8 (8.1, 14.2), 9 (2.1, 8.1, 9.3), 10 (9.1, 9.3), 11 (13.1, 13.2), 12 (12.1, 12.2, 13.2), 13 (14.1, 14.2), 14 (12.1, 15.1, 15.3, 15.5), 15 (2.1, 2.2, 11.1, 11.2), 16 (1.2, 4.1, 7.1, 8.4), 17 (3.1, 17.2).
- La tarea 2.3 es la verificación de equivalencia carácter a carácter del prompt financiero exigida por el criterio 7.8; conviene ejecutarla antes de continuar con el resto del backend.
- La tarea 3.9 valida también el criterio 3.7, que se implementa en la tarea 7.1; por eso el grafo de dependencias la programa después del endpoint de catálogo y no junto al resto de las pruebas del registro.
- Las pruebas basadas en propiedades usan `fast-check` con un mínimo de 100 iteraciones y sustituyen el cliente remoto por un doble de prueba.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1"] },
    { "id": 1, "tasks": ["2.2", "3.1", "11.1", "12.1"] },
    { "id": 2, "tasks": ["2.3", "3.3", "11.2", "13.1"] },
    { "id": 3, "tasks": ["3.2", "3.6", "11.3", "12.2"] },
    { "id": 4, "tasks": ["3.4", "3.5", "3.8", "13.2", "14.1"] },
    { "id": 5, "tasks": ["3.7", "3.10", "4.1", "6.1", "14.2"] },
    { "id": 6, "tasks": ["4.2", "4.3", "4.4", "4.5", "6.2", "15.1"] },
    { "id": 7, "tasks": ["4.6", "4.7", "6.3", "6.4", "6.5", "15.2", "15.3", "15.5"] },
    { "id": 8, "tasks": ["7.1", "12.3", "12.4", "12.5", "13.3", "13.4", "13.5", "14.3", "15.4", "15.6", "15.7"] },
    { "id": 9, "tasks": ["3.9", "7.2", "7.3", "8.1"] },
    { "id": 10, "tasks": ["8.2", "8.3", "8.4"] },
    { "id": 11, "tasks": ["8.5", "9.1"] },
    { "id": 12, "tasks": ["9.2", "9.3"] },
    { "id": 13, "tasks": ["9.4", "9.5", "17.2"] },
    { "id": 14, "tasks": ["17.1"] }
  ]
}
```
