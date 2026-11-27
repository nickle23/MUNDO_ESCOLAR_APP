# Migración a SQL Server 2022 + Node.js (local, con failover manual)

Esta guía migra el sistema actual (GitHub Pages + Google Apps Script + Google Sheets) a:

- **BD:** SQL Server 2022 Express (local)
- **API:** Node.js (Express)
- **Frontend:** PWA actual (GitHub Pages)
- **Acceso desde calle:** HTTPS mediante túnel (Cloudflare Tunnel recomendado)
- **Respaldo:** PC almacén como primario, laptop como secundario con backups automáticos y failover manual

> **Importante:** no expongas SQL Server a internet. Solo se expone la API Node.js por HTTPS.

## 1. Instalar SQL Server 2022 Express (PC principal y laptop)

1. Descarga **SQL Server 2022 Express** desde Microsoft: https://www.microsoft.com/es-es/sql-server/sql-server-downloads
2. Ejecuta el instalador y elige **Básica** (o Personalizada si quieres controlar ruta).
3. Acepta licencia y espera la instalación.
4. Al finalizar, anota el nombre de instancia. Normalmente:
   - `localhost\SQLEXPRESS`
5. Instala **SQL Server Management Studio (SSMS)**: https://aka.ms/ssmsfullsetup
   - SSMS sirve para ver tablas, ejecutar SQL, respaldar/restaurar (similar a ver Sheets, pero en SQL).

## 2. Configurar SQL Server para la API local

1. Abre **SQL Server Configuration Manager**.
2. Ve a **SQL Server Network Configuration > Protocols for SQLEXPRESS**.
3. Habilita **TCP/IP**.
4. Doble clic en TCP/IP > pestaña **IP Addresses**:
   - En **IPAll**, deja **TCP Dynamic Ports** en blanco y pon **TCP Port = 1433** (o usa dinámico; para local, 1433 es simple).
5. Reinicia el servicio **SQL Server (SQLEXPRESS)**.
6. Abre **SQL Server Configuration Manager > SQL Server Services** y verifica que **SQL Server Browser** esté en ejecución (útil para instancias nombradas). Si usas 1433 fijo, no es crítico.

### Habilitar autenticación SQL (recomendado para la app)
1. Abre SSMS y conéctate a `localhost\SQLEXPRESS` (Windows Authentication).
2. Clic derecho en el servidor > **Properties > Security**.
3. Selecciona **SQL Server and Windows Authentication mode**.
4. Acepta y reinicia el servicio SQL Server.
5. Crea un login para la app (en SSMS, New Query):

```sql
CREATE LOGIN mundo_escolar_app WITH PASSWORD = 'CambiaEstaClaveSegura123!';
GO
```

> Cambia la clave por una segura. No la subas a GitHub.

## 3. Crear la base de datos y tablas

1. En SSMS, abre `sql/schema.sql` de este proyecto.
2. Ejecútalo completo. Crea la BD `MUNDO_ESCOLAR` y tablas.
3. Abre `sql/seed.sql` y ajústalo (usuarios, PINs, config). Ejecútalo.
4. Verifica tablas: `USUARIOS, CLIENTES, INDICE_RUTAS, ENTREGAS, DEUDAS, MOVIMIENTOS, CONFIG`.

## 4. Instalar Node.js

1. Descarga **Node.js LTS** (20.x o 22.x LTS recomendado): https://nodejs.org/
2. Instala con opciones por defecto (incluye npm).
3. Verifica en PowerShell:

```powershell
node -v
npm -v
```

## 5. Configurar y ejecutar la API

1. Abre PowerShell en `MUNDO_ESCOLAR_APP\api`.
2. Instala dependencias:

```powershell
npm install
```

3. Copia `.env.example` a `.env` y edita valores:

```env
PORT=3001
DB_SERVER=localhost\SQLEXPRESS
DB_PORT=1433
DB_USER=mundo_escolar_app
DB_PASSWORD=CambiaEstaClaveSegura123!
DB_NAME=MUNDO_ESCOLAR
DB_ENCRYPT=false
DB_TRUST_SERVER_CERT=true
CORS_ORIGIN=*
TZ=America/Lima
```

4. Inicia la API:

```powershell
npm run dev
```

5. Prueba: abre `http://localhost:3001/api/ping` debe responder JSON `{ ok: true, ... }`.

## 6. Apuntar el frontend actual a la nueva API

En `js/config.js` (y/o `web/js/config.js` según despliegue):

```js
window.APP_CONFIG = {
  API_URL: "http://localhost:3001/api", // local; en producción usar URL del túnel HTTPS
  DEFAULT_DATE: "today",
  REQUEST_MODE: "auto"
};
```

Para pruebas locales abre el frontend con un servidor estático (no `file://`):

```powershell
cd C:\Users\nix_n\OneDrive\Escritorio\MUNDO_ESCOLAR_APP
npx serve .
```

## 7. Acceso desde la calle (repartidores con datos móviles)

La PC local no es accesible desde internet por defecto. Usa un túnel HTTPS:

### Opción recomendada: Cloudflare Tunnel (gratuito)
1. Crea cuenta en Cloudflare y agrega un dominio (o usa subdominio gestionado si aplica).
2. Instala `cloudflared` en Windows.
3. Autentica y crea túnel apuntando a `http://localhost:3001`.
4. Obtendrás una URL HTTPS, ej. `https://api-mundoescolar.tudominio.com`.
5. Configura `API_URL` del frontend a esa URL.
6. **Solo se expone la API**, no SQL Server.

> Alternativa rápida para pruebas: ngrok. Para operación, mejor túnel estable con dominio propio.

## 8. Failover manual (PC almacén primario / laptop respaldo)

### Estrategia segura
- **Un primario a la vez**. No escribir en ambas BDs simultáneamente.
- Backups automáticos del primario a carpeta compartida/OneDrive/disco replicado en laptop.

### Backup automático (SQL Server Express no trae SQL Agent completo)
Crear script `scripts/backup_db.ps1` y programar con **Programador de tareas de Windows** cada 10-15 min:

```powershell
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = "C:\Backups\MUNDO_ESCOLAR_$timestamp.bak"
sqlcmd -S "localhost\SQLEXPRESS" -Q "BACKUP DATABASE [MUNDO_ESCOLAR] TO DISK=N'$backupFile' WITH INIT, COMPRESSION, STATS=10"
# Copiar a laptop/carpeta sincronizada
Copy-Item $backupFile "\\LAPTOP\Backups\MUNDO_ESCOLAR\" -ErrorAction SilentlyContinue
```

### Procedimiento de failover
1. Detecta caída del primario.
2. En laptop: restaura último `.bak` en SQL Server.
3. Inicia API Node.js (`npm run start`).
4. Inicia túnel Cloudflare en laptop con el mismo hostname (o cambia DNS/URL de API).
5. Verifica `/api/ping` y login.
6. Cuando vuelva el primario, **no reactivar sin sincronizar**: decide cuál tiene los datos más recientes, respalda, restaura en primario y vuelve a hacerlo primario.

## 9. Migración de datos desde Sheets

1. Exporta hojas del Maestro a CSV/XLSX: `USUARIOS, CLIENTES, INDICE_RUTAS, DEUDAS, MOVIMIENTOS`.
2. Exporta entregas de rutas (o usa script).
3. Usa `sql/import_template.sql` / script Node de importación (a crear en `scripts/`).
4. Valida conteos y saldos.

## 10. Checklist de puesta en marcha

- [ ] SQL Server 2022 Express instalado en PC almacén y laptop
- [ ] SSMS instalado
- [ ] BD `MUNDO_ESCOLAR` creada con `schema.sql`
- [ ] Usuario SQL creado y `.env` configurado
- [ ] Node.js instalado, `npm install` ok
- [ ] `/api/ping` responde OK
- [ ] Frontend apunta a API local y funciona login/ruta
- [ ] Túnel HTTPS configurado para acceso desde calle
- [ ] Backups automáticos programados
- [ ] Procedimiento de failover probado
- [ ] Datos migrados desde Sheets validados

## 11. Estructura en este repo

```text
api/                  # Backend Node.js + Express + mssql
  src/
    index.js
    db.js
    routes/
    services/
  .env.example
  package.json
sql/
  schema.sql          # Esquema SQL Server
  seed.sql            # Datos iniciales/ejemplo
docs/
  MIGRACION_SQLSERVER.md
```