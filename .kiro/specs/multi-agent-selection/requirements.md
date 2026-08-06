# Requirements Document

Documento de Requisitos: Selección de Múltiples Agentes

## Introduction

Esta especificación convierte el agente único e implícito de Tickr en un **catálogo de agentes descubierto desde el sistema de archivos**, con un selector de agentes en la interfaz. Cada agente vive en su propia carpeta bajo `agent/` con un manifiesto que declara su identidad, su metadata visual, el tipo de entrada que espera, la plantilla de prompt y el renderizador de su salida. El agente financiero actual se traslada a `agent/financial_analyst_agent/` sin cambios funcionales y se marca como agente por defecto; se añaden dos agentes de ejemplo (`market_news_agent` y `company_profile_agent`).

Los requisitos se derivan del documento de diseño `design.md` de esta misma especificación y se expresan en formato EARS. Las palabras clave EARS (`WHEN`, `WHILE`, `IF`, `THEN`, `WHERE`, `THE`, `SHALL`) se mantienen en inglés por convención; el resto del contenido está en español para ser coherente con el diseño.

## Glossary

- **Agent_Registry**: módulo de servidor (`server/lib/agentRegistry.ts`) que descubre, valida, cachea y resuelve los agentes disponibles en disco.
- **Prompt_Builder**: módulo de servidor (`server/lib/promptBuilder.ts`) que ensambla el prompt final a partir de la plantilla del agente, la entrada del usuario y el esquema de salida.
- **Catalog_Endpoint**: endpoint HTTP `GET /api/agents`.
- **Analyze_Endpoint**: endpoint HTTP `POST /api/analyze`.
- **Download_Endpoint**: endpoint HTTP `GET /api/download_jsonl`.
- **Agent_Selector**: componente de interfaz (`src/components/AgentSelector.tsx`) que permite elegir el agente activo.
- **Web_Client**: aplicación de frontend (`src/App.tsx` y sus componentes).
- **Result_Extractor**: función del Web_Client que extrae el objeto de informe del texto final producido por un agente.
- **Manifiesto**: archivo `manifest.json` dentro de la carpeta de un agente, con la metadata de catálogo, interfaz y contrato de entrada/salida.
- **Carpeta de agente**: subcarpeta directa de `agent/` que contiene un Manifiesto válido.
- **agentId**: identificador de un agente; coincide con el nombre de su Carpeta de agente y usa snake_case.
- **Archivos de ejecución**: archivos de la Carpeta de agente que se suben al entorno remoto como fuentes inline con destino `/.agents` (`agent.yaml`, `AGENTS.md`, `requirements.txt` y subcarpetas propias).
- **Archivos de metadata**: archivos de la Carpeta de agente que el servidor consume y **no** sube al entorno remoto (`manifest.json`, archivo de prompt, archivo de esquema).
- **inputMode**: tipo de entrada principal declarado por el Manifiesto; valores permitidos `ticker` y `text`.
- **outputRenderer**: componente de presentación del resultado declarado por el Manifiesto; valores permitidos `financial_report` y `simple_report`.
- **Agente por defecto**: agente único que el Agent_Registry usa cuando la petición no identifica un agente válido.
- **Agente activo**: agente actualmente seleccionado en el Web_Client.
- **Icono permitido**: nombre de icono de `lucide-react` incluido en la lista blanca del Agent_Registry.

## Requirements

### Requirement 1: Descubrimiento del catálogo de agentes

**User Story:** Como desarrollador del proyecto, quiero que cada agente viva en su propia carpeta bajo `agent/` y sea descubierto automáticamente, para añadir agentes nuevos sin editar ningún registro en código.

#### Acceptance Criteria

1. WHEN THE Agent_Registry construye el catálogo, THE Agent_Registry SHALL enumerar hasta 100 subcarpetas directas de `agent/`, leer el archivo `manifest.json` de cada una y completar la construcción en 2000 ms o menos.
2. WHEN una subcarpeta directa de `agent/` contiene un Manifiesto válido, THE Agent_Registry SHALL incluir en el catálogo exactamente una entrada cuyo agentId es el nombre de esa subcarpeta.
3. IF el campo `id` de un Manifiesto difiere carácter a carácter del nombre de su carpeta, THEN THE Agent_Registry SHALL omitir esa carpeta del catálogo y registrar una advertencia con la ruta relativa de la carpeta y el valor de `id` recibido.
4. IF el nombre de una subcarpeta directa de `agent/` no está en snake_case, entendido como una o más secuencias de caracteres `a`-`z` y `0`-`9` separadas por un único carácter `_`, THEN THE Agent_Registry SHALL omitir esa subcarpeta del catálogo y registrar una advertencia con su nombre.
5. IF una subcarpeta directa de `agent/` carece del archivo `manifest.json`, o el tamaño de ese archivo supera 64 KB, THEN THE Agent_Registry SHALL omitir esa subcarpeta del catálogo, registrar una advertencia con su nombre y el motivo, y conservar las demás entradas del catálogo.
6. IF la lectura de una subcarpeta directa de `agent/` o de su archivo `manifest.json` produce un error del sistema de archivos, THEN THE Agent_Registry SHALL omitir esa subcarpeta del catálogo, registrar una advertencia con su ruta relativa y el motivo, y conservar las demás entradas del catálogo.
7. WHEN THE Agent_Registry construye una entrada del catálogo, THE Agent_Registry SHALL interpretar el campo `order` del Manifiesto como un número entero entre 0 y 9999, y SHALL usar el valor 100 cuando el Manifiesto omite ese campo o declara un valor fuera de ese rango.
8. WHEN THE Agent_Registry construye el catálogo, THE Agent_Registry SHALL ordenar las entradas por `order` ascendente, ante valores de `order` iguales por `name` en orden alfabético ascendente sin distinguir mayúsculas y minúsculas, y ante valores de `name` iguales por agentId en orden alfabético ascendente.
9. WHILE la marca de tiempo de modificación de `agent/` no cambia, THE Agent_Registry SHALL servir el catálogo desde memoria sin releer ningún archivo `manifest.json`.
10. WHEN la marca de tiempo de modificación de `agent/` cambia, THE Agent_Registry SHALL reconstruir el catálogo aplicando los criterios 1 a 8 de este requisito.
11. WHEN THE Agent_Registry publica el catálogo, THE Agent_Registry SHALL incluir cada agentId una sola vez.

### Requirement 2: Validación de manifiestos y robustez del catálogo

**User Story:** Como operador de la aplicación, quiero que un agente mal declarado se descarte con una advertencia en lugar de tumbar el servidor, para que el resto del catálogo siga funcionando.

#### Acceptance Criteria

1. WHEN THE Agent_Registry valida un Manifiesto, THE Agent_Registry SHALL aceptarlo como válido solo si los campos `id`, `name`, `tagline`, `description`, `icon`, `inputMode`, `inputPlaceholder`, `actionLabel` y `outputRenderer` están presentes, son cadenas no vacías tras recortar los espacios y no superan 64 caracteres para `id`, `name`, `icon`, `inputMode` y `outputRenderer`, 160 caracteres para `tagline`, `inputPlaceholder` y `actionLabel`, y 1000 caracteres para `description`.
2. WHEN THE Agent_Registry valida un Manifiesto, THE Agent_Registry SHALL aceptar como `inputMode` únicamente los valores `ticker` y `text` y como `outputRenderer` únicamente los valores `financial_report` y `simple_report`, con comparación exacta sensible a mayúsculas y minúsculas.
3. WHEN THE Agent_Registry valida un Manifiesto, THE Agent_Registry SHALL aceptar como `icon` únicamente un Icono permitido, con comparación exacta sensible a mayúsculas y minúsculas.
4. WHEN THE Agent_Registry valida un Manifiesto, THE Agent_Registry SHALL aceptarlo como válido solo si el archivo `AGENTS.md`, el archivo de prompt declarado en `promptFile` y el archivo de esquema declarado en `schemaFile` existen en la carpeta del agente, son legibles, tienen un tamaño mayor que 0 bytes, y el archivo de esquema contiene JSON válido.
5. IF el contenido de `manifest.json` no es JSON válido, o un campo obligatorio está ausente, no es una cadena o incumple su longitud máxima, o un campo enumerado tiene un valor no permitido, o un archivo requerido está ausente, es ilegible, tiene un tamaño de 0 bytes, o el archivo de esquema no contiene JSON válido, THEN THE Agent_Registry SHALL omitir esa carpeta del catálogo, registrar exactamente una advertencia con la ruta relativa de la carpeta y el primer campo o archivo causante, y continuar con las carpetas restantes.
6. WHERE un Manifiesto omite campos opcionales, THE Agent_Registry SHALL aplicar los valores por defecto `order` = 100, `isDefault` = falso, `supportsInstruction` = falso, `promptFile` = `prompt.md`, `schemaFile` = `output.schema.json`, `accentColor` = blanco translúcido y `landing` = nulo.
7. IF un campo opcional de un Manifiesto tiene un tipo distinto del declarado para ese campo, THEN THE Agent_Registry SHALL usar el valor por defecto de ese campo indicado en el criterio 6, conservar la entrada en el catálogo y registrar una advertencia con la ruta relativa de la carpeta y el nombre del campo.
8. IF la validación de un Manifiesto lanza una excepción, THEN THE Agent_Registry SHALL capturar esa excepción, omitir esa carpeta del catálogo, registrar una advertencia con la ruta relativa de la carpeta, continuar con las carpetas restantes y devolver al Catalog_Endpoint un catálogo con las entradas válidas.
9. WHILE existe al menos una Carpeta de agente válida, THE Catalog_Endpoint SHALL responder con las entradas válidas aunque otras carpetas hayan sido descartadas.

### Requirement 3: Agente por defecto único

**User Story:** Como usuario, quiero que la aplicación siempre tenga un agente listo para ejecutar, para poder empezar sin configurar nada.

#### Acceptance Criteria

1. WHEN THE Agent_Registry construye el catálogo y exactamente una entrada válida declara `isDefault` verdadero, THE Agent_Registry SHALL designar esa entrada como Agente por defecto.
2. WHEN THE Agent_Registry construye el catálogo, el número de entradas válidas que declaran `isDefault` verdadero es distinto de uno y el agentId `financial_analyst_agent` está entre las entradas válidas, THE Agent_Registry SHALL designar esa entrada como Agente por defecto y registrar una advertencia con el número de entradas que declararon `isDefault` verdadero.
3. WHEN THE Agent_Registry construye el catálogo, el número de entradas válidas que declaran `isDefault` verdadero es distinto de uno y el agentId `financial_analyst_agent` no está entre las entradas válidas, THE Agent_Registry SHALL designar como Agente por defecto la primera entrada según el orden total del Requirement 1 (`order` ascendente, luego `name` sin distinguir mayúsculas y minúsculas, luego agentId ascendente) y registrar una advertencia con el agentId designado.
4. WHILE el catálogo vigente contiene al menos una entrada válida, THE Agent_Registry SHALL exponer exactamente un `defaultAgentId`.
5. WHILE el catálogo vigente no se reconstruye, THE Agent_Registry SHALL exponer el mismo valor de `defaultAgentId` en todas las peticiones.
6. WHEN THE Agent_Registry reconstruye el catálogo, THE Agent_Registry SHALL resolver de nuevo el Agente por defecto aplicando la regla de precedencia de los criterios 1 a 3 de este requisito.
7. WHEN THE Catalog_Endpoint responde el catálogo, THE Catalog_Endpoint SHALL reportar `isDefault` verdadero únicamente en la entrada cuyo agentId coincide con `defaultAgentId` y falso en las demás entradas, aunque varios Manifiestos declaren `isDefault` verdadero.
8. IF el catálogo vigente no contiene ninguna entrada válida, THEN THE Catalog_Endpoint SHALL responder el código de estado 200 con una lista de agentes vacía y un `defaultAgentId` nulo, y THE Agent_Registry SHALL registrar una advertencia indicando que no hay agentes válidos.

### Requirement 4: Endpoint de catálogo

**User Story:** Como usuario de la interfaz, quiero que la aplicación conozca los agentes disponibles, para poder elegir entre ellos.

#### Acceptance Criteria

1. WHEN THE Catalog_Endpoint recibe una petición y el catálogo vigente está en memoria, THE Catalog_Endpoint SHALL responder el código de estado 200 en 500 ms o menos, con la lista de agentes ordenada según el orden total del Requirement 1 y con el `defaultAgentId` resuelto por el Agent_Registry.
2. WHEN THE Catalog_Endpoint responde una entrada de agente, THE Catalog_Endpoint SHALL incluir los campos `id`, `name`, `tagline`, `description`, `icon`, `accentColor`, `order`, `isDefault`, `inputMode`, `inputPlaceholder`, `actionLabel`, `supportsInstruction`, `outputRenderer` y `landing`.
3. WHERE el Manifiesto de un agente omite campos opcionales, THE Catalog_Endpoint SHALL exponer para esos campos los valores por defecto declarados en el criterio 2.6.
4. WHEN THE Catalog_Endpoint responde una entrada de agente cuyo Manifiesto declara el campo `landing`, THE Catalog_Endpoint SHALL exponer en ese campo los subcampos `title`, `subtitle` y los grupos de `highlights`, y WHERE el Manifiesto omite el campo `landing`, THE Catalog_Endpoint SHALL exponer ese campo como nulo.
5. WHEN THE Catalog_Endpoint responde el catálogo, THE Catalog_Endpoint SHALL excluir de la respuesta las rutas absolutas y relativas del sistema de archivos, el contenido de `AGENTS.md`, del archivo de prompt y del archivo de esquema, y todo campo no enumerado en el criterio 2 de este requisito.
6. WHEN THE Catalog_Endpoint atiende una petición, THE Catalog_Endpoint SHALL construir la respuesta únicamente a partir del catálogo en memoria, sin leer los Archivos de ejecución, el archivo de prompt ni el archivo de esquema de ningún agente.
7. WHEN THE Agent_Registry reconstruye el catálogo con hasta 50 Carpetas de agente, THE Agent_Registry SHALL completar la reconstrucción en 3 s o menos.
8. IF la enumeración de la carpeta `agent/` produce un error del sistema de archivos, THEN THE Catalog_Endpoint SHALL responder el código de estado 500 con un mensaje de error que no incluye rutas del sistema de archivos, conservar en memoria el catálogo vigente anterior al error y registrar el detalle del error en consola.

### Requirement 5: Ejecución del agente seleccionado

**User Story:** Como usuario, quiero ejecutar el agente que he elegido, para obtener el tipo de informe que necesito.

#### Acceptance Criteria

1. WHEN THE Analyze_Endpoint recibe una petición cuyo `agentId` coincide de forma exacta con un agentId del catálogo, THE Analyze_Endpoint SHALL resolver esa entrada del catálogo antes de escribir las cabeceras SSE y ejecutar ese agente con sus Archivos de ejecución, su plantilla de prompt y su archivo de esquema.
2. IF el campo `agentId` está ausente, vacío tras recortar los espacios, o no coincide de forma exacta con ningún agentId del catálogo, THEN THE Analyze_Endpoint SHALL ejecutar el Agente por defecto, informar en el evento `agent_info` el agentId efectivamente ejecutado y registrar una advertencia con el valor recibido, sin rechazar la petición.
3. WHEN THE Analyze_Endpoint abre el flujo SSE de una ejecución, THE Analyze_Endpoint SHALL emitir exactamente un evento de tipo `agent_info` con los campos `agentId`, `agentName` y `outputRenderer` del agente resuelto, antes de reenviar cualquier evento `thinking`, `text`, `tool_call`, `tool_result`, `complete`, `error`, `done` o `final_stats` de esa ejecución.
4. THE Analyze_Endpoint SHALL conservar las cabeceras SSE actuales y los nombres de los tipos de evento `thinking`, `text`, `tool_call`, `tool_result`, `complete`, `error`, `done` y `final_stats` manteniendo los campos que cada uno emite hoy sin renombrarlos ni eliminarlos, y SHALL introducir `agent_info` como único tipo de evento nuevo.
5. WHERE el campo `model` de la petición, tras recortar los espacios, es exactamente `perseus` con comparación sensible a mayúsculas y minúsculas, THE Analyze_Endpoint SHALL usar el cliente `agentClientPerseus`.
6. IF el catálogo está vacío en el momento de recibir la petición, THEN THE Analyze_Endpoint SHALL rechazar la petición antes de escribir las cabeceras SSE con un error de configuración del servidor que indica que no hay agentes disponibles, sin invocar `agentClient` ni `agentClientPerseus` y sin escribir archivos de log.
7. THE Analyze_Endpoint SHALL pasar el campo `instruction` al Prompt_Builder únicamente cuando el agente resuelto declara `supportsInstruction` verdadero, y SHALL descartar ese campo en cualquier otro caso sin rechazar la petición.
8. IF el campo `model` está ausente, vacío tras recortar los espacios o tiene cualquier valor distinto de `perseus`, THEN THE Analyze_Endpoint SHALL usar el cliente `agentClient`.
9. WHERE el agente resuelto declara `supportsInstruction` verdadero, IF el valor de `instruction` supera 2.000 caracteres, THEN THE Analyze_Endpoint SHALL responder un error de validación que identifica el campo `instruction` y su límite, sin crear ninguna interacción remota.
10. IF el cliente remoto falla o interrumpe el flujo después de que se hayan escrito las cabeceras SSE, THEN THE Analyze_Endpoint SHALL emitir un evento `error` que indica el motivo del fallo, emitir a continuación un evento `done`, cerrar el flujo y conservar los eventos ya emitidos y los archivos de log escritos hasta ese momento.

### Requirement 6: Aislamiento del contexto del agente

**User Story:** Como desarrollador, quiero que el entorno remoto reciba solo los archivos del agente en ejecución, para que los agentes no se contaminen entre sí ni vean metadata del servidor.

#### Acceptance Criteria

1. WHEN THE Analyze_Endpoint resuelve un agente, THE Agent_Registry SHALL producir las fuentes inline recorriendo recursivamente únicamente la carpeta de ese agente hasta una profundidad máxima de 5 niveles de subcarpetas y un máximo de 200 archivos, con destino `/.agents`, preservando para cada archivo su ruta relativa a la carpeta del agente, y descartando con una advertencia que indica la ruta y el límite excedido los archivos que queden fuera de esos límites.
2. THE Agent_Registry SHALL excluir de las fuentes inline los Archivos de metadata de la carpeta del agente resuelto: `manifest.json`, el archivo de prompt declarado en `promptFile` y el archivo de esquema declarado en `schemaFile`, comparando el nombre exacto declarado en el Manifiesto.
3. THE Agent_Registry SHALL excluir de las fuentes inline todo archivo cuya ruta resuelta no quede contenida en la carpeta del agente resuelto, incluidos los archivos sueltos de la raíz de `agent/`, los archivos de otras Carpetas de agente y los enlaces simbólicos que resuelvan fuera de esa carpeta.
4. THE Agent_Registry SHALL cargar el contenido de los Archivos de ejecución únicamente durante la resolución de una ejecución, de modo que una petición al Catalog_Endpoint no lee el contenido de ningún Archivo de ejecución.
5. IF la lectura del contenido de un archivo de la carpeta del agente resuelto produce un error del sistema de archivos, THEN THE Agent_Registry SHALL omitir ese archivo de las fuentes inline, registrar una advertencia con su ruta relativa y el motivo, y conservar las fuentes inline restantes.
6. IF el tamaño de un archivo de la carpeta del agente resuelto supera 1 MB, THEN THE Agent_Registry SHALL omitir ese archivo de las fuentes inline y registrar una advertencia con su ruta relativa y su tamaño.
7. IF el conjunto de fuentes inline del agente resuelto queda vacío tras aplicar las exclusiones y los límites, THEN THE Agent_Registry SHALL fallar con un error explícito que nombra el agentId y THE Analyze_Endpoint SHALL responder ese error sin crear ninguna interacción remota.

### Requirement 7: Ensamblado del prompt por agente

**User Story:** Como desarrollador, quiero que el prompt de cada agente venga de su propia plantilla y esquema en disco, para poder cambiar su comportamiento sin tocar el servidor.

#### Acceptance Criteria

1. WHEN THE Prompt_Builder construye un prompt, THE Prompt_Builder SHALL sustituir todas las apariciones de los marcadores `{{input}}` e `{{instruction}}` de la plantilla del agente, usando como valor de `{{input}}` el valor de entrada efectivo ya validado y recortado de la petición.
2. WHEN THE Prompt_Builder construye un prompt, THE Prompt_Builder SHALL sustituir todas las apariciones del marcador `{{schema}}` por el contenido literal del archivo de esquema declarado en `schemaFile` por el Manifiesto.
3. WHEN THE Prompt_Builder construye un prompt, THE Prompt_Builder SHALL insertar exactamente una vez el bloque común de reglas de salida JSON, que exige envolver el resultado en un bloque ```json y prohíbe renombrar las claves del esquema, situándolo al final del prompt final después de todo el texto proveniente de la plantilla.
4. IF la plantilla del agente contiene un marcador con la forma `{{...}}` distinto de `{{input}}`, `{{instruction}}` y `{{schema}}`, THEN THE Prompt_Builder SHALL fallar con un error explícito que nombra ese marcador y THE Analyze_Endpoint SHALL responder ese error sin crear ninguna interacción remota.
5. WHEN THE Prompt_Builder busca marcadores sin resolver, THE Prompt_Builder SHALL examinar únicamente el texto de la plantilla original y SHALL excluir de esa búsqueda el texto insertado por las sustituciones, de modo que un valor de entrada, una instrucción o un contenido de esquema que incluyan la forma `{{...}}` no provocan un fallo.
6. WHERE el agente resuelto declara `supportsInstruction` falso, THE Prompt_Builder SHALL sustituir todas las apariciones del marcador `{{instruction}}` por una cadena vacía.
7. IF el campo `instruction` está ausente o queda vacío tras recortar los espacios, THEN THE Prompt_Builder SHALL sustituir todas las apariciones del marcador `{{instruction}}` por una cadena vacía.
8. WHEN THE Prompt_Builder construye el prompt del agente `financial_analyst_agent` para un valor de entrada dado, THE Prompt_Builder SHALL producir un texto que coincide carácter a carácter con el prompt embebido hoy en `server.ts` para ese mismo valor de entrada, admitiendo únicamente diferencias en los espacios al final de cada línea y al final del texto completo.
9. IF la lectura o el análisis del archivo de plantilla o del archivo de esquema falla, o el tamaño de alguno de esos dos archivos supera 256 KiB, THEN THE Prompt_Builder SHALL fallar con un error explícito que nombra el archivo afectado y THE Analyze_Endpoint SHALL responder ese error sin crear ninguna interacción remota.
10. WHILE THE Prompt_Builder ensambla un prompt, THE Prompt_Builder SHALL completar el ensamblado en 500 ms o menos.

### Requirement 8: Validación de la entrada según el tipo de agente

**User Story:** Como usuario, quiero que la aplicación me avise de una entrada inválida antes de gastar una ejecución, para no esperar a un fallo remoto.

#### Acceptance Criteria

1. WHERE el agente resuelto declara `inputMode` igual a `ticker`, IF el valor de entrada efectivo, tras recortar los espacios inicial y final y convertirlo a mayúsculas, no es una cadena de 1 a 10 caracteres pertenecientes al conjunto `A`-`Z` y `0`-`9`, THEN THE Analyze_Endpoint SHALL responder el código de estado 400 con un error de validación que identifica el campo de entrada y SHALL no crear ninguna interacción remota.
2. WHERE el agente resuelto declara `inputMode` igual a `text`, IF el valor de entrada efectivo, tras recortar los espacios inicial y final, tiene una longitud menor que 1 carácter o mayor que 2000 caracteres, THEN THE Analyze_Endpoint SHALL responder el código de estado 400 con un error de validación que identifica el campo de entrada y el límite incumplido y SHALL no crear ninguna interacción remota.
3. IF el valor de entrada efectivo está ausente, es nulo o no es una cadena, THEN THE Analyze_Endpoint SHALL responder el código de estado 400 con un error de validación que identifica el campo de entrada y SHALL no crear ninguna interacción remota.
4. THE Analyze_Endpoint SHALL validar el valor de entrada antes de cargar las fuentes inline, antes de ensamblar el prompt y antes de abrir el flujo SSE.
5. WHEN THE Analyze_Endpoint rechaza una petición por validación de entrada, THE Analyze_Endpoint SHALL responder una única respuesta de error no SSE y SHALL no escribir archivos de log de ejecución para esa petición.
6. WHERE el agente resuelto declara `supportsInstruction` verdadero, IF el campo `instruction` está presente y no es una cadena o su longitud tras recortar los espacios supera 2000 caracteres, THEN THE Analyze_Endpoint SHALL responder el código de estado 400 con un error de validación que identifica el campo `instruction` y SHALL no crear ninguna interacción remota.
7. WHILE el valor de entrada del Web_Client, tras recortar los espacios inicial y final, no cumple las mismas reglas de longitud y conjunto de caracteres definidas en los criterios 1 y 2 para el `inputMode` del Agente activo, THE Web_Client SHALL mantener el botón de ejecución deshabilitado.
8. WHEN el valor de entrada del Web_Client pasa a cumplir las reglas del `inputMode` del Agente activo, THE Web_Client SHALL habilitar el botón de ejecución.

### Requirement 9: Compatibilidad hacia atrás

**User Story:** Como mantenedor, quiero que los clientes y los enlaces existentes sigan funcionando tras la migración, para no romper flujos en uso.

#### Acceptance Criteria

1. WHERE el agente `financial_analyst_agent` está en el catálogo, WHEN THE Analyze_Endpoint recibe una petición que incluye el campo `ticker` y no incluye el campo `agentId`, THE Analyze_Endpoint SHALL ejecutar ese agente con los Archivos de ejecución `agent.yaml`, `AGENTS.md` y `requirements.txt` trasladados a la carpeta `agent/financial_analyst_agent/`, con la plantilla `prompt.md` y con el esquema `output.schema.json` de esa misma carpeta.
2. WHEN THE Analyze_Endpoint recibe una petición cuyo campo `input` contiene al menos 1 carácter tras recortar los espacios inicial y final, THE Analyze_Endpoint SHALL usar el valor de `input` como valor de entrada efectivo.
3. IF el campo `input` está ausente, es nulo o queda vacío tras recortar los espacios inicial y final, y el campo `ticker` contiene al menos 1 carácter tras recortar los espacios, THEN THE Analyze_Endpoint SHALL usar el valor de `ticker` como valor de entrada efectivo.
4. IF el valor de entrada efectivo supera 10.000 caracteres, THEN THE Analyze_Endpoint SHALL responder el código de estado 400 con un error de validación que identifica el campo de entrada y su límite, sin crear ninguna interacción remota.
5. IF ni el campo `input` ni el campo `ticker` contienen al menos 1 carácter tras recortar los espacios inicial y final, THEN THE Analyze_Endpoint SHALL responder el código de estado 400 con un error de validación que enumera los campos de entrada aceptados, sin crear ninguna interacción remota.
6. WHEN THE Download_Endpoint recibe el parámetro `ticker`, THE Download_Endpoint SHALL considerar los archivos de `run_logs/` cuyo nombre sigue el patrón `run_log_<agentId>_<input>_<runId>` y los archivos cuyo nombre sigue el patrón heredado `run_log_<input>_<runId>` sin agentId, comparando el valor de entrada sin distinguir mayúsculas y minúsculas, y SHALL devolver el archivo con el `runId` más alto entre los que coinciden.
7. IF el parámetro `ticker` del Download_Endpoint está ausente, queda vacío tras recortar los espacios o contiene caracteres fuera del conjunto `A`-`Z`, `a`-`z` y `0`-`9`, THEN THE Download_Endpoint SHALL responder el código de estado 400 con un error de validación que identifica el parámetro `ticker`, sin enumerar la carpeta `run_logs/`.
8. WHEN THE Web_Client solicita un archivo de log escrito antes de la migración, THE Web_Client SHALL obtenerlo bajo la ruta estática `/run_logs` con el mismo nombre de archivo con el que se escribió, sin que ese archivo se renombre.
9. IF una subcarpeta directa de `agent/` no contiene un Manifiesto, THEN THE Agent_Registry SHALL omitirla del catálogo, registrar una advertencia con su nombre, continuar la enumeración de las subcarpetas restantes y devolver al Catalog_Endpoint un catálogo con las entradas válidas.

### Requirement 10: Trazabilidad de ejecuciones por agente

**User Story:** Como operador, quiero distinguir en los logs qué agente produjo cada ejecución, para depurar sin que se solapen ejecuciones del mismo ticker.

#### Acceptance Criteria

1. WHEN una ejecución escribe sus archivos de log, THE Analyze_Endpoint SHALL nombrarlos `run_log_<agentId>_<input>_<runId>.jsonl` y `run_log_<agentId>_<input>_<runId>.txt`.
2. THE Analyze_Endpoint SHALL incluir en el evento `final_stats` una URL `jsonlLogUrl` que apunta al archivo `.jsonl` de esa ejecución.
3. WHEN THE Download_Endpoint recibe el parámetro `agent`, THE Download_Endpoint SHALL devolver el archivo `.jsonl` más reciente cuyo nombre corresponde a esa entrada y a ese agentId.
4. WHERE el parámetro `agent` está ausente, THE Download_Endpoint SHALL devolver el archivo `.jsonl` más reciente correspondiente a esa entrada para cualquier agentId.
5. IF no existe ningún archivo `.jsonl` para los parámetros recibidos, THEN THE Download_Endpoint SHALL responder el código de estado 404 con un mensaje de error.

### Requirement 11: Selector de agentes en la interfaz

**User Story:** Como usuario, quiero elegir el agente desde un menú claro en la cabecera, para cambiar de tarea sin salir de la aplicación.

#### Acceptance Criteria

1. THE Agent_Selector SHALL mostrar en la cabecera un botón con el icono del Agente activo, su `name` y un indicador de despliegue.
2. WHEN el usuario activa el botón del Agent_Selector, THE Agent_Selector SHALL abrir un panel con una tarjeta por agente del catálogo que muestra icono, `name`, `tagline`, la etiqueta de su `inputMode` y una marca de "Predeterminado" cuando el agente es el Agente por defecto.
3. THE Agent_Selector SHALL señalar el Agente activo dentro del panel con el color de acento del agente y un icono de comprobación.
4. WHILE una ejecución está en curso, THE Agent_Selector SHALL impedir el cambio de agente y mostrar un texto que explica el motivo.
5. WHEN el usuario pulsa `Escape`, hace clic fuera del panel o selecciona un agente, THE Agent_Selector SHALL cerrar el panel.
6. WHILE el panel está abierto, THE Agent_Selector SHALL permitir mover el foco entre tarjetas con las flechas, ir al primero y al último con `Home` y `End`, y confirmar la selección con `Enter` o `Espacio`.
7. WHILE la petición del catálogo está en curso, THE Agent_Selector SHALL mostrar un estado de carga.
8. IF la petición del catálogo falla, THEN THE Agent_Selector SHALL mostrar un estado de error con una acción de reintento y THE Web_Client SHALL continuar con el último Agente activo conocido.
9. WHERE el catálogo está vacío, THE Agent_Selector SHALL mostrar un estado vacío explicativo y THE Web_Client SHALL mantener el botón de ejecución deshabilitado.
10. THE Agent_Selector SHALL reutilizar los tokens visuales existentes del proyecto: panel `bg-black/20 backdrop-blur-md border border-white/10 rounded-xl`, botón sobre la paleta `stone`, animaciones con `motion` y tipografías `font-sans` y `font-display`.

### Requirement 12: Estado, persistencia y aislamiento de la selección

**User Story:** Como usuario recurrente, quiero que la aplicación recuerde mi agente y no mezcle resultados de agentes distintos, para retomar el trabajo donde lo dejé.

#### Acceptance Criteria

1. WHEN THE Web_Client se monta, THE Web_Client SHALL solicitar el catálogo y fijar como Agente activo el agentId almacenado en `localStorage` bajo la clave `tickr.selectedAgentId` cuando ese agentId está en el catálogo.
2. IF el agentId almacenado no está en el catálogo, THEN THE Web_Client SHALL fijar como Agente activo el `defaultAgentId` del catálogo y sobrescribir el valor almacenado.
3. WHEN el usuario selecciona un agente, THE Web_Client SHALL almacenar ese agentId en `localStorage` bajo la clave `tickr.selectedAgentId`.
4. WHEN el Agente activo cambia, THE Web_Client SHALL vaciar el informe, los eventos de la línea de tiempo, las métricas de ejecución y el mensaje de error previos.
5. WHEN THE Web_Client recibe un evento `agent_info` cuyo `agentId` difiere del agentId enviado, THE Web_Client SHALL fijar el agentId informado como Agente activo y almacenarlo.
6. THE Web_Client SHALL enviar el agentId del Agente activo en el cuerpo de la petición al Analyze_Endpoint.
7. THE Web_Client SHALL mostrar en la cabecera del panel de ejecución el `name` del Agente activo y el nombre del modelo como texto secundario.

### Requirement 13: Vista de aterrizaje y barra de entrada adaptativas

**User Story:** Como usuario, quiero que la pantalla inicial y el campo de entrada describan el agente elegido, para saber qué se espera que escriba.

#### Acceptance Criteria

1. WHEN el Agente activo cambia, THE Web_Client SHALL mostrar en la vista de aterrizaje el `title`, el `subtitle` y los grupos de `highlights` declarados en el campo `landing` del Manifiesto.
2. WHERE el Manifiesto omite el campo `landing`, THE Web_Client SHALL mostrar en la vista de aterrizaje el `name`, el `tagline` y la `description` del agente.
3. WHERE el Agente activo declara `inputMode` igual a `ticker`, THE Web_Client SHALL mostrar un campo de entrada corto en mayúsculas con tipografía monoespaciada y un icono de búsqueda.
4. WHERE el Agente activo declara `inputMode` igual a `text`, THE Web_Client SHALL mostrar un campo de entrada de texto ancho.
5. THE Web_Client SHALL mostrar como texto de ayuda del campo de entrada el `inputPlaceholder` del Agente activo.
6. WHERE el Agente activo declara `supportsInstruction` verdadero, THE Web_Client SHALL mostrar un campo de instrucción adicional habilitado, y WHERE lo declara falso SHALL ocultar ese campo.
7. THE Web_Client SHALL usar como etiqueta del botón de ejecución el `actionLabel` del Agente activo.
8. THE Web_Client SHALL mantener visible el aviso legal bajo la barra de entrada.

### Requirement 14: Renderizado del resultado según el agente que lo produjo

**User Story:** Como usuario, quiero ver cada resultado con la presentación propia de su agente, para leer informes financieros y resúmenes simples con el formato adecuado.

#### Acceptance Criteria

1. WHEN una ejecución produce un informe, THE Web_Client SHALL presentarlo con el `outputRenderer` recibido en el evento `agent_info` de esa ejecución, incluso si el Agente activo cambió después de iniciarse la ejecución.
2. WHERE el `outputRenderer` de la ejecución es `financial_report`, THE Web_Client SHALL presentar el resultado con el componente `ReportTemplate` sin modificar su contrato de propiedades.
3. WHERE el `outputRenderer` de la ejecución es `simple_report`, THE Web_Client SHALL presentar el resultado con el componente `SimpleReportView`, mostrando `summary`, `key_points`, `sections` y `sources` mediante `FormattedMarkdown`.
4. WHEN THE Result_Extractor procesa el texto final de una ejecución, THE Result_Extractor SHALL seleccionar el último bloque ```json cuyo contenido es JSON válido y, si no existe ninguno, SHALL intentar la búsqueda por llaves exteriores.
5. THE Result_Extractor SHALL considerar válido un objeto cuyas claves raíz corresponden al `outputRenderer` de la ejecución: `verdict`, `findings` o `deep_insights` para `financial_report`, y `summary`, `key_points`, `sections` o `sources` para `simple_report`.
6. IF el texto final no contiene ningún objeto válido para el `outputRenderer` de la ejecución, THEN THE Web_Client SHALL conservar el texto crudo en la línea de tiempo y mostrar un aviso de que el informe no pudo estructurarse.
7. THE Web_Client SHALL presentar el contenido devuelto por los agentes como Markdown, sin ejecutar HTML arbitrario procedente del modelo.

### Requirement 15: Catálogo inicial de agentes

**User Story:** Como usuario, quiero disponer del analista financiero actual y de dos agentes de ejemplo, para comprobar el catálogo con casos reales.

#### Acceptance Criteria

1. THE Agent_Registry SHALL descubrir el agente `financial_analyst_agent`, cuya carpeta contiene `agent.yaml`, `AGENTS.md` y `requirements.txt` trasladados desde `agent/`, más `manifest.json`, `prompt.md` y `output.schema.json`, con `isDefault` verdadero, `inputMode` igual a `ticker` y `outputRenderer` igual a `financial_report`.
2. THE Agent_Registry SHALL descubrir el agente `market_news_agent` con `inputMode` igual a `ticker`, `outputRenderer` igual a `simple_report` y `google_search` como única herramienta declarada en su `agent.yaml`.
3. THE Agent_Registry SHALL descubrir el agente `company_profile_agent` con `inputMode` igual a `text`, `outputRenderer` igual a `simple_report` y `google_search` como única herramienta declarada en su `agent.yaml`.
4. THE raíz de `agent/` SHALL contener únicamente Carpetas de agente tras la migración, sin Archivos de ejecución sueltos.
5. THE `output.schema.json` de todo agente con `outputRenderer` igual a `simple_report` SHALL declarar los campos `summary`, `key_points`, `sections` con `title` y `body`, y `sources` con `title`, `url` y `date`.
6. THE `agent.yaml` de `market_news_agent` y de `company_profile_agent` SHALL declarar `base_agent` igual a `antigravity-preview-05-2026` y un entorno remoto sin fuentes preconfiguradas.

### Requirement 16: Seguridad del catálogo y modelo de acceso

**User Story:** Como responsable de la aplicación, quiero que el identificador de agente no permita acceder a rutas arbitrarias y que el catálogo no filtre información interna, para reducir la superficie de ataque.

#### Acceptance Criteria

1. THE Agent_Registry SHALL resolver un agentId únicamente por coincidencia exacta con los identificadores descubiertos y SHALL construir las rutas de archivo a partir de la entrada de catálogo correspondiente.
2. IF un `agentId` recibido contiene separadores de ruta, secuencias de recorrido de directorios o caracteres fuera de snake_case, THEN THE Analyze_Endpoint SHALL tratarlo como desconocido, ejecutar el Agente por defecto y registrar una advertencia.
3. THE Catalog_Endpoint SHALL responder únicamente los campos enumerados en el Requirement 4, sin rutas absolutas ni relativas del sistema de archivos.
4. THE Agent_Registry SHALL rechazar todo Manifiesto cuyo `icon` no esté en la lista de Iconos permitidos, evitando que un nombre arbitrario llegue a la interfaz.
5. THE Catalog_Endpoint y THE Analyze_Endpoint SHALL aplicar el mismo modelo de acceso que los endpoints `/api/*` existentes, que no exigen token de autenticación.

**Nota de seguridad:** el criterio 16.5 documenta de forma explícita la decisión tomada en esta fase: no se introduce autenticación en esta especificación, para no ampliar el alcance de una migración que debe ser equivalente en comportamiento. Esto implica que `GET /api/agents` y `POST /api/analyze` quedan accesibles sin token, igual que hoy, y que cualquiera con acceso de red al servidor puede listar agentes y lanzar ejecuciones (con el coste de modelo asociado). Exponer la aplicación públicamente requiere abrir una especificación aparte que añada autorización a `/api/*`.

### Requirement 17: Extensibilidad y documentación

**User Story:** Como desarrollador nuevo en el proyecto, quiero un procedimiento documentado para añadir un agente, para incorporarlo sin leer todo el servidor.

#### Acceptance Criteria

1. WHEN se añade a `agent/` una carpeta con un Manifiesto válido y sus archivos requeridos, THE Agent_Registry SHALL incluirla en el catálogo sin que se modifique ningún archivo TypeScript.
2. THE documentación del proyecto (`README.md` y `overview.md`) SHALL describir la estructura de una Carpeta de agente, los campos del Manifiesto y los pasos para añadir un agente nuevo.
3. THE documentación del proyecto SHALL enumerar los Archivos de metadata que no se suben al entorno remoto.
