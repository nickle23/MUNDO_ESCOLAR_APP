import { getPool, sql } from '../db.js';
import { requireAuth } from './auth.js';
import { toNum, round2, norm, toDateStr, todayISO } from '../utils.js';
import { getDebtsForClients } from './debts.js';

function mapEntrega(r) {
  return {
    idEntrega: String(r.ID_ENTREGA || ''),
    row: r.ROW_NUM,
    direccion: r.DIRECCION || '',
    cliente: r.CLIENTE || '',
    idCliente: String(r.ID_CLIENTE || ''),
    bo: r.BO || '', a1: r.A1 || '', a2: r.A2 || '', a3: r.A3 || '',
    totB: toNum(r.TOT_B), totMont: toNum(r.TOT_MONT),
    montoCobrar: toNum(r.MONTO_COBRAR || r.TOT_MONT),
    vend: r.VEND || '',
    observacion: r.OBSERVACION || '',
    efectivo: toNum(r.EFECTIVO), yape: toNum(r.YAPE), transferencia: toNum(r.TRANSFERENCIA),
    totalPagadoHoy: toNum(r.TOTAL_PAGADO_HOY),
    saldoEntregaHoy: toNum(r.SALDO_ENTREGA_HOY),
    deudaGeneradaHoy: toNum(r.DEUDA_GENERADA_HOY),
    venceDeuda: toDateStr(r.VENCE_DEUDA),
    cobroDeudaAnterior: toNum(r.COBRO_DEUDA_ANTERIOR),
    cobroDeudaEfectivo: toNum(r.COBRO_DEUDA_EFECTIVO),
    cobroDeudaYape: toNum(r.COBRO_DEUDA_YAPE),
    cobroDeudaTransferencia: toNum(r.COBRO_DEUDA_TRANSFERENCIA),
    detalleCobroDeuda: r.DETALLE_COBRO_DEUDA || '',
    estadoEntrega: String(r.ESTADO_ENTREGA || 'PENDIENTE').toUpperCase(),
    idDeudaGenerada: String(r.ID_DEUDA_GENERADA || ''),
    ultimaEdicion: r.ULTIMA_EDICION,
    editadoPor: r.EDITADO_POR || '',
  };
}

function calcTotales(entregas) {
  const t = { bultos:0,monto:0,efectivo:0,yape:0,transferencia:0,cobroDeudaEfectivo:0,cobroDeudaYape:0,cobroDeudaTransferencia:0 };
  for (const e of entregas) {
    t.bultos = round2(t.bultos + toNum(e.totB));
    t.monto = round2(t.monto + toNum(e.montoCobrar));
    t.efectivo = round2(t.efectivo + toNum(e.efectivo));
    t.yape = round2(t.yape + toNum(e.yape));
    t.transferencia = round2(t.transferencia + toNum(e.transferencia));
    t.cobroDeudaEfectivo = round2(t.cobroDeudaEfectivo + toNum(e.cobroDeudaEfectivo));
    t.cobroDeudaYape = round2(t.cobroDeudaYape + toNum(e.cobroDeudaYape));
    t.cobroDeudaTransferencia = round2(t.cobroDeudaTransferencia + toNum(e.cobroDeudaTransferencia));
  }
  t.recaudadoTotal = round2(t.efectivo+t.yape+t.transferencia+t.cobroDeudaEfectivo+t.cobroDeudaYape+t.cobroDeudaTransferencia);
  return t;
}

async function assertRouteAssigned(pool, route, user) {
  if (!route) throw new Error('Ruta no encontrada.');
  const estado = norm(route.ESTADO);
  if (estado === 'ANULADA') throw new Error('Ruta anulada.');
  const userId = String(user.id || '').trim();
  const routeUserId = String(route.ID_USUARIO || '').trim();
  const userConductor = norm(user.conductorHoja || user.nombre);
  const routeConductor = norm(route.CONDUCTOR);
  const matchUser = userId && routeUserId && userId === routeUserId;
  const matchCond = !routeUserId && userConductor && routeConductor === userConductor;
  if (!(matchUser || matchCond)) throw new Error('No autorizado: esta ruta no está asignada a tu usuario.');
}

async function getRoutePayloadByRow(pool, routeRow, user) {
  const er = await pool.request().input('idRuta', sql.NVarChar(100), routeRow.ID_RUTA)
    .query(`SELECT * FROM dbo.ENTREGAS WHERE ID_RUTA=@idRuta ORDER BY ISNULL(ROW_NUM,999999), ID_ENTREGA`);
  const entregas = er.recordset.map(mapEntrega);
  const ids = [...new Set(entregas.map(e => e.idCliente).filter(Boolean))];
  const deudasPorCliente = ids.length ? await getDebtsForClients(pool, ids) : {};
  return {
    ok: true,
    usuario: user,
    ruta: {
      idRuta: String(routeRow.ID_RUTA), fecha: toDateStr(routeRow.FECHA), conductor: routeRow.CONDUCTOR || '',
      idUsuario: String(routeRow.ID_USUARIO || ''), spreadsheetId: routeRow.SPREADSHEET_ID || '',
      spreadsheetUrl: routeRow.SPREADSHEET_URL || '', hoja: routeRow.HOJA || '', estado: String(routeRow.ESTADO || ''),
    },
    entregas,
    deudasPorCliente,
    totales: calcTotales(entregas),
  };
}

export async function getRouteToday(params) {
  const user = await requireAuth(params);
  const fecha = toDateStr(params.fecha) || todayISO();
  const pool = await getPool();
  const rr = await pool.request()
    .input('fecha', sql.Date, fecha)
    .input('idUsuario', sql.NVarChar(50), user.id)
    .input('conductor', sql.NVarChar(150), user.conductorHoja || user.nombre || '')
    .query(`
      SELECT TOP 1 * FROM dbo.INDICE_RUTAS
      WHERE FECHA = @fecha AND UPPER(ESTADO) <> 'ANULADA'
        AND (
          (ID_USUARIO IS NOT NULL AND LTRIM(RTRIM(ID_USUARIO)) <> '' AND ID_USUARIO = @idUsuario)
          OR ((ID_USUARIO IS NULL OR LTRIM(RTRIM(ID_USUARIO)) = '') AND UPPER(LTRIM(RTRIM(CONDUCTOR))) = UPPER(LTRIM(RTRIM(@conductor))))
        )
      ORDER BY CREADO_EN DESC
    `);
  const route = rr.recordset[0];
  if (!route) return { ok: false, error: `No tienes una ruta asignada para ${fecha}.` };
  await assertRouteAssigned(pool, route, user);
  return getRoutePayloadByRow(pool, route, user);
}

export async function listRoutes(params) {
  const user = await requireAuth(params);
  const limit = Math.max(1, Math.min(30, Number(params.limit || 15)));
  const pool = await getPool();
  const rr = await pool.request()
    .input('idUsuario', sql.NVarChar(50), user.id)
    .input('conductor', sql.NVarChar(150), user.conductorHoja || user.nombre || '')
    .input('limit', sql.Int, limit)
    .query(`
      SELECT TOP (@limit) ID_RUTA, FECHA, CONDUCTOR, ID_USUARIO, HOJA, ESTADO
      FROM dbo.INDICE_RUTAS
      WHERE UPPER(ESTADO) <> 'ANULADA' AND (
        (ID_USUARIO IS NOT NULL AND LTRIM(RTRIM(ID_USUARIO)) <> '' AND ID_USUARIO=@idUsuario)
        OR ((ID_USUARIO IS NULL OR LTRIM(RTRIM(ID_USUARIO))='') AND UPPER(LTRIM(RTRIM(CONDUCTOR)))=UPPER(LTRIM(RTRIM(@conductor))))
      )
      ORDER BY FECHA DESC, CREADO_EN DESC
    `);
  return { ok: true, rutas: rr.recordset.map(r => ({ idRuta: r.ID_RUTA, fecha: toDateStr(r.FECHA), conductor: r.CONDUCTOR, idUsuario: r.ID_USUARIO, hoja: r.HOJA, estado: r.ESTADO })) };
}

export async function getRouteById(params) {
  const user = await requireAuth(params);
  const idRuta = String(params.idRuta || params.ruta?.idRuta || '').trim();
  if (!idRuta) throw new Error('Falta idRuta.');
  const pool = await getPool();
  const rr = await pool.request().input('idRuta', sql.NVarChar(100), idRuta).query(`SELECT TOP 1 * FROM dbo.INDICE_RUTAS WHERE ID_RUTA=@idRuta`);
  const route = rr.recordset[0];
  if (!route) throw new Error('Ruta no encontrada en INDICE_RUTAS.');
  await assertRouteAssigned(pool, route, user);
  return getRoutePayloadByRow(pool, route, user);
}