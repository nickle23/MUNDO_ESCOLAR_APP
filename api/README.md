# API Node.js (SQL Server 2022)

## Instalación rápida

```powershell
cd api
npm install
Copy-Item .env.example .env
# Edita .env con tu usuario/clave SQL
npm run dev
```

Prueba: `http://localhost:3001/api/ping`

## Endpoints (compatibles con la PWA actual)

- `GET/POST /api?action=ping`
- `POST /api?action=login` `{ pin }`
- `POST /api?action=getRouteToday` `{ pin, fecha }`
- `POST /api?action=listRoutes` `{ pin, limit }`
- `POST /api?action=getRouteById` `{ pin, idRuta }`
- `POST /api?action=saveEntrega` `{ pin, ruta, entrega, ... }`
- `POST /api?action=finalizarRuta` `{ pin, ruta }`
- `POST /api?action=listDeudores` `{ pin }`
- `POST /api?action=cobrarDeudas` `{ pin, idCliente, cobroDeudas, cobroDeudasMetodos }`

También disponibles como rutas REST simples bajo `/api/*` (ver `src/index.js`).