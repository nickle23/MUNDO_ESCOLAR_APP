# Esquema de datos - Mundo Escolar

Este documento define la estructura recomendada para trabajar con **Google Sheets + Google Apps Script** (0 inversión), soportando:

- Rutas diarias (1–2 hojas por día), creadas desde 0 con el formato de tu operación.
- ID de cliente y control de cuentas por cobrar (deudas) organizado y persistente.
- Pagos mixtos (Efectivo, Yape, Transferencia), nuevos créditos con vencimiento personalizado y cobro de deudas anteriores.
- Sincronización bidireccional y correcciones.
- Rotación de archivos cuando se alcanza el límite de hojas en un spreadsheet.

## 1. Visión general

Se usan dos capas:

1. **MAESTRO** (un solo Spreadsheet, permanente): clientes, usuarios/repartidores, índice de rutas, deudas y movimientos.
2. **RUTAS** (uno o más Spreadsheets, rotables): hojas diarias con el detalle de entregas del día. La app lee/escribe aquí la operación del día y registra efectos persistentes (deudas/abonos) en el Maestro.

> Motivo: las deudas y saldos no pueden depender de archivos de rutas que se archivan o rotan por límites de Sheets.

## 2. Spreadsheet MAESTRO

Nombre sugerido: `MUNDO_ESCOLAR_MAESTRO`

### 2.1 Hoja `CONFIG`
Configuración clave-valor del sistema.

| Columna | Descripción | Ejemplo |
|---|---|---|
| A `CLAVE` | Nombre de la configuración | `RUTAS_FOLDER_ID` |
| B `VALOR` | Valor | `1AbC...` |
| C `DESCRIPCION` | Nota | `Carpeta de Drive donde se guardan rutas` |

Claves sugeridas:
- `TIMEZONE` = `America/Lima`
- `RUTAS_FOLDER_ID` = ID de carpeta Drive de rutas
- `MASTER_ID` = ID del spreadsheet maestro
- `ADMIN_PIN` (opcional, si se usan acciones admin desde API)

### 2.2 Hoja `USUARIOS`
Repartidores/usuarios que usan la app (asignación automática por conductor).

| Columna | Campo | Descripción |
|---|---|---|
| A | `ID_USUARIO` | ID único (ej. `USR001`) |
| B | `NOMBRE` | Nombre visible |
| C | `CONDUCTOR_HOJA` | Valor que aparece en B2 de la hoja de ruta (ej. `JONATAN`, `NIXON`) para emparejar automáticamente |
| D | `PIN` | Código/PIN de acceso (simple, 0 inversión) |
| E | `ACTIVO` | `SI` / `NO` |
| F | `ROL` | `REPARTIDOR` / `ADMIN` |
| G | `NOTAS` | Observaciones |
| H | `PUEDE_COBRAR_DEUDAS` | `SI` / `NO`. Controla si el repartidor puede **cobrar deudas** (solo cuando tú lo autorices). |

### 2.3 Hoja `CLIENTES`
Catálogo de clientes con identificador único.

| Columna | Campo | Descripción |
|---|---|---|
| A | `ID_CLIENTE` | ID único estable (ej. `CLI0001`) |
| B | `NOMBRE` | Nombre del cliente (como se usa en rutas) |
| C | `DIRECCION` | Dirección/referencia principal |
| D | `ZONA` | Zona/sector |
| E | `TELEFONO` | Teléfono/WhatsApp |
| F | `ACTIVO` | `SI` / `NO` |
| G | `SALDO_PENDIENTE` | Saldo total calculado/actualizado (cache de deudas pendientes) |
| H | `FECHA_ALTA` | Fecha de creación |
| I | `NOTAS` | Notas |

> `ID_CLIENTE` debe copiarse/referenciarse en las filas de ruta (`ID_CLIENTE`) para vincular pagos y deudas correctamente.

### 2.4 Hoja `INDICE_RUTAS`
Permite localizar la ruta del día automáticamente y soportar múltiples archivos (rotación por límite).

| Columna | Campo | Descripción |
|---|---|---|
| A | `ID_RUTA` | ID único de la ruta (ej. `RUTA_20260716_JONATAN_1`) |
| B | `FECHA` | Fecha de la ruta (`YYYY-MM-DD`) |
| C | `CONDUCTOR` | Conductor asignado (debe coincidir con hoja/usuario) |
| D | `ID_USUARIO` | ID de usuario repartidor (opcional pero recomendado) |
| E | `SPREADSHEET_ID` | ID del archivo de rutas donde está la hoja |
| F | `SPREADSHEET_URL` | URL del archivo |
| G | `HOJA` | Nombre de la pestaña de la ruta (ej. `JUEVES 16`) |
| H | `ESTADO` | `ABIERTA` / `FINALIZADA` / `CERRADA` / `ANULADA` |
| I | `TOTAL_ENTREGAS` | Conteo (opcional) |
| J | `CREADO_EN` | Timestamp |
| K | `ACTUALIZADO_EN` | Timestamp |

La app consulta por `FECHA` + `CONDUCTOR/ID_USUARIO` y obtiene la hoja a leer/escribir.

### 2.5 Hoja `DEUDAS` (cuentas por cobrar, organizada)
Registro maestro de créditos/deudas. **Persistente** aunque se roten archivos de rutas.

| Columna | Campo | Descripción |
|---|---|---|
| A | `ID_DEUDA` | ID único (ej. `DEU000001`) |
| B | `ID_CLIENTE` | Cliente deudor |
| C | `CLIENTE_NOMBRE` | Nombre (desnormalizado para lectura rápida) |
| D | `FECHA_ORIGEN` | Fecha en que se generó la deuda |
| E | `ID_RUTA_ORIGEN` | Ruta donde se originó |
| F | `ID_ENTREGA_ORIGEN` | Entrega/fila origen |
| G | `MONTO_ORIGINAL` | Monto original de la deuda |
| H | `SALDO_PENDIENTE` | Saldo actual |
| I | `FECHA_VENCIMIENTO` | **Vencimiento personalizado** |
| J | `ESTADO` | `PENDIENTE` / `PARCIAL` / `PAGADA` / `ANULADA` |
| K | `OBSERVACION` | Nota |
| L | `CREADO_POR` | Usuario que registró |
| M | `CREADO_EN` | Timestamp |
| N | `ACTUALIZADO_EN` | Timestamp |

### 2.6 Hoja `MOVIMIENTOS`
Historial de pagos y cobros (auditoría y control).

| Columna | Campo | Descripción |
|---|---|---|
| A | `ID_MOVIMIENTO` | ID único |
| B | `FECHA_HORA` | Timestamp del registro |
| C | `TIPO` | `PAGO_ENTREGA` / `COBRO_DEUDA` / `AJUSTE` |
| D | `ID_CLIENTE` | Cliente |
| E | `CLIENTE_NOMBRE` | Nombre |
| F | `ID_RUTA` | Ruta asociada |
| G | `ID_ENTREGA` | Entrega asociada |
| H | `ID_DEUDA` | Deuda afectada (si aplica; vacío si es solo pago de entrega sin deuda previa) |
| I | `MONTO_APLICADO` | Monto aplicado en este movimiento |
| J | `EFECTIVO` | Parte en efectivo |
| K | `YAPE` | Parte en Yape |
| L | `TRANSFERENCIA` | Parte en transferencia |
| M | `RESULTADO` | `PAGO_COMPLETO` / `PAGO_PARCIAL_GENERA_DEUDA` / `ABONO_DEUDA` / `CANCELA_DEUDA` / `AJUSTE` |
| N | `VENCIMIENTO_NUEVO` | Si se generó deuda, su vencimiento |
| O | `USUARIO` | Quién registró |
| P | `OBSERVACION` | Nota |

## 3. Spreadsheet/hojas de RUTA DIARIA

Nombre de archivo sugerido al crear uno nuevo: `RUTAS_YYYY_MM` (o el que prefieras). Dentro, cada pestaña es una ruta (1–2 por día, o según tu operación).

### 3.1 Formato base (compatible con tu hoja actual)

- **Fila 1:** Título, ej. `RUTA DISTRIBUIDORA MUNDO ESCOLAR SAC`
- **Fila 2:** `CONDUCTOR:` en A2, nombre en **B2**, fecha en **L2** (o celda de fecha definida).
- **Fila 3:** Encabezados de columnas.
- **Fila 4 en adelante:** Entregas/clientes. Filas vacías pueden existir al final.

**Columnas operativas (visibles, compatibles con impresión):**

| Col | Campo | Uso |
|---|---|---|
| A | `DIRECCION` | Zona/dirección |
| B | `CLIENTE` | Nombre del cliente |
| C | `B.O. / S/.` | Bultos/monto (formato actual) |
| D | `A1 / S/.` | Ítem/monto adicional |
| E | `A2 / S/.` | Ítem/monto adicional |
| F | `A3 / S/.` | Ítem/monto adicional |
| G | `TOT. B.` | Total bultos |
| H | `TOT. MONT.` | **Monto a cobrar** de la entrega |
| I | `VEND.` | Vendedor |
| J | `EFECT` | Resumen/registro efectivo (la app puede escribir total efectivo aquí) |
| K | `YAP/TRNSF` | Resumen Yape/Transferencia (la app puede escribir resumen aquí) |
| L | `OBSERVACION` | Observaciones |

### 3.2 Columnas del sistema (recomendadas, a la derecha; pueden ocultarse al imprimir)

Estas columnas permiten pagos mixtos, crédito con vencimiento, cobro de deudas previas y sincronización/correcciones seguras.

| Col | Campo | Descripción |
|---|---|---|
| M | `ID_CLIENTE` | **ID único del cliente** (vincula con Maestro) |
| N | `ID_ENTREGA` | ID único y estable de la fila/entrega (no cambia si se reordena; clave de sync) |
| O | `MONTO_COBRAR` | Monto a cobrar numérico (copia/parseo de H para cálculo) |
| P | `EFECTIVO` | Monto pagado en efectivo (hoy) |
| Q | `YAPE` | Monto pagado por Yape (hoy) |
| R | `TRANSFERENCIA` | Monto pagado por transferencia (hoy) |
| S | `TOTAL_PAGADO_HOY` | Suma de P+Q+R |
| T | `SALDO_ENTREGA_HOY` | `MONTO_COBRAR - TOTAL_PAGADO_HOY` (si > 0, genera deuda) |
| U | `DEUDA_GENERADA_HOY` | Monto enviado a cuentas por cobrar (normalmente = T cuando aplica) |
| V | `VENCE_DEUDA` | **Fecha de vencimiento personalizada** de la deuda generada |
| W | `COBRO_DEUDA_ANTERIOR` | Total cobrado hoy por deudas anteriores del cliente |
| X | `COBRO_DEUDA_EFECTIVO` | Desglose cobro deuda anterior - efectivo |
| Y | `COBRO_DEUDA_YAPE` | Desglose cobro deuda anterior - Yape |
| Z | `COBRO_DEUDA_TRANSFERENCIA` | Desglose cobro deuda anterior - transferencia |
| AA | `DETALLE_COBRO_DEUDA` | IDs/montos de deudas abonadas (texto o JSON) |
| AB | `ESTADO_ENTREGA` | `PENDIENTE` / `ENTREGADO` / `PAGADO` / `PARCIAL` / `CREDITO` / `NO_ENTREGADO` / `REPROGRAMADO` / `RECHAZADO` |
| AC | `ULTIMA_EDICION` | Timestamp de última modificación por app/usuario |
| AD | `EDITADO_POR` | Usuario que editó |
| AE | `ID_DEUDA_GENERADA` | ID de la deuda creada en Maestro (si aplica) |

> Puedes ajustar/ocultar columnas, pero mantener `ID_CLIENTE`, `ID_ENTREGA` y los campos de montos/vencimiento es clave para una sincronización y control de deudas confiables.

## 4. Reglas de negocio soportadas

- **Pago mixto:** una entrega puede pagarse con combinación de `EFECTIVO + YAPE + TRANSFERENCIA`.
- **Crédito/deuda nueva:** si `TOTAL_PAGADO_HOY < MONTO_COBRAR`, se puede registrar `DEUDA_GENERADA_HOY` con `VENCE_DEUDA` personalizada y crear/actualizar registro en `DEUDAS`.
- **Cobro de deudas anteriores:** en la misma visita se pueden abonar deudas pendientes del `ID_CLIENTE` (parcial o total), con desglose de método; se registran en `MOVIMIENTOS` y actualizan `DEUDAS.SALDO_PENDIENTE`/`ESTADO`.
- **Correcciones:** la app puede editar un registro; se debe recalcular saldos afectados y actualizar hoja de ruta + maestro, dejando traza en `ULTIMA_EDICION`/`MOVIMIENTOS` o nota de ajuste según implementación.
- **Asignación automática:** el repartidor ve solo rutas donde `INDICE_RUTAS.CONDUCTOR/ID_USUARIO` corresponde a su usuario y `FECHA` es la del día (o la seleccionada).
- **Rotación de archivos:** al llegar al límite de hojas, se crea un nuevo spreadsheet de rutas y se registran sus hojas en `INDICE_RUTAS` (el historial de deudas permanece en el Maestro).

## 5. Convenciones recomendadas

- Fechas en formato ISO `YYYY-MM-DD`; timestamps `YYYY-MM-DD HH:mm:ss` (zona `America/Lima`).
- Montos numéricos con punto decimal (sin símbolos de moneda en celdas numéricas del sistema).
- `ID_CLIENTE`, `ID_ENTREGA`, `ID_RUTA`, `ID_DEUDA`, `ID_MOVIMIENTO` únicos e inmutables.
- No eliminar filas históricas de `DEUDAS`/`MOVIMIENTOS`; usar estados (`ANULADA`, `AJUSTE`) para correcciones.