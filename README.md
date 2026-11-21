# Mundo Escolar - App de Rutas y Cobranza

Aplicación web móvil (PWA) para repartidores de **Distribuidora Mundo Escolar SAC** que permite:

- Ver **solo la ruta del día** asignada a cada repartidor.
- Registrar pagos **mixtos** por entrega: **Efectivo, Yape y Transferencia** (combinables).
- Registrar **nuevos créditos/deudas** cuando el pago es parcial, con **fecha de vencimiento personalizada**.
- **Cobrar deudas anteriores** del cliente (abono parcial o total, con desglose de método).
- Registrar **observaciones** y **corregir/editar** lo registrado.
- **Sincronización bidireccional** con Google Sheets (la app lee y escribe la hoja).

## Stack (0 inversión)

- **Frontend:** HTML/CSS/JS estático (mobile-first) pensado para **GitHub Pages** (`/web`).
- **Backend/API:** **Google Apps Script** (Web App) con acceso a Google Sheets y Google Drive.
- **Base de datos:** **Google Sheets** creado desde 0 (archivo **Maestro** + archivos/hojas de **Rutas diarias**).
- **Desarrollo:** OpenCode y VS Code. Python disponible en el entorno como apoyo local opcional.

> GitHub Pages es 100% estático: no ejecuta Python ni almacena credenciales. Toda la lectura/escritura de Sheets se hace mediante Google Apps Script.

## Estructura del repositorio

- `web/` — Frontend estático (PWA) para el repartidor.
- `gas/` — Código de Google Apps Script (API, creación del maestro, indexación de rutas, gestión de deudas).
- `docs/` — Documentación:
  - [`docs/SETUP.md`](docs/SETUP.md) — configuración y despliegue paso a paso.
  - [`docs/SCHEMA.md`](docs/SCHEMA.md) — esquema de datos (maestro, deudas, índice de rutas y formato de ruta diaria).
- `scripts/` — Utilidades de desarrollo (opcional).

## Capacidades incluidas

- **ID de cliente** (`ID_CLIENTE`) para trazabilidad y control de cuentas.
- **Hoja de deudas organizada** (`DEUDAS`) con saldo, vencimiento personalizado y estado.
- **Movimientos/abonos** (`MOVIMIENTOS`) para pagos de entregas y cobros de deudas anteriores.
- **Índice de rutas** (`INDICE_RUTAS`) para importación automática y soporte a rotación de archivos cuando se alcanza el límite de hojas en Sheets.
- **Identificación estable de entregas** (`ID_ENTREGA`) para sincronización y correcciones seguras.
- **Separación de datos persistentes (maestro)** y **operación diaria (rutas)**, compatible con la creación de 1–2 hojas de ruta al día.

## Cómo empezar

1. Lee [`docs/SCHEMA.md`](docs/SCHEMA.md) para entender la estructura.
2. Sigue [`docs/SETUP.md`](docs/SETUP.md) para:
   - Crear el **Google Sheet Maestro** desde 0.
   - Crear/configurar la carpeta y archivos de **Rutas diarias**.
   - Desplegar el **Google Apps Script** como Web App.
   - Configurar y publicar el **frontend** en GitHub Pages.
3. Ajusta `web/js/config.js` con la URL de tu Web App de Apps Script.

## Notas

- No subas credenciales ni IDs sensibles innecesarios a repositorios públicos.
- El control de deudas se centraliza en el Maestro para que no se pierda al rotar archivos de rutas.
- La app está diseñada para uso móvil en ruta y para que cada repartidor vea únicamente su ruta del día.