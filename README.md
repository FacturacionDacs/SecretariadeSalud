# RIPS 0948 - Analizador JSON

Primera versión funcional en HTML5 + CSS moderno + JavaScript puro.

## Funciones incluidas
- Carga múltiple de archivos `.json`.
- Carga de carpeta con `webkitdirectory`.
- Arrastrar y soltar.
- Procesamiento local: los JSON no se envían a un servidor.
- Dashboard:
  - archivos,
  - usuarios,
  - usuarios únicos,
  - servicios,
  - tipos de servicio,
  - repetidos,
  - errores y alertas.
- Lectura de grupos:
  - consultas,
  - procedimientos,
  - urgencias,
  - hospitalización,
  - recién nacidos,
  - medicamentos,
  - otros servicios.
- Consolidación por código, nombre/descripción, cantidad, usuarios, archivos y valor.
- Validación:
  - JSON sintácticamente válido,
  - estructura raíz,
  - `numDocumentoIdObligado`,
  - factura/nota,
  - arreglo `usuarios`,
  - campos básicos de usuario,
  - objeto `servicios`,
  - tipos de arreglo por servicio,
  - código principal en consultas/procedimientos,
  - consecutivos de usuario repetidos.
- Detecta RIPS con múltiples usuarios.
- Detecta usuarios repetidos entre archivos.
- Interfaz para escoger cuál repetición conservar.
- Genera un único `RIPS_USUARIOS_REPETIDOS.json` con todos los grupos repetidos, conservando archivo/factura de origen y la selección de cuál conservar.
- Exporta resumen de servicios a CSV.
- Un solo botón limpia:
  - estado de aplicación,
  - Local Storage,
  - Session Storage,
  - Cache Storage,
  - IndexedDB disponible.
- Vista del JSON y descarga.

## Uso
No requiere instalación.

1. Descomprimir la carpeta.
2. Abrir `index.html` en Chrome o Edge.
3. Cargar archivos o seleccionar una carpeta.

Para producción se recomienda servir la carpeta con HTTPS o un servidor web local.

## Nota regulatoria
Esta versión incorpora una validación estructural inicial del RIPS JSON. La Resolución 0948 de 2026 define reglas extensas y catálogos que deben implementarse en una segunda capa de reglas de negocio. El proyecto quedó organizado para ampliar `validateRips()` y cargar catálogos oficiales sin rehacer el dashboard.

## Próximas mejoras sugeridas
1. Implementar el Documento Técnico 1 completo de la Resolución 0948.
2. Cargar catálogos oficiales CUPS, medicamentos y tablas de referencia.
3. Validaciones de fechas, dominios, sexo, municipio, país, tipo usuario y finalidad.
4. Reglas cruzadas factura ↔ usuario ↔ servicio.
5. ZIP de salida con todos los JSON normalizados.
6. Comparador antes/después.
7. Búsqueda de duplicados por documento + factura + servicio.
8. Persistencia opcional en IndexedDB para cargas grandes.


## Catálogo CUPS
Se incorporó la tabla de referencia suministrada por el usuario (`Codigo`, `Nombre`) con 10024 códigos. Consultas y procedimientos resuelven automáticamente el nombre por código. Si un código no existe en el catálogo, se indica `Código no encontrado en tabla de referencia`.

## V9 - Centro de corrección automática
- La pantalla Validación ahora separa hallazgos autocorregibles y de revisión manual.
- Botón `Corregir` por hallazgo.
- Botón `Corregir todo lo corregible` para toda la carga; realiza varias pasadas y revalida después de los cambios.
- Correcciones seguras incluidas actualmente:
  - convertir `usuarios` de objeto a arreglo cuando corresponde;
  - convertir un grupo de servicios enviado como objeto a arreglo;
  - asignar consecutivo faltante de usuario;
  - renumerar consecutivos de usuario repetidos;
  - asignar consecutivo vacío de un registro de servicio.
- No se inventan datos clínicos, facturas, diagnósticos ni códigos faltantes.
- Los archivos modificados pueden descargarse juntos en `RIPS_CORREGIDOS_LOTE.zip`.

## V10 - Ajustes solicitados
1. **Repetidos = usuarios, no consultas.** Un usuario (mismo `tipoDocumentoIdentificacion` + `numDocumentoIdentificacion`) no puede repetirse dentro de un mismo RIPS JSON. La detección de "repetido" siempre se basa en el usuario, nunca en cuántas consultas o servicios tenga (ver V12 para cómo se resuelve esto en la interfaz).
2. Se agregó la sección de Validación que reporta cada usuario repetido dentro del mismo archivo (`USUARIO_REPETIDO`), con la línea del archivo donde aparece cada copia.
3. Nueva validación `CONSECUTIVO_SERVICIO_REPETIDO`: cada registro dentro de un mismo grupo de servicios (consultas, procedimientos, urgencias, hospitalización, recién nacidos, medicamentos, otros servicios) de un usuario debe tener su propio consecutivo, igual que ocurre con los usuarios. Incluye corrección automática (`Corregir` / `Corregir todo lo corregible`) que renumera el grupo afectado.
4. Los archivos con estructura de **Archivo Respuesta del Ministerio (CUV)** — los que traen `ResultadosValidacion` junto con `CodigoUnicoValidacion`, `ProcesoId` o `ResultState` — se detectan automáticamente y no se cuentan como RIPS. Aparecen listados aparte en Archivos → "Archivos omitidos", y se informa cuántos se omitieron en el aviso al cargar.

## V11 - Barra de progreso al cargar
- Al cargar archivos (botón, carpeta o arrastrar y soltar) aparece una barra de progreso debajo de la zona de carga.
- Muestra: cuántos archivos van procesados de cuántos en total, el porcentaje, y el nombre del archivo que se está leyendo en ese momento.
- Se oculta automáticamente al terminar de procesar todos los archivos.

## V12 - Repetidos dentro del mismo archivo (por usuario, no por servicios)
- La pantalla **Repetidos** ahora tiene dos secciones:
  1. **Usuarios repetidos dentro del mismo archivo**: cuando un mismo usuario (mismo tipo + número de documento) aparece más de una vez en el mismo RIPS JSON (ej. `456465.json` con dos usuarios iguales). Eliges cuál aparición conservar y con el botón **"Quitar duplicado(s) de este archivo"** se elimina realmente la(s) otra(s) del `usuarios[]` de ese archivo. También hay un botón para hacerlo de una vez en todos los archivos, conservando siempre la aparición con más servicios.
  2. **Usuarios repetidos entre archivos distintos**: el mismo usuario aparece en más de un archivo (por ejemplo dos facturas distintas). Esta sección sigue siendo solo informativa/de auditoría — no modifica ningún archivo — y permite descargar el JSON consolidado como antes.
- La comparación para detectar "repetido" es siempre por **usuario** (tipo + número de documento), nunca por cantidad de consultas o servicios; los servicios solo se usan como criterio para sugerir cuál aparición conservar por defecto (la que tiene más servicios).
- Los archivos con usuarios eliminados quedan marcados como corregidos y se pueden descargar juntos en `RIPS_CORREGIDOS_LOTE.zip`.

## V13 - Detección más robusta de Respuesta del Ministerio (CUV)
- La detección de archivos Respuesta del Ministerio (CUV) ya no depende de un solo campo. Ahora reconoce el archivo si coincide con al menos dos campos típicos de esa respuesta (`CodigoUnicoValidacion`, `ProcesoId`, `ResultState`, `ResultadosValidacion`, `RutaArchivos`, `ModalidadPago`, `FechaRadicacion`, `Modulo`), sin importar si trae o no `ResultadosValidacion`.
- Si el archivo trae un `usuarios[]` real, nunca se clasifica como CUV, sin importar qué otros campos tenga.
- Como respaldo adicional, si por alguna variante el archivo igual llega a la validación (por traer solo un campo característico), ya no se muestra el mensaje genérico `USUARIOS_INVALIDO`; en su lugar se reporta claramente `ARCHIVO_RESPUESTA_CUV: Este archivo es una Respuesta del Ministerio (CUV), no un RIPS`.

## V14 - CUV ya no se muestra como error
- Antes, si un archivo Respuesta del Ministerio (CUV) se colaba a la validación de RIPS por traer solo un campo característico, se reportaba como un hallazgo `ERROR`. Ya no.
- La detección de CUV ahora ocurre siempre antes de intentar validar el archivo como RIPS, así que un archivo CUV nunca entra a Validación, nunca cuenta como archivo con errores y nunca aparece con la etiqueta ERROR.
- `CodigoUnicoValidacion` se trata como campo suficiente por sí solo para identificar un archivo CUV (es un campo muy propio de esa respuesta), y si no está, basta con 2 de los demás campos típicos (`ProcesoId`, `ResultState`, `ResultadosValidacion`, `RutaArchivos`, `ModalidadPago`, `FechaRadicacion`, `Modulo`).
- En Archivos → "Archivos omitidos" cada archivo detectado como CUV ahora muestra una etiqueta neutra **CUV** (no roja/error) junto al motivo.

## V15 - Validación de formato de fechas
- Se revisa cualquier campo cuyo nombre empiece por `fecha` (`fechaNacimiento`, `fechaInicioAtencion`, `fechaEgreso`, `fechaDispensAdmon`, `fechaSuministroTecnologia`, etc.), tanto a nivel de usuario como dentro de **todos** los grupos de servicios (consultas, procedimientos, urgencias, hospitalización, recién nacidos, medicamentos, otros servicios).
- Formato esperado: `AAAA-MM-DD` o `AAAA-MM-DD HH:MM`. Se valida mes (01-12), día según el mes y año (incluye años bisiestos), hora (00-23) y minuto (00-59).
- **`FECHA_INVALIDA` (ERROR)**: la fecha no se puede interpretar de forma segura (ej. `2026-0-22`, mes 13, día 30 de febrero). El sistema muestra el mensaje del error exacto (qué parte está mal) y la ruta donde está (archivo, usuario, grupo de servicio y campo). Como no se puede adivinar con certeza cuál era el valor correcto, el botón **"Corregir"** abre un cuadro para que escribas tú la fecha correcta; se valida el nuevo valor antes de aplicarlo.
- **`FECHA_SIN_CEROS` (ALERTA)**: la fecha es válida pero le faltan ceros a la izquierda (ej. `2026-3-22`). Esta sí se corrige sola, tanto con el botón individual como con **"Corregir todo lo corregible"**.

## V16 - Catálogo CIE-10 para Urgencias, Hospitalización y Recién nacidos
- Se integró la tabla de referencia CIE-10 que subiste (12.634 códigos, `cie10_catalog.js`).
- El código principal de **Urgencias**, **Hospitalización** y **Recién nacidos** es `codDiagnosticoPrincipal` (un diagnóstico CIE-10, a diferencia de Consultas/Procedimientos que usan CUPS). Ahora, en la tabla de Servicios y en Top de códigos, esos registros muestran el nombre real del diagnóstico en vez de "Código no encontrado en tabla de referencia".
- Si un código no aparece en la tabla CIE-10 cargada, se sigue mostrando el aviso de "Código no encontrado en tabla de referencia" para que puedas revisarlo.

## V17 - Estructura exacta capturada de los RIPS de referencia
- Se capturó la estructura completa (nombre exacto de cada campo) de los 6 archivos "buenos" que subiste al inicio: raíz del RIPS, objeto usuario, y cada uno de los 7 grupos de servicios (consultas, procedimientos, urgencias, hospitalización, recién nacidos, medicamentos, otros servicios). Queda guardada en `rips_schema.js`.
- A partir de ahora, cualquier RIPS que cargues se compara campo por campo contra esa estructura de referencia. Si falta una letra, sobra un campo, falta un campo, o el nombre del grupo de servicios está mal escrito, se marca como **ERROR** y se muestra exactamente dónde está (archivo → usuario → grupo de servicio → campo):
  - **`ESTRUCTURA_CAMPO_MAL_ESCRITO`**: el campo no existe, pero es muy parecido a uno esperado que falta (ej. `codPrestaor` en vez de `codPrestador`). Botón "Corregir" lo renombra solo, conservando el valor. Incluido en "Corregir todo lo corregible".
  - **`ESTRUCTURA_CAMPO_FALTANTE`**: falta un campo de la estructura de referencia. Botón "Corregir" lo agrega con valor `null` para dejar la estructura completa (no inventa el dato real). Incluido en "Corregir todo lo corregible".
  - **`ESTRUCTURA_CAMPO_DESCONOCIDO`**: hay un campo que no pertenece a la estructura de referencia y no se parece a ninguno esperado. Botón "Corregir" lo elimina — como esto podría borrar información, **no** se incluye en la corrección masiva, solo se aplica al confirmar campo por campo.
  - **`ESTRUCTURA_GRUPO_MAL_ESCRITO` / `ESTRUCTURA_GRUPO_DESCONOCIDO`**: mismo control pero sobre el nombre del grupo de servicios (`consultas`, `procedimientos`, etc.) en vez de un campo individual.
- Si tus RIPS reales legítimamente traen campos adicionales que no estaban en los 6 archivos de ejemplo, avísame para ampliar `rips_schema.js` y evitar falsos positivos.

## V18 - Repetidos dentro del mismo archivo: fusión inteligente de servicios
- Antes, al quitar un usuario duplicado dentro del mismo archivo, se perdían TODOS los servicios de la copia descartada.
- Ahora, antes de quitar la copia descartada, se revisan sus servicios (consultas, procedimientos, urgencias, hospitalización, medicamentos, otros servicios, recién nacidos) y:
  - Si un servicio de la copia descartada tiene el **mismo código Y la misma fecha/hora exacta** que uno que ya existe en la copia que se conserva → es el duplicado real, se descarta.
  - Si el código es distinto, o la fecha/hora es distinta (aunque sea el mismo código de consulta a otra hora), → es un servicio genuino distinto, se **fusiona** dentro del usuario que se conserva antes de borrar la copia.
- Aplica igual con el botón individual "Quitar duplicado(s) de este archivo" y con "Quitar todos (conservando el de más servicios)".
- El aviso al aplicar la corrección indica cuántos servicios distintos se conservaron fusionados.

## V19 - "Repetido" es únicamente dentro del mismo archivo
- Se quitó por completo el concepto de "usuarios repetidos entre archivos distintos". Un mismo usuario atendido en varios RIPS JSON diferentes (varias facturas, varias fechas de atención) es normal y **nunca** cuenta como repetido — sin importar en cuántos archivos distintos aparezca.
- "Repetido" ahora significa exclusivamente: el mismo usuario (mismo tipo + número de documento) aparece más de una vez **dentro de un mismo archivo JSON**. Ese es el único caso que se cuenta en el contador "Usuarios repetidos" del dashboard, en el badge del menú "Repetidos", y en la pantalla de Repetidos.
- Se eliminó la sección "Usuarios repetidos entre archivos distintos" y el botón de descarga de consolidado, ya que ese caso no debe marcarse como repetido.

## V20 - Panel de Parametrización de campos
- Nuevo botón en el menú: **Parametrización**.
- Lista TODOS los campos conocidos de la estructura (raíz, usuario, y cada uno de los 7 grupos de servicios), agrupados por sección y con buscador. Junto a cada campo se muestra un valor de ejemplo tomado de los archivos ya cargados (útil para ver de un vistazo cuáles están en `null` hoy, como `codigoVIDA` o `vrDispensacion`).
- Para cada campo puedes configurar:
  - **Requerido**: "Puede estar vacío / null" (por defecto, sin cambios) o "Debe tener valor".
  - **Tipo de dato**: Cualquiera (por defecto), Solo números, Solo letras, o Alfanumérico.
- Solo se valida lo que configures explícitamente — un campo sin parametrización sigue funcionando exactamente igual que antes.
- Los cambios se guardan automáticamente en el navegador (persisten aunque cierres y vuelvas a abrir) y revalidan todos los archivos cargados al instante.
- Nuevos hallazgos que puede generar: `CAMPO_PARAMETRIZADO_VACIO` (el campo debía tener valor y está en null/vacío) y `CAMPO_PARAMETRIZADO_TIPO_INVALIDO` (el valor no cumple el tipo de dato configurado).
- Botón "Restablecer todo" para borrar toda la parametrización personalizada y volver al comportamiento por defecto.

## V21 - Parametrización: tipos "Fecha" y "Fecha y hora"
- El selector de tipo de dato en Parametrización ahora incluye dos opciones más:
  - **Fecha (AAAA-MM-DD, ej. 2026-01-03)**: exige formato de fecha sin hora.
  - **Fecha y hora (AAAA-MM-DD HH:MM, ej. 2026-01-03 12:00)**: exige formato de fecha con hora.
- Usan la misma validación de fecha del sistema (mes 01-12, día válido según el mes/año, hora 00-23, minuto 00-59). Si el campo trae hora cuando se configuró como solo "Fecha" (o viceversa), se marca como error.

## V22 - vrDispensacion numérico por defecto
- `vrDispensacion` (en `medicamentos` y en `otrosServicios`) ahora viene preconfigurado desde el primer uso del dashboard con tipo **"Solo números"** en el panel de Parametrización — no hace falta configurarlo a mano.
- Sigue siendo 100% editable ahí mismo: si lo cambias o lo restableces, tu elección se respeta y no se vuelve a sembrar el valor por defecto.
- Se corrigió además un error de inicialización (orden de declaración) que habría impedido cargar el dashboard.

## V23 - Convertidor RIPS JSON → TXT, y panel de Configuración
1. **Convertidor a TXT**: en Archivos, cada fila tiene un botón "⇩ TXT" que convierte ESE RIPS a los TXT clásicos por grupo (US = usuarios, AC = consultas, AP = procedimientos, AU = urgencias, AH = hospitalización, AN = recién nacidos, AM = medicamentos, AT = otros servicios), uno por archivo, sin encabezado, separados por coma, empacados en un ZIP. También hay un botón "Convertir todos a TXT (ZIP)" para procesar todos los archivos cargados de una vez, organizados en carpetas dentro del ZIP.
   - Cada fila TXT usa exactamente los campos de la estructura de referencia (`rips_schema.js`), en el mismo orden, precedidos por el obligado/factura del archivo y (en los grupos de servicio) el tipo+documento del usuario, para mantener la trazabilidad.
   - **Nota**: esto es una conversión delimitada por comas de tu JSON, no necesariamente el layout exacto de columnas de la antigua Resolución 3374. Si tu proceso exige ese formato específico columna por columna, dime y lo ajusto para que calce exacto.
2. **Panel de Configuración** (nuevo botón en el menú): guarda el **nombre del hospital / centro de salud** y el **NIT** (opcional). Estos datos se usan para nombrar los archivos generados: `{Hospital}_{Trimestre}_{Factura}_...`. El trimestre se calcula automáticamente a partir de las fechas de atención encontradas en cada RIPS (ej. `T2-2026`). Se guarda en este navegador.
3. **Generador de PDF**: pendiente de que subas la plantilla/valores que me indicaste — en cuanto la tenga, conecto los campos del RIPS a las posiciones del PDF y reuso el mismo esquema de nombres (hospital + trimestre) para guardarlo.

## V24 - TXT unificado (un solo archivo) + registro CT
- Se agregó el registro **CT (control)**: una fila por cada RIPS con los totales reales — cantidad de registros en cada grupo (US, AC, AP, AU, AH, AN, AM, AT) y el valor total facturado (calculado sumando el valor de cada servicio).
- El botón principal ahora genera **un solo archivo `.txt` unificado** (no un ZIP): junta CT, US, AC, AP, AU, AH, AN, AM y AT en un único archivo, cada fila con el código de su grupo como primera columna, para poder distinguirlas dentro del mismo archivo.
  - Por archivo individual: botón "⇩ TXT unificado" en la tabla de Archivos.
  - Para todos los RIPS cargados juntos en un solo archivo: botón "⇩ TXT unificado (1 archivo, todos los RIPS)".
- Se conserva la opción de descargar por grupos separados en un ZIP (botón "⇩ Por grupos (ZIP)"), para quien todavía necesite los archivos AC.txt, AP.txt, etc. por separado.
- Probado con los 6 RIPS de ejemplo: generó 19 líneas — 6 CT (uno por factura), 6 US, y una fila por cada uno de los 7 grupos de servicio.

## V25 - Configuración de Trimestre/Año + Descarga de reporte PDF
- En **Configuración** ahora hay: Trimestre (selector 1° Trim / 2° Trim / 3° Trim / 4° Trim), Año (número, tú lo escribes — ya no se calcula solo), y "Nombre para el reporte" (profesional/responsable, ej. SAMUEL VILLANUEVA).
- El nombre del archivo PDF sigue exactamente tu formato: `MC {n}° Trim{AA}RIPSJsonrRes948 vs ProDec219 Items Odontologia {NOMBRE}.pdf` — probado que genera carácter por carácter igual al ejemplo que diste.
- Botón **"⇩ Descargar PDF"** en Configuración: por ahora genera un reporte general (hospital, NIT, periodo, responsable, totales de archivos/usuarios/servicios/hallazgos, y conteo por grupo de servicio) con ese nombre exacto. En cuanto compartas la plantilla con los valores y dónde va cada uno, ajusto el contenido del PDF sin cambiar el nombre del archivo.
- Los nombres de los TXT (unificado y por grupos) ahora también usan el Trimestre+Año configurados en vez de calcularlos de las fechas del RIPS, para que todo quede consistente.

## V26 - Corrección: un solo archivo por grupo (US, AC, AP...), no mezclado ni repetido
- Se corrigió el TXT unificado de la v24, que no era lo pedido (mezclaba todo en un archivo con código como columna). Ahora es tal como se pidió: **un solo `US.txt`, un solo `AC.txt`, un solo `AP.txt`**, etc. — cada uno consolidando los registros de **todos** los RIPS cargados, no repetido por factura.
- Botón "Convertir todos a TXT" en Archivos: genera un ZIP con `US.txt`, `AC.txt`, `AP.txt`, `AU.txt`, `AH.txt`, `AN.txt`, `AM.txt`, `AT.txt` y `CT.txt` (control, una fila por factura con sus totales), cada uno consolidado.
- Botón "TXT" por fila: igual pero solo con los datos de esa factura.
- Probado con los 6 RIPS de ejemplo cargados juntos: generó un único `US.txt` con las 6 filas de usuario, y un `CT.txt` con las 6 filas de control — cada grupo en su propio archivo, sin mezclar ni duplicar carpetas.

## V27 - La Parametrización manda: ya no se duplica ni se ignora en Validación
- Corregido: si parametrizas un campo (le pones tu propia regla en el panel de Parametrización), esa configuración **reemplaza por completo** la validación fija que tenía el sistema por defecto para ese campo — ya no aparecen los dos a la vez, ni se ignora tu configuración.
  - Si dices que el campo puede estar vacío → deja de marcarse como obligatorio, aunque por defecto lo fuera (ej. `codSexo`, `tipoDocumentoIdentificacion`, `numDocumentoIdentificacion`, `tipoUsuario`, `fechaNacimiento`, `numDocumentoIdObligado`, `codConsulta`, `codProcedimiento`, `consecutivo`).
  - Si dices que debe tener valor → se sigue marcando como error, pero ahora con el código `CAMPO_PARAMETRIZADO_VACIO` (antes salía duplicado con el código fijo del sistema).
- Además se corrigió un error real: cuando un campo parametrizado como obligatorio **no existía en absoluto** en el JSON (ni siquiera como null), antes no se detectaba. Ahora sí se detecta igual que si estuviera vacío.

## V28 - Detección automática de entidad por NIT + edad de usuarios
1. **Catálogo NIT → Nombre de entidad** (`entities_catalog.js`, vacío por ahora — mándame el Excel con esa tabla y lo cargo igual que hice con el CIE-10).
   - Al cargar RIPS, el sistema detecta automáticamente el `numDocumentoIdObligado` (NIT) de cada archivo y lo busca en ese catálogo.
   - En Configuración aparece un aviso "Entidad detectada por NIT" mostrando cada NIT encontrado y, si está en el catálogo, su nombre — con un botón "Usar este nombre" para aplicarlo directo al campo Hospital/Centro de salud. Si hay una sola entidad detectada y el campo está vacío, se completa solo.
2. **Edad de cada usuario**: nueva columna "Edad" en la tabla de Usuarios, calculada a partir de `fechaNacimiento` (si la fecha no es válida, muestra "—" en vez de inventar un número).

### Pendiente para completar el PDF (necesito esto tuyo, no lo voy a inventar en un informe de salud regulado):
- El Excel con la tabla NIT → Nombre de entidad.
- La plantilla PDF real (o al menos las posiciones/campos).
- Los criterios exactos del RIPS para distinguir "Consulta de primera vez", "Consulta de control" y "Sesión odontológica" (¿qué códigos de `codConsulta`/`codProcedimiento`, o qué otro campo, los diferencia?), y qué dato exacto se compara contra "Dec2193" para sacar la diferencia.
- Los rangos de edad que usa el informe "INFORME DEPURADO DE SALUD ORAL" (ya tengo la edad calculada por usuario, solo falta saber en qué rangos agruparla).

## V29 - Corrección: la parametrización ya no se borraba sola
- Bug real encontrado y corregido: cuando en Parametrización dejabas un campo en "Puede estar vacío / null" + tipo "Cualquiera" (la combinación que se ve igual al valor por defecto), el sistema **borraba esa configuración en vez de guardarla**. El campo volvía a quedar "sin parametrizar" por dentro, y si tenía una validación fija por defecto (como los campos obligatorios de usuario), esa validación se reactivaba sola e ignoraba lo que acababas de configurar.
- Ahora cualquier cambio que hagas en Parametrización se guarda siempre, sin importar si el valor elegido coincide con el default. Tu configuración manda y no vuelve a mostrar error mientras la tengas puesta.

## V30 - Primer avance del PDF real (Decreto 2193 - Salud Oral)
Con la plantilla real que compartiste, empecé por las 3 primeras partes:

1. **Nombre de la entidad**: usa el nombre configurado en Configuración (que se autocompleta por NIT cuando subas el Excel del catálogo, o lo escribes tú), y se muestra centrado en el encabezado del PDF tal como en la plantilla.
2. **Fecha de Elaboración**: se pone automáticamente la fecha de hoy en formato DD/MM/AAAA.
3. **Tabla de 6 conceptos (RIPS Json.4 / Dec2193 / Diferecia)**: cada concepto se calcula contando, en todos los RIPS cargados, los registros de consultas/procedimientos cuyo código esté en la lista configurada en Configuración → Indicadores del informe:
   - **10_346 Total de consultas de odontología (valoración)** = consultas de primera vez (`890203`) + urgencias (`890703`). Confirmado: reproduce exacto el 135 de tu plantilla.
   - **13_347 Sellantes aplicados** = procedimiento `997107`. Confirmado: reproduce el 57 exacto.
   - **14_348 Superficies obturadas** = procedimiento `232102`. Confirmado: reproduce el 21 exacto.
   - **15_349 Exodoncias (cualquier tipo)** = suma de `230101`+`230102`+`230202`. Confirmado: reproduce el 17 exacto.
   - **11_751 Número de sesiones de odontología** y **12_429 Total de tratamientos terminados**: quedan en 0/sin código por ahora — no logré deducir la fórmula exacta comparando contra los totales visibles de tu plantilla; en Configuración → Indicadores puedes poner los códigos tú mismo, o dime el criterio y lo dejo listo.
   - Los valores "Dec2193" (columna de comparación) se digitan a mano en Configuración → Valores Dec2193, ya que no vienen del RIPS; el PDF calcula la "Diferecia" automáticamente restando.
4. **Catálogo NIT → Entidad**: creado `entities_catalog.js` (vacío), listo para cargar el Excel con esa tabla en cuanto lo subas.

Pendiente para el resto de la plantilla (siguiente paso): el desglose "INFORME DEPURADO DE SALUD ORAL" por CUPS y rango de edad, y la tabla "TOTAL CONSULTA DE 1°, CONTROL Y SESIONES ODONTOLOGICAS".

## V31 - Login básico
- Se agregó una pantalla de acceso: usuario `admin`, contraseña `admin123`.
- Es una barrera del lado del navegador, no seguridad real: como este archivo corre 100% local sin servidor, alguien con conocimientos técnicos podría ver el código fuente y encontrar la contraseña. Sirve para evitar que cualquiera abra el archivo y entre directo, no para proteger datos sensibles frente a un atacante decidido.
- La sesión se mantiene mientras la pestaña siga abierta (se guarda en `sessionStorage`); al cerrar el navegador o la pestaña, pide login de nuevo.
- Botón "Cerrar sesión" al final del menú lateral.
- Probado con una simulación de DOM real: antes de iniciar sesión solo se ve la pantalla de login; después de un login correcto, se muestra el dashboard completo y se oculta el login.

## V32 - Bug de título arreglado + limpieza de textos descriptivos
- **Bug real corregido**: al entrar a "Parametrización" o "Configuración", el título de la página (arriba a la izquierda) se quedaba pegado en el último título válido (normalmente "Dashboard"), porque esas dos vistas no estaban registradas en la lista interna de títulos y el código fallaba silenciosamente antes de actualizarlo. Por eso se veía "Dashboard" arriba con el contenido de Configuración/Parametrización debajo. Ya están registradas y el título cambia correctamente en las 8 secciones.
- Se quitaron los párrafos explicativos largos en **Archivos, Usuarios, Repetidos, Validación, Parametrización y Configuración** (incluyendo Indicadores y Valores Dec2193), dejando solo los títulos y los controles funcionales.

## V33 - Zona de carga (dropzone) solo en Dashboard y Servicios
- La zona de arrastrar archivos y la barra de progreso de carga vivían fuera del sistema de vistas, así que se quedaban visibles en TODAS las pestañas (Archivos, Usuarios, Repetidos, Validación, Parametrización, Configuración) llenando la pantalla arriba de cada una.
- Ahora solo aparece en **Dashboard** y **Servicios**; en el resto de pestañas queda oculta. Probado con las 8 vistas: dropzone visible solo en esas dos, oculta en las otras 6.
- Se reordenó el menú: **Servicios quedó justo debajo de Dashboard** (antes estaba más abajo, después de Usuarios).

## V34 - Segundo usuario de acceso
- Se agregó un segundo usuario válido: **root / root12345** (además de admin / admin123).
- Ambos dan acceso completo al sistema.

## V35 - Filtro por edad en los indicadores (confirmado con las consultas SQL reales)
Con las consultas Access que compartiste, confirmé y ajusté el motor de indicadores:
- **`13_347 Sellantes aplicados`**: ahora filtra también por edad **3 a 15 años** (confirmado por el join con `[ZZ-CICLO DE VIDA 3 a 15 SALUD ORAL]`), además del código `997107`. Antes solo filtraba por código.
- **`10_346`, `14_348`, `15_349`**: confirmado que su lógica (código en lista, sin filtro de edad) ya estaba correcta.
- En Configuración → Indicadores del informe, cada fila ahora tiene también **"Edad mín" y "Edad máx"** editables (vacío = sin filtro, todas las edades).
- Probado: con un paciente de 10 años y otro de 40, ambos con sellante y obturación — el sellante solo contó al de 10 años (dentro de 3-15), la obturación contó a ambos (sin filtro de edad). Correcto.

### Aún pendiente (no vino en este extracto):
- Los códigos reales de la tabla `TR_CUPSRips Sesiones Odont AP` (para completar **11_751 Número de sesiones de odontología**) — la estructura de la consulta confirma que es "código en una lista de referencia" tal como ya lo tengo armado, solo falta el contenido exacto de esa lista.
- La consulta de **12_429 Total de tratamientos terminados (Paciente terminado)** no llegó en este envío.

## V36 - Listas de códigos completas (CodCUPSOdont.xlsx)
Con las 5 hojas del Excel que subiste, actualicé los códigos de cada indicador:
- **`11_751 Número de sesiones de odontología`**: 230 códigos de la hoja "Sesiones odontologicas" (antes vacío). Probado contra los datos visibles de tu PDF real: da **136**, a solo 1 del **137** esperado — prácticamente exacto (la diferencia de 1 probablemente corresponde a un código que no se desglosó como fila propia en la tabla que compartiste).
- **`13_347 Sellantes aplicados`**: ahora incluye los 3 códigos (`997101`, `997102`, `997107`), no solo uno. Sigue con el filtro de edad 3-15 años.
- **`14_348 Superficies obturadas`**: ahora incluye los 7 códigos de la hoja "Superficies Obturadas" (`232100`-`232104`, `232200`, `232201`), no solo `232102`.
- **`15_349 Exodoncias`**: ahora incluye los 8 códigos de la hoja "EXODONCIA" (`230100`-`230103`, `230200`-`230203`), no solo 3.
- **`10_346 Total de consultas (valoración)`**: sin cambios, ya estaba correcto (890203 + 890703, excluyendo control).
- Sigue pendiente solo la fórmula/consulta de **`12_429 Total de tratamientos terminados (Paciente terminado)`**.

**Nota**: si ya habías tocado manualmente algún código en Configuración → Indicadores antes de esta versión, tu configuración guardada tiene prioridad y no se sobreescribe sola — revisa esos campos si quieres traer las listas nuevas.

## V37 - Estructura de salida TXT oficial exacta (ESDTRUCTURA_DE_SALIDA_JSON.xlsx)
Reescribí por completo el generador de TXT para seguir exactamente el layout que compartiste, columna por columna:
- **US** (12 campos: U01-U12), **AC** (32 campos: C01-C30, con numeración duplicada tal cual tu plantilla), **AH** (33 campos: H01-H30), **AM** (31 campos: M01-M31), **AN** (20 campos: N01-N18), **AP** (30 campos: P01-P27), **AT** (21 campos: S01-S19), **AU** (28 campos: R01-R25).
- **CT** cambió por completo: ya NO es un resumen de totales — ahora es, tal como tu Excel lo define, una sola fila por RIPS con `T01_numDocumentoIdObligado, T02_NumFactura, T03_TipoNota, T04_numNota`.
- Cada archivo TXT ahora incluye una **fila de encabezado** con los nombres oficiales de columna (U01_NumFactura, C01_NumFactura, etc.), antes de los datos. Al combinar varios RIPS en un solo archivo (botón "Convertir todos"), el encabezado aparece una sola vez, no repetido por cada factura.
- Verificado con tu fila de ejemplo real de AC (factura HC205275): la salida generada coincide **exacta, carácter por carácter**, con la fila de tu plantilla.
- **Catálogo NIT → Entidad actualizado**: cargué las 33 ESE del Magdalena de la hoja "ESE con Cod Habilitacion-Nit" (incluye "E.S.E. CENTRO DE SALUD SAMUEL VILLANUEVA VALEST", NIT 819004280). La detección automática por NIT en Configuración ya funciona con datos reales.

## V38 - Valor manual por indicador (editar / eliminar / bloquear)
- Cada indicador en Configuración → Indicadores ahora tiene un campo **"Manual"** donde puedes escribir el número a mano por teclado. Si le pones un valor, ese manda sobre el cálculo automático por códigos — útil sobre todo para **12_429 Total de tratamientos terminados**, que todavía no tiene fórmula confirmada.
- Tres íconos junto al campo:
  - **✎ Editar**: desbloquea el campo (si estaba bloqueado) y lo deja listo para escribir.
  - **🗑 Eliminar**: borra el valor manual y vuelve a calcularlo automático por códigos.
  - **🔒/🔓 Bloquear**: al bloquear, el campo (y también los de códigos/edad de esa fila) quedan protegidos contra ediciones accidentales, hasta que le des "Editar" de nuevo.
- El indicador de valor (pill) ahora dice **MANUAL** o **AUTO** según de dónde viene el número, y el PDF usa automáticamente el que corresponda.
- Probado: sin valor manual da 0 (automático); con 42 escrito a mano, usa 42; al bloquear se mantiene; al eliminar vuelve a automático.

## V39 - Las 2 tablas restantes del PDF (INFORME DEPURADO y TOTAL CONSULTA/SESIONES)
Con la primera tabla ya confirmada, agregué las dos secciones de abajo:

1. **INFORME DEPURADO DE SALUD ORAL** (desglose por CUPS y edad): tabla con CodCUPS, nombre del procedimiento (desde el catálogo CUPS), rango de edad, y las 5 columnas de edad (3 A 5, 6 A 15, <= 17, > 12, Toda Edad) + TOTAL, con "Total del Serv." arriba a la derecha. Cada código tiene su rango de edad asignado (confirmado con tu plantilla real: sellantes = 3 a 15 años, el resto según lo que muestra tu PDF). **Probado: el "Total del Serv." da exactamente 679**, igual que tu plantilla.
2. **TOTAL CONSULTA DE 1°, CONTROL Y SESIONES ODONTOLOGICAS**: primera vez, control, urgencias, total atenciones, sesiones, e **índice de procedimientos por consulta odontológica** — deduje la fórmula comparando tus números: `sesiones ÷ (primera vez + control)`, **excluyendo urgencias** del denominador (137÷169=0.81, coincide exacto).
- Ambas tablas y sus códigos por edad quedan en `state.ageBreakdownRows` (persistido), listos para ajustar si tu RIPS real trae otros códigos que aún no están en la lista.
- El pequeño desfase de 1 unidad en "sesiones" (136 en vez de 137, ya documentado en v36) se propaga proporcionalmente al índice (0.80 en vez de 0.81) — es el mismo gap conocido, no un error nuevo.

## V40 - Mensajes al limpiar datos + caché
- Al confirmar "Limpiar datos + caché", ahora aparece primero el mensaje **"Limpiando caché..."**, y al terminar cambia a **"Datos y caché limpios"**.

## V41 - Corregido: no dejaba subir archivos ni carpetas
- Encontré la causa: `DEFAULT_AGE_BREAKDOWN_ROWS` (usada para la tabla de desglose por CUPS/edad del PDF) se declaraba mucho más abajo en el archivo de lo que se usaba, provocando un error de JavaScript apenas se abría la página — y ese error detenía TODO el resto del script, incluyendo el botón de subir archivos y la carpeta.
- Ya está corregido: `AGE_COLUMNS` y `DEFAULT_AGE_BREAKDOWN_ROWS` se movieron arriba, antes de usarse. Verificado cargando la página completa en un simulador de navegador: ya no lanza ningún error al iniciar, y el selector de archivos vuelve a funcionar.
- Si ya habías descargado una versión anterior (v39/v40) y no te dejaba subir archivos, descarga esta v41.

## V42 - PDF tamaño oficio, más compacto, con el encabezado real
- **Tamaño de página**: oficio (216 x 330 mm) en vez de A4, para que quepa toda la información con menos saltos de página.
- **Diseño más compacto**: menos espacio entre secciones, tablas con letra y relleno de celda más ajustados (imitando la plantilla real que compartiste).
- **Encabezado real agregado**: extraje el logo/banner de "Gobernación del Magdalena — Secretaria Seccional de Salud / Planeación Asistencia Municipal" directamente de tu PDF de referencia y lo integré arriba del reporte generado.
- **Pie de página agregado**: firma ("V.b [nombre configurado] — Profesional Universitario"), el párrafo legal sobre el Decreto 2193/CUV/Resolución 084, y la nota de fecha máxima de entrega — igual que en tu plantilla.
- Verificado que la app sigue cargando sin errores tras estos cambios (carga completa simulada, sin excepciones).

## V43 - Texto más negro, negrita en totales, firmante correcto
- **Texto en negro puro** en las 3 tablas del PDF (antes usaba un gris oscuro).
- **"Total Atenciones"**: ahora el título Y la cantidad van en negrita (antes solo la cantidad).
- **"índice de procedimientos por consulta odontológica"**: título Y el total en negrita.
- **Firma corregida**: nuevo campo en Configuración → "Profesional que firma el PDF (V.b)", con **MARILUZ CABRERA** como valor por defecto (igual que tu plantilla real). El PDF ahora muestra "V.b MARILUZ CABRERA" / "Profesional Universitario" en vez del guion "—" que salía antes. Totalmente editable si cambia quién firma.

## V44 - Tablas con estilo más profesional
- **Encabezados de tabla**: banda de color azul oscuro sólido con letra blanca en negrita (en vez del gris plano de antes).
- **Filas alternadas (cebra)**: cada fila par tiene un fondo celeste muy claro, para que sea más fácil seguir la lectura en tablas largas como el desglose por CUPS.
- **Números alineados a la derecha** en vez de centrados — más estándar en reportes financieros/tabulares.
- **Títulos de sección con banda**: "INFORME DEPURADO..." y "TOTAL CONSULTA DE 1°..." ahora van sobre una banda azul oscuro con letra blanca, como un separador de sección de informe corporativo, en vez de texto suelto centrado.
- **Filas de totales resaltadas**: "Total Atenciones" e "índice de procedimientos por consulta odontológica" ahora tienen fondo celeste distintivo además de la negrita, para que salten a la vista.

## V45 - Selector de estilo del PDF (8 opciones, con "Predeterminado")
- Nuevo selector en Configuración → Reporte PDF: **"Estilo del PDF"**, con las 8 opciones que se mostraron para elegir:
  - **Predeterminado** (Corporativo Azul, el que ya venía usando el sistema)
  - **B** - Minimalista Blanco y Negro
  - **C** - Institucional Verde Salud
  - **D** - Clásico Formal Gris
  - **E** - Documento Limpio (sin líneas)
  - **F** - Cebra Suave (sin líneas)
  - **G** - Banda de Color, sin rejilla
  - **H** - Tipográfico Puro (serif, sin líneas)
- El estilo elegido se guarda en este navegador y se aplica automáticamente la próxima vez que descargues el PDF — no hay que volver a elegirlo cada vez.
- Las 3 tablas y los títulos de sección respetan el estilo elegido: color de acento, si dibuja rejilla completa o solo una línea bajo el encabezado, filas cebra o no, banda de color en los títulos o texto plano, y tipografía (Helvetica o Times).
- Nota: la generación real del PDF se probó por sintaxis y carga sin errores; el render visual final depende de `jspdf-autotable` (cargado desde internet la primera vez que generas un PDF) — pruébalo con el botón "Descargar PDF" y avísame si algún estilo no se ve como esperas para ajustarlo.

## V46 - Carpeta de guardado (TXT + PDF organizados por trimestre) + ajuste 1 hoja
1. **Carpeta de guardado**: en Configuración, donde antes estaba "Nombre para el archivo" ahora hay **"📁 Elegir carpeta"**. Al elegirla, el PDF y los TXT se guardan directamente ahí (sin diálogo de descarga), dentro de una subcarpeta que se crea sola según el trimestre (ej. `2Trim26/`). La carpeta se recuerda entre sesiones (aunque el navegador puede pedir volver a autorizar el permiso por seguridad). Funciona en Chrome/Edge (File System Access API); en otros navegadores cae automáticamente a la descarga normal.
   - El nombre para el archivo del PDF ahora se toma directo del nombre completo de la entidad (arriba en Configuración), ya no hace falta escribirlo aparte.
2. **Ajuste de espacios**: reduje márgenes/espaciados entre líneas y secciones del PDF para dar más margen de seguridad a que todo quepa en **una sola hoja tamaño oficio** (216 x 330 mm).

## V47 - Corregido de verdad: 1 sola hoja oficio (medido con datos reales)
Mi confirmación de la vez pasada estaba mal — la probé con la tabla 2 vacía por accidente, así que "cabía" solo porque le faltaban las 13 filas reales. Ya lo corregí de verdad, midiendo con la librería real y datos que reproducen tu último reporte (E.S.E. CENTRO DE SALUD SAMUEL VILLANUEVA VALEST, 164/256/13/202/22/19):

1. **Tabla 2 (desglose por CUPS) más compacta**: bajé la fuente de 6.8 a 6.2pt, reduje el relleno de celda, y reacomodé el ancho de columnas (más espacio a "PROCEDIMIENTO" para que los nombres largos no se partan tanto en 2 líneas). Esa tabla bajó de 116mm a 91.5mm de alto — era la que empujaba todo lo demás fuera de la hoja.
2. **Pie de página sin traslapes**: la nota legal, el cierre y "Generado" ahora se posicionan en cadena usando la medición real de la librería (`getTextDimensions`) en vez de números calculados a mano, así nunca se pueden volver a superponer sin importar cuánto ocupen las tablas de arriba.
3. Aviso en consola si alguna vez el contenido se pasa de 1 página, para detectarlo rápido en el futuro.

**Verificado con las 8 opciones de estilo, usando el código real de `app.js`** (no una copia aparte): las 8 dan 1 sola página, sin traslapes, con datos reales de tu plantilla.

## V48 - "Predeterminado" ahora es idéntico a tu plantilla oficial
Comparando de nuevo contra tu PDF real, encontré la técnica exacta que usa: los nombres largos de procedimiento **se cortan en una sola línea** (ej. "CONSULTA DE CONTROL O DE SEGUIMIENTO POR ODON"), no se envuelven en 2 líneas ni se reduce la letra a algo ilegible. Cambié el enfoque:

1. **Truncado de texto a 1 línea**: nuevo helper que corta el texto exactamente al ancho de la columna (sin "...", igual que tu plantilla), aplicado a "PROCEDIMIENTO" y "Edad del Serv" en la tabla 2.
2. **Letra de tamaño normal**: subí la tabla 2 de 6.2pt a 7.8pt (legible), y ensanché las columnas (más espacio a "PROCEDIMIENTO").
3. **"Predeterminado" ahora es una réplica fiel de tu plantilla oficial**: sin bandas de color, sin relleno, sin rejilla — solo texto y una línea fina bajo los encabezados, igual que el original.
4. El estilo azul corporativo que antes era el predeterminado no se perdió — quedó disponible como una **9na opción ("I - Corporativo Azul")** en el selector.
- Verificado con datos reales: las 9 opciones de estilo siguen dando 1 sola página.

## V49 - Quitado el negrita no pedida + filas más juntas en tabla 1 y 3
- Quité la negrita que le había puesto por mi cuenta a toda la columna "Diferecia" de la tabla 1 — no la pediste, ya vuelve a estar en texto normal.
- Reduje el espacio entre filas en las tablas 1 y 3 (de 2.4mm a 1.4mm de relleno arriba/abajo) para que no se vean tan separadas.

## V50 - Nombre completo del procedimiento (sin cortar) + filas más juntas
- Quité el truncado de texto en "PROCEDIMIENTO": ahora se ve el **nombre completo**, no cortado. Solo se envuelve a una segunda línea en el caso extremo donde ni ensanchando la columna cabe en una línea (ej. "CONSULTA DE CONTROL O DE SEGUIMIENTO POR ODONTOLOGÍA GENERAL", el nombre más largo de todos).
- Ensanché la columna "PROCEDIMIENTO" y reduje el relleno de celda para filas más juntas.
- Reduje solo la letra del encabezado de columna (a 6.6pt) para que "CodCUPS", "6 A 15", etc. no se partan, sin afectar la letra de los datos (que sigue en 7.6pt, legible).
- Verificado con datos reales: sigue en 1 sola página.

## V51 - Menú lateral más profesional
- Agrupé las opciones en 3 secciones con etiqueta: **Panel** (Dashboard, Servicios), **Datos** (Archivos, Usuarios, Repetidos, Validación), **Sistema** (Parametrización, Configuración).
- Indicador de selección: la opción activa ahora tiene una barra de acento a la izquierda y un degradado sutil, en vez de solo cambiar el fondo.
- Iconos alineados en una columna fija para que el texto quede parejo.
- Botón "Cerrar sesión" con ícono y mejor contraste.
- Detalles generales: sombra lateral en el menú, mejor jerarquía tipográfica en el logo/marca, transiciones suaves al pasar el mouse.

## V52 - Botón para cargar el archivo Dec2193 (Excel/TXT)
- Nuevo botón en Configuración → "📥 Cargar archivo 2193 (Excel/TXT)". Reemplaza tener que escribir los 6 valores de Dec2193 a mano.
- Busca en **todas las hojas** del Excel una fila cuyo texto empiece con el código de cada concepto (10_346, 11_751, 12_429, 13_347, 14_348, 15_349) y toma el valor de la columna "Dec2193" (si no la encuentra por nombre, usa el último valor numérico de esa fila).
- Si detecta el nombre de la entidad en el archivo (como la celda "ESE HOSPITAL DE CERRO DE SAN ANTONIO" en la esquina de la hoja) y el campo de Configuración está vacío, lo completa solo.
- También acepta .txt/.csv (delimitado por coma, punto y coma o tabulación).
- Probado con tu archivo real `LG_Validacion_ProDec2193_y_Calidad_Ver_25-05-2026.xlsx`: detectó los 6 conceptos con sus valores exactos (344, 252, 293, 104, 83, 47) y la entidad correctamente.

## V53 - El cargador de Dec2193 ahora también soporta el formato de datos crudos
Al probar con el archivo real que subiste, resultó tener una estructura distinta a la que había probado antes: en vez de una hoja resumida con "10_346 ..." como texto, trae los datos crudos del sistema con columnas `conc_codigo` y `total` (una fila por cada uno de los cientos de conceptos del Decreto 2193, no solo los 6 de odontología).

- El cargador ahora reconoce **ambos formatos**: si encuentra columnas `conc_codigo` + `total`, busca las filas cuyo `conc_codigo` sea 346, 751, 429, 347, 348 o 349 (los que corresponden a nuestros 6 conceptos) y toma el valor de `total`; si no, sigue funcionando igual que antes con el formato resumido (texto "10_346..." + columna "Dec2193").
- También detecta el nombre de la entidad desde la columna `nombre` en este formato.
- Probado con tu archivo real: detecta los 6 conceptos exactos (344, 252, 293, 104, 83, 47) y la entidad "ESE HOSPITAL DE CERRO DE SAN ANTONIO".

## V54 - Panel de Controles de embarazo
- Nuevo panel en el Dashboard: **"Controles de embarazo"**, con una etiqueta mostrando el total y una tabla con Documento, Tipo, Controles prenatales, Factura y Archivo.
- Usa el campo oficial del RIPS `numConsultasCPrenatal` (dentro del grupo Recién nacidos) — es el conteo real de controles prenatales que tuvo cada paciente antes del parto, tal como viene en el JSON.
- La tabla sale ordenada de mayor a menor cantidad de controles, para que se vea rápido quién tuvo más o menos seguimiento prenatal.
- Probado con datos que simulan varios partos: suma el total correcto y lista cada paciente con su cantidad.

## V55 - Botón "Generar todos los hospitales" (uno por carpeta)
1. **Nuevo botón en Configuración**: "🏥 Generar todos los hospitales". Agrupa automáticamente todos los RIPS que tengas cargados por NIT (`numDocumentoIdObligado`), y para cada hospital detectado:
   - Le crea su **propia carpeta** (con su nombre real, tomado del catálogo NIT→entidad) dentro de la carpeta de guardado que elegiste.
   - Adentro, genera su **PDF**, sus **TXT** (US, AC, AP, etc.) y un **registro de usuarios del trimestre**, todo dentro de la subcarpeta del trimestre (ej. `Hospital X/2Trim26/`).
   - Requiere haber elegido la carpeta de guardado primero (mismo botón "📁 Elegir carpeta" de antes).
2. **Registro de usuarios por trimestre** (`_registro_usuarios.json`): cada vez que generas un reporte (individual o en lote), se guarda un archivo con la lista de documentos de usuarios de ese hospital en ese trimestre. Es la base para poder comparar más adelante entre trimestres (1° vs 2°, 3° vs 1°+2°, 4° vs 1°+2°+3°) — la comparación en sí (mostrar quién se repitió) queda pendiente para un siguiente paso, pero ya está quedando guardada la información necesaria trimestre a trimestre.
- Probada la lógica de agrupación por NIT con datos de ejemplo: agrupa correctamente y resuelve el nombre real de cada hospital desde el catálogo.

## V56 - Comparación entre trimestres (2° vs 1°, 3° vs 1°+2°, 4° vs 1°+2°+3°)
- Nuevo botón en Configuración: **"🔍 Comparar con trimestres anteriores"**. Compara los usuarios de los RIPS que tienes cargados ahora mismo (el trimestre "actual", según lo que configuraste) contra los registros ya guardados de los trimestres anteriores del mismo año, para el mismo hospital:
  - **2° Trim** se compara con el **1°**.
  - **3° Trim** se compara con el **1° y 2°**.
  - **4° Trim** se compara con el **1°, 2° y 3°**.
- Por cada trimestre anterior muestra: cuántos usuarios tenía, cuántos de esos se repiten con el trimestre actual, y una muestra de esos documentos repetidos. Al final suma cuántos usuarios distintos del trimestre actual ya habían aparecido en cualquiera de los anteriores.
- **Requiere** que ya hayas generado (y guardado, con la carpeta elegida) los reportes de esos trimestres anteriores primero — ahí es donde se guarda el registro que se usa para comparar.
- **Cambio importante para que esto funcione**: ahora TODOS los reportes (generes uno solo o "todos los hospitales") se organizan siempre como `{carpeta}/{Hospital}/{Trimestre}Trim{Año}/`, incluso si antes usabas un solo hospital a la vez — así la comparación siempre encuentra los registros en el mismo lugar sin importar cómo los generaste.
- Probada la lógica de trimestres anteriores y de intersección de usuarios con datos de ejemplo: da exactamente el mapeo pedido y calcula bien los repetidos.

## V57 - Excluir automáticamente usuarios repetidos entre trimestres al generar/guardar
- Nueva casilla en Configuración (activada por defecto): **"Al generar el PDF o los TXT, excluir automáticamente los usuarios que ya se reportaron en un trimestre anterior del mismo año"**.
- Con esto activo: el **1° trimestre nunca se filtra** (no tiene anteriores). El **2°** excluye a quien ya salió en el **1°**. El **3°** excluye a quien ya salió en el **1° o 2°**. El **4°** excluye a quien ya salió en el **1°, 2° o 3°** — exactamente el cruce que pediste, para que ningún usuario quede reportado dos veces en el año.
- Aplica tanto al **PDF** (los conteos de indicadores también reflejan solo los usuarios nuevos de ese trimestre) como a los **TXT** (US, AC, AP, etc. — los excluidos ni siquiera aparecen en los archivos que se guardan).
- El filtro trabaja sobre una **copia**: nunca modifica los archivos que tienes cargados en pantalla, solo lo que se guarda/descarga.
- Cada vez que se genera algo con exclusiones, el aviso te dice cuántos usuarios se excluyeron.
- Necesita, igual que la comparación, que ya hayas generado y guardado (en esta misma carpeta) los reportes de los trimestres anteriores — de ahí saca la lista de quién ya se reportó.
- Probado con datos de ejemplo: excluye exactamente a los usuarios ya vistos, conserva a los nuevos, y no toca el archivo original.

## V58 - Registro de usuarios únicos, borrar solo Dec2193, y login más profesional
1. **`_registro_usuarios_unicos.json`**: nuevo archivo (hermano de `_registro_usuarios.json`) que se guarda junto a él cada vez que generas el PDF o los TXT. Mientras el original trae TODOS los usuarios cargados de ese trimestre, este trae solo los que **quedaron después del cruce contra trimestres anteriores** — los realmente nuevos/únicos de ese periodo.
2. **Botón "🗑 Borrar caché" en Valores Dec2193**: borra solo esos 6 valores (no toca los RIPS cargados). Además, corregí un error: el botón general de "Limpiar datos y caché" tampoco estaba reseteando estos valores en pantalla (solo el guardado interno) — ya quedan en 0 los dos.
3. **Login rediseñado**, más profesional e interactivo:
   - Fondo con degradado y dos manchas de luz animadas muy sutiles.
   - Tarjeta con entrada suave (fade + slide), campos con ícono (usuario/candado).
   - Botón de **mostrar/ocultar contraseña** (👁/🙈).
   - Si la clave es incorrecta, la tarjeta hace un **shake** (sacudida) además del mensaje de error.
   - El botón "Ingresar" muestra un spinner y dice "Verificando…" brevemente antes de resolver, para sensación más interactiva.
   - Pie con indicador de estado ("Validador local — los archivos no salen de tu navegador").
- Probado el flujo completo: clave incorrecta → error + shake; clave correcta → entra a la app.

## V59 - Sistema de licencia: vencimiento + bloqueo por equipo + acceso reforzado

⚠️ **Léelo completo antes de confiar en esto**: esta es una app estática sin servidor. Alguien con conocimientos técnicos SIEMPRE puede abrir las herramientas del navegador y quitar estas protecciones — no existe forma de evitarlo al 100% en una app que corre solo en el navegador. Esto sube la valla para copiado/uso casual, no es seguridad real de nivel empresarial.

**1. Vencimiento (5 de octubre de 2026)**: pasada esa fecha, el sistema muestra una pantalla de "Sistema vencido" y no deja entrar en ningún equipo.

**2. Bloqueo por equipo** (nuevo, antes de llegar al login usuario/contraseña):
- La primera vez que se abre en un computador, genera un **código de solicitud** único de ese equipo (huella basada en navegador, pantalla, zona horaria, etc.) y lo muestra en pantalla.
- Para activarse ahí, hace falta un **código de activación** que solo se puede generar con el archivo aparte **`generador_codigos_admin.html`** (adjunto por separado, NO va dentro del ZIP que se distribuye — guárdalo solo tú).
- Una vez activado, ese mismo equipo no vuelve a pedirlo. Si los archivos se copian a otro computador, ese otro equipo pedirá su propio código nuevo — y sin el generador, no lo puede resolver por su cuenta.
- **Importante**: el secreto usado (`LICENSE_SECRET`) está igual en ambos archivos — si alguna vez necesitas cambiarlo, tiene que cambiar en los dos a la vez, y las activaciones previas dejan de contar.

**3. Contraseñas ocultas**: ya no están en texto plano en el código — se comparan por huella SHA-256, así que aunque alguien abra el archivo, no puede leer la contraseña directamente (sí podría, en teoría, intentar "crackear" el hash, pero ya no es una lectura trivial).

**4. Deterrentes de inspección**: clic derecho deshabilitado, copiar/seleccionar texto bloqueado (fuera de los campos de formulario), atajos típicos para abrir herramientas de desarrollador bloqueados (F12, Ctrl+Shift+I/J/C, Ctrl+U), y un aviso visual si el navegador detecta que el tamaño de ventana sugiere herramientas de desarrollador abiertas.

**5. Respaldo técnico**: si el navegador no permite `crypto.subtle` (pasa en algunos casos al abrir un archivo local con doble clic), la app usa automáticamente un hash de reserva para que nunca quede completamente bloqueada por eso — tanto en el sistema principal como en el generador de códigos, para que sigan coincidiendo.

- Probado el flujo completo: equipo nuevo pide activación → código correcto (del generador) activa y recarga entra directo → código incorrecto no activa y muestra error.

## V60 - La carpeta queda de verdad configurada (reconectar con un clic, no re-buscarla)
- Antes, cuando el navegador pedía volver a autorizar la carpeta (algo que hace por seguridad, no porque se pierda la configuración), el botón te mandaba a **buscar y elegir la carpeta desde cero otra vez**.
- Ahora: si ya la habías elegido antes, el botón cambia a **"🔄 Reconectar carpeta"** y solo pide un permiso rápido del navegador sobre esa misma carpeta — no hay que volver a navegar hasta encontrarla. Así, una vez la eliges la primera vez, **queda configurada de verdad**.
- Agregué un enlace aparte "Elegir una carpeta distinta a la configurada" para el caso en que sí quieras cambiarla por otra.
- Confirmado que el reconocimiento automático de hospital por NIT (usando el catálogo de 33 ESE del Magdalena) sigue funcionando igual en "Generar todos los hospitales" y en la detección automática por NIT al cargar un RIPS.
- La configuración de la carpeta vive aparte del login/activación del equipo (son almacenamientos distintos del navegador) — cerrar sesión o que pase el tiempo no borra la carpeta configurada; solo pediría reconectar el permiso si el navegador lo exige, con el botón ya mencionado.

## V61 - Nombre/NIT del hospital también se borra con "Limpiar datos + caché"
Mismo patrón de error que ya había corregido con Dec2193: el botón "🗑 Limpiar datos + caché" borraba el localStorage por dentro, pero el nombre y NIT del hospital que se ven en Configuración (los que se llenan solos con el botón "Usar este nombre" cuando detecta la entidad por NIT) se quedaban en pantalla hasta recargar la página.
- Corregido: ahora el botón también limpia en pantalla el nombre, NIT, trimestre, año, firmante, y la lista de "Entidad detectada por NIT".
- Probado: se configura nombre/NIT como en la captura, se da "Limpiar datos + caché", y quedan vacíos de inmediato.

## V62 - Columna "Diferencia" en la comparación entre trimestres
- Nueva columna en la tabla de "Comparar con trimestres anteriores": **Diferencia** = usuarios de ese trimestre − repetidos con el actual. Es decir, cuántos de los pacientes de ese trimestre anterior **no volvieron a aparecer** en el trimestre actual.
- Queda entre "Repetidos con el actual" y "Documentos repetidos", con una nota abajo explicando cómo se calcula.

## V63 - Sin logo, nombre actualizado, usuario visible arriba, y bloqueo manual activo/inactivo
1. **Quité el logo "R+"** del menú lateral y del login.
2. **Texto actualizado**: ahora dice "Analizador de RIPS JSON — Resolución 0948 — Secretaría de Salud" (en el menú y en el login).
3. **"Cerrar sesión" movido a la parte superior izquierda** del menú (antes estaba abajo del todo), junto con:
4. **Nombre del usuario que inició sesión**, visible justo ahí arriba.
5. **Interruptor Activo/Inactivo** (punto verde/rojo), junto al nombre de usuario:
   - Empieza en verde ("Activo").
   - Un clic lo pasa a rojo ("Inactivo") y **bloquea todo el sistema** con una pantalla de bloqueo — nadie puede usar nada hasta que se vuelva a poner en verde.
   - Se puede reactivar tanto desde el botón de la pantalla de bloqueo como volviendo a hacer clic en el interruptor.
   - Se recuerda mientras dure la sesión: si recargan la página estando bloqueado, sigue bloqueado.
- Probado con Web Crypto real (igual que en un navegador de verdad): login exitoso muestra el nombre de usuario arriba, el botón de bloquear/desbloquear cambia de color y estado correctamente, y el overlay de bloqueo aparece/desaparece como se espera.

## V64 - Controles de embarazo: detección correcta por diagnóstico Z34/Z35
Corregido: antes usaba el campo `numConsultasCPrenatal` de Recién Nacidos (solo cubría partos ya registrados). Ahora detecta los controles prenatales de la forma correcta: **cualquier CONSULTA cuyo diagnóstico principal (`codDiagnosticoPrincipal`) empiece por Z34 o Z35** — así se capturan todos los controles reales, estén o no ligados a un parto en los RIPS cargados:
- **Z34x** — supervisión de embarazo normal (ej. Z340 primer embarazo, Z348 otros embarazos normales).
- **Z35x** — supervisión de embarazo de alto riesgo (ej. Z359).
- La tabla ahora también muestra los **códigos de diagnóstico** detectados para cada paciente.
- Probado con datos de ejemplo: cuenta correctamente los controles (Z340, Z348×2, Z359) y excluye una consulta con diagnóstico no relacionado (J00, gripa común).
