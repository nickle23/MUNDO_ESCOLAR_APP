# Configuración y despliegue (0 inversión)

Guía para poner en marcha la app con **Google Sheets + Google Apps Script + GitHub Pages**.

## Requisitos

- Cuenta de Google (para Sheets, Drive y Apps Script).
- Cuenta de GitHub (para el repositorio y GitHub Pages).
- VS Code / OpenCode para editar este proyecto.

## 1. Crear el Google Sheet MAESTRO (desde 0)

1. Crea un nuevo Google Spreadsheet y nómbralo, por ejemplo, `MUNDO_ESCOLAR_MAESTRO`.
2. Copia el **ID del spreadsheet** (parte de la URL: `https://docs.google.com/spreadsheets/d/<ID>/edit`).
3. Crea un proyecto de **Apps Script** vinculado o independiente:
   - Opción rápida: en el spreadsheet ve a **Extensiones > Apps Script**.
4. Copia los archivos de la carpeta `gas/` de este repositorio al editor de Apps Script:
   - `Code.gs`, `Setup.gs`, `Routes.gs`, `Debts.gs`, `Utils.gs`, `appsscript.json` (en configuración del proyecto activa el manifiesto si es necesario).
5. En `gas/Setup.gs` (o en Propiedades del script), configura `MASTER_ID` si el script no está vinculado; si está vinculado al maestro puede detectarlo con `SpreadsheetApp.getActive()`.
6. Ejecuta la función **`setupMaster()`** desde el editor de Apps Script (autoriza permisos cuando lo solicite). Esto creará/estructurará las hojas:
   - `CONFIG`, `USUARIOS`, `CLIENTES`, `INDICE_RUTAS`, `DEUDAS`, `MOVIMIENTOS` con sus encabezados.
7. Completa datos iniciales en el Maestro:
   - `USUARIOS`: registra repartidores con `ID_USUARIO`, `NOMBRE`, `CONDUCTOR_HOJA` (tal como aparece en B2 de la ruta, ej. `JONATAN`), `PIN`, `ACTIVO=SI`, `ROL=REPARTIDOR`, `PUEDE_COBRAR_DEUDAS=NO` (cámbialo a `SI` solo cuando autorices).
   - `CLIENTES`: registra clientes y asigna `ID_CLIENTE` único a cada uno.
   - `CONFIG`: define `RUTAS_FOLDER_ID` (ID de la carpeta de Drive donde estarán los archivos de rutas), `TIMEZONE` = `America/Lima`.

> Consejo: mantén un respaldo del Maestro. Contiene las deudas y el historial.

## 2. Crear archivos y hojas de RUTA DIARIA (desde 0)

Las rutas siguen el formato operativo (similar al ejemplo enviado) y se crean 1–2 por día. Por el límite de hojas de Sheets, cuando un archivo se llene se crea un nuevo archivo de rutas y se sigue registrando en el índice.

### 2.1 Carpeta de rutas
1. En Google Drive, crea una carpeta (ej. `RUTAS_MUNDO_ESCOLAR`) y guarda su ID en `CONFIG.RUTAS_FOLDER_ID`.

### 2.2 Crear una hoja de ruta
Puedes hacerlo manualmente o con la función de Apps Script **`createRouteSheet` / `crearHojaRuta`** (según implementación en `gas/Routes.gs`):

- Crea un spreadsheet de rutas (ej. `RUTAS_2026_11`) o reutiliza uno con espacio.
- Agrega una pestaña para la ruta del día (ej. `VIERNES_2011`).
- Estructura:
  - Fila 1: `RUTA DISTRIBUIDORA MUNDO ESCOLAR SAC`
  - Fila 2: `CONDUCTOR:` (A2), nombre del conductor (B2), fecha (L2)
  - Fila 3: encabezados
  - Columnas A-L (operativas): `DIRECCION, CLIENTE, B.O. / S/., A1 / S/., A2 / S/., A3 / S/., TOT. B., TOT. MONT., VEND., EFECT, YAP/TRNSF, OBSERVACION`
  - Columnas M en adelante (sistema): `ID_CLIENTE, ID_ENTREGA, MONTO_COBRAR, EFECTIVO, YAPE, TRANSFERENCIA, TOTAL_PAGADO_HOY, SALDO_ENTREGA_HOY, DEUDA_GENERADA_HOY, VENCE_DEUDA, COBRO_DEUDA_ANTERIOR, COBRO_DEUDA_EFECTIVO, COBRO_DEUDA_YAPE, COBRO_DEUDA_TRANSFERENCIA, DETALLE_COBRO_DEUDA, ESTADO_ENTREGA, ULTIMA_EDICION, EDITADO_POR, ID_DEUDA_GENERADA`
- Completa las filas con las entregas del día e incluye `ID_CLIENTE` y un `ID_ENTREGA` único por fila.

### 2.3 Registrar/indexar la ruta (importación automática)
Para que la app encuentre la ruta del día:
- Registra la ruta en `INDICE_RUTAS` (fecha, conductor, spreadsheet_id, hoja, estado `ABIERTA`), o
- Ejecuta la función **`indexRoutes()` / `indexarRutas()`** que escanea la carpeta de rutas y registra pestañas que tengan el formato esperado y no estén indexadas.

La app busca en `INDICE_RUTAS` por fecha y conductor y carga solo esa ruta.

## 3. Desplegar Google Apps Script (API)

1. Abre el proyecto de Apps Script que contiene el código de `gas/`.
2. Verifica que tenga acceso a los Spreadsheets/Drive necesarios (misma cuenta).
3. Haz clic en **Implementar > Nueva implementación**.
4. Tipo: **Aplicación web**.
5. Configuración recomendada:
   - **Ejecutar como:** Yo (tu cuenta, propietaria de las hojas).
   - **Quién tiene acceso:** Cualquier persona (o "Cualquier persona con cuenta de Google" si prefieres restringir; la app usa PIN a nivel de aplicación).
6. Copia la **URL de la aplicación web** (termina en `/exec`).
7. Cada vez que modifiques el código, crea una **nueva versión** de la implementación para que los cambios se apliquen.

> **Nota CORS/GitHub Pages:** al llamar a Apps Script desde un frontend alojado en otro dominio, el navegador puede aplicar políticas CORS. El cliente en `web/js/api.js` está preparado para enviar solicitudes compatibles; si tu navegador bloquea la respuesta, considera: (a) usar la app también como Web App servida por Apps Script (HtmlService), o (b) ajustar el método de solicitud según la configuración de tu despliegue. La API soporta parámetros por query/POST para facilitar la integración.

## 4. Configurar y publicar el Frontend en GitHub Pages

1. En `web/js/config.js` configura:
   - `API_URL`: URL `/exec` de tu Apps Script Web App.
   - `APP_NAME`, zona horaria/opciones si aplica.
2. Sube este repositorio a GitHub.
3. En GitHub: **Settings > Pages**.
   - Source: rama principal (ej. `main`).
   - Folder: selecciona `/web` (o `/docs` si reubicas; por defecto este proyecto usa `/web` como raíz del sitio estático). Si GitHub Pages solo permite `/ (root)` o `/docs`, mueve/copia el contenido de `web/` a la carpeta permitida o configura en consecuencia.
4. Abre la URL publicada en el celular del repartidor y (opcional) "Agregar a pantalla de inicio" para usarla como app.

## 5. Flujo de uso

1. **Repartidor** inicia sesión con su PIN/código.
2. La app consulta `INDICE_RUTAS` y carga la **ruta del día** del conductor (solo si está asignada a él).
3. Por cada entrega, el repartidor registra:
   - Pago de hoy: montos en **Efectivo/Yape/Transferencia** (mixtos).
   - Si falta dinero: **genera deuda** indicando **monto** y **fecha de vencimiento personalizada**.
   - Si el cliente tiene deudas previas: muestra pendientes y permite **cobrar/abonar** (con desglose) **solo si `PUEDE_COBRAR_DEUDAS=SI`**.
   - **Observaciones**.
4. Al presionar **Finalizar ruta**, la ruta pasa a `FINALIZADA` y ya no se pueden modificar cobros de entregas.
5. Queda disponible la opción **Deudores** para consultar la lista de clientes con deuda; el reparto solo puede cobrar si tú lo autorizas (`PUEDE_COBRAR_DEUDAS=SI`).
6. Al guardar cobros, Apps Script actualiza la **hoja de ruta** y/o el **Maestro** (`DEUDAS`, `MOVIMIENTOS`, saldos).
7. Para ver cambios hechos en oficina, el repartidor usa **Actualizar** (lectura desde Sheets).

## 6. Rotación de archivos (límite de hojas)

- Crea un nuevo spreadsheet de rutas cuando el actual se acerque al límite.
- Registra las nuevas hojas en `INDICE_RUTAS` (manual o con `indexarRutas`).
- No muevas el historial: `DEUDAS` y `MOVIMIENTOS` permanecen en el **Maestro**.

## 7. Recomendaciones de operación

- Usa siempre `ID_CLIENTE` e `ID_ENTREGA` estables.
- No borres filas de deudas/movimientos; corrige mediante ajustes/estados.
- Restringe el acceso al Maestro y a la carpeta de rutas a personal autorizado.
- Prueba primero con una ruta de ejemplo antes de operar en producción.