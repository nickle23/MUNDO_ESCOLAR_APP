import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ok, fail } from './utils.js';
import { requireAuth } from './services/auth.js';
import { getRouteToday, listRoutes, getRouteById } from './services/routes.js';
import { saveEntrega, finalizarRuta } from './services/saveEntrega.js';
import { getClientDebts, listDeudores, cobrarDeudas } from './services/debts.js';

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*'}));
// Acepta JSON aunque venga como text/plain (el frontend lo envía así para evitar preflight)
app.use(express.json({ limit: '2mb', type: ['application/json', 'text/plain'] }));
app.use(express.urlencoded({ extended: true }));

function tryParseJson(v) {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (!s) return v;
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try { return JSON.parse(s); } catch { return v; }
  }
  return v;
}

function mergeParams(req) {
  let body = req.body;
  if (typeof body === 'string') body = tryParseJson(body);
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
  const merged = { ...req.query, ...body };
  for (const k of Object.keys(merged)) merged[k] = tryParseJson(merged[k]);
  return merged;
}

async function dispatch(action, params) {
  switch (String(action || '').trim()) {
    case 'ping': return ok({ service: 'mundo-escolar-sql-api', time: new Date().toISOString() });
    case 'login': return ok({ usuario: await requireAuth(params) });
    case 'getRouteToday': return await getRouteToday(params);
    case 'listRoutes': return await listRoutes(params);
    case 'getRouteById': return await getRouteById(params);
    case 'saveEntrega': return await saveEntrega(params);
    case 'finalizarRuta': return await finalizarRuta(params);
    case 'getClientDebts': return await getClientDebts(params);
    case 'listDeudores': return await listDeudores(params);
    case 'cobrarDeudas': return await cobrarDeudas(params);
    default: throw new Error('Acción no soportada: ' + action);
  }
}

app.all('/api', async (req, res) => {
  try {
    const params = mergeParams(req);
    const action = params.action;
    if (!action) return res.status(400).json(fail('Acción no especificada.'));
    const result = await dispatch(action, params);
    res.json(result);
  } catch (e) {
    console.error('[api]', e);
    res.status(200).json(fail(e)); // 200 para compatibilidad con frontend actual que lee JSON ok:false
  }
});

app.get('/api/ping', async (_req, res) => res.json(await dispatch('ping', {})));

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`Mundo Escolar API escuchando en http://localhost:${port}`);
  console.log(`Ping: http://localhost:${port}/api/ping`);
});