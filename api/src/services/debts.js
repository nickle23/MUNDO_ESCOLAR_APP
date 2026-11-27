import { getPool, sql } from '../db.js';
import { requireAuth } from './auth.js';
import { toNum, round2, toDateStr } from '../utils.js';

export async function getDebtsForClients(pool, ids) {
  const result = {};
  ids.forEach(id => { result[id] = { saldoTotal: 0, items: [] }; });
  if (!ids.length) return result;
  const req = pool.request();
  const params = ids.map((id, i) => { req.input(`id${i}`, sql.NVarChar(50), id); return `@id${i}`; });
  const q = await req.query(`
    SELECT ID_DEUDA, ID_CLIENTE, CLIENTE_NOMBRE, FECHA_ORIGEN, ID_RUTA_ORIGEN, ID_ENTREGA_ORIGEN,
           MONTO_ORIGINAL, SALDO_PENDIENTE, FECHA_VENCIMIENTO, ESTADO, OBSERVACION
    FROM dbo.DEUDAS
    WHERE ID_CLIENTE IN (${params.join(',')})
    ORDER BY FECHA_VENCIMIENTO ASC, CREADO_EN ASC
  `);
  for (const r of q.recordset) {
    const idCliente = String(r.ID_CLIENTE || '').trim();
    if (!result[idCliente]) continue;
    const saldo = round2(toNum(r.SALDO_PENDIENTE));
    const estado = String(r.ESTADO || '').toUpperCase();
    if (saldo <= 0.009 && estado === 'PAGADA') continue;
    const item = {
      idDeuda: String(r.ID_DEUDA), idCliente, clienteNombre: r.CLIENTE_NOMBRE || '',
      fechaOrigen: toDateStr(r.FECHA_ORIGEN), idRutaOrigen: r.ID_RUTA_ORIGEN || '', idEntregaOrigen: r.ID_ENTREGA_ORIGEN || '',
      montoOriginal: round2(toNum(r.MONTO_ORIGINAL)), saldoPendiente: saldo,
      fechaVencimiento: toDateStr(r.FECHA_VENCIMIENTO), estado, observacion: r.OBSERVACION || ''
    };
    result[idCliente].items.push(item);
    if (estado !== 'ANULADA' && saldo > 0) result[idCliente].saldoTotal = round2(result[idCliente].saldoTotal + saldo);
  }
  return result;
}

export async function getClientDebts(params) {
  await requireAuth(params);
  const idCliente = String(params.idCliente || '').trim();
  if (!idCliente) throw new Error('idCliente requerido.');
  const pool = await getPool();
  const data = await getDebtsForClients(pool, [idCliente]);
  const entry = data[idCliente] || { saldoTotal: 0, items: [] };
  return { ok: true, idCliente, saldoTotal: entry.saldoTotal, deudas: entry.items };
}

export async function listDeudores(params) {
  const user = await requireAuth(params);
  const pool = await getPool();
  const q = await pool.query(`
    SELECT d.ID_CLIENTE, MAX(d.CLIENTE_NOMBRE) AS CLIENTE_NOMBRE,
           SUM(CASE WHEN UPPER(d.ESTADO) <> 'ANULADA' AND d.SALDO_PENDIENTE > 0.009 THEN d.SALDO_PENDIENTE ELSE 0 END) AS SALDO_TOTAL
    FROM dbo.DEUDAS d
    GROUP BY d.ID_CLIENTE
    HAVING SUM(CASE WHEN UPPER(d.ESTADO) <> 'ANULADA' AND d.SALDO_PENDIENTE > 0.009 THEN d.SALDO_PENDIENTE ELSE 0 END) > 0.009
    ORDER BY SALDO_TOTAL DESC
  `);
  const ids = q.recordset.map(r => String(r.ID_CLIENTE));
  const byClient = await getDebtsForClients(pool, ids);
  const cinfo = await pool.query(`SELECT ID_CLIENTE, NOMBRE, DIRECCION, ZONA, TELEFONO FROM dbo.CLIENTES WHERE ID_CLIENTE IN (${ids.length ? ids.map((_,i)=>`@c${i}`).join(',') : "'__none__'"})`);
  // simple second query easier
  const cmap = {};
  if (ids.length) {
    const req = pool.request();
    ids.forEach((id,i)=>req.input(`c${i}`, sql.NVarChar(50), id));
    const cr = await req.query(`SELECT ID_CLIENTE,NOMBRE,DIRECCION,ZONA,TELEFONO FROM dbo.CLIENTES WHERE ID_CLIENTE IN (${ids.map((_,i)=>`@c${i}`).join(',')})`);
    cr.recordset.forEach(c => { cmap[String(c.ID_CLIENTE)] = c; });
  }
  const list = ids.map(id => {
    const d = byClient[id] || { saldoTotal: 0, items: [] };
    const c = cmap[id] || {};
    return {
      idCliente: id,
      clienteNombre: d.items[0]?.clienteNombre || c.NOMBRE || id,
      direccion: c.DIRECCION || '', zona: c.ZONA || '', telefono: c.TELEFONO || '',
      saldoTotal: round2(d.saldoTotal), deudas: d.items
    };
  }).filter(x => x.saldoTotal > 0.009);
  return { ok: true, puedeCobrarDeudas: !!user.puedeCobrarDeudas, deudores: list };
}

export async function cobrarDeudas(payload) {
  const user = await requireAuth(payload);
  if (!user.puedeCobrarDeudas) throw new Error('No tienes autorización para cobrar deudas. Solicita autorización al administrador.');
  const idCliente = String(payload.idCliente || '').trim();
  const clienteNombre = String(payload.clienteNombre || '').trim();
  const cobros = Array.isArray(payload.cobroDeudas) ? payload.cobroDeudas : [];
  const met = payload.cobroDeudasMetodos || {};
  const cobroEf = round2(toNum(met.efectivo)), cobroYa = round2(toNum(met.yape)), cobroTr = round2(toNum(met.transferencia));
  const totalMet = round2(cobroEf + cobroYa + cobroTr);
  const totalSel = round2(cobros.reduce((a,b)=>a+toNum(b.monto),0));
  if (!idCliente) throw new Error('idCliente requerido.');
  if (totalSel <= 0) throw new Error('Selecciona al menos una deuda para abonar.');
  if (Math.abs(totalMet - totalSel) > 0.011) throw new Error('El desglose del cobro no coincide con el total a abonar.');

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const detalle = await aplicarAbonosDeudaTx(tx, idCliente, clienteNombre, cobros, { efectivo:cobroEf,yape:cobroYa,transferencia:cobroTr }, {
      idRuta: String(payload.idRuta || ''), idEntrega: '', usuario: user.nombre || user.id
    });
    await actualizarSaldoClienteTx(tx, idCliente);
    await tx.commit();
    return { ok: true, idCliente, totalCobrado: totalSel, detalle };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

function splitAmount(amount, metodos, metTotal, isLast, assigned) {
  if (metTotal <= 0) return { efectivo:0,yape:0,transferencia:0 };
  if (isLast) return { efectivo: round2(toNum(metodos.efectivo)-assigned.efectivo), yape: round2(toNum(metodos.yape)-assigned.yape), transferencia: round2(toNum(metodos.transferencia)-assigned.transferencia) };
  const ratio = amount / metTotal;
  const e = round2(toNum(metodos.efectivo)*ratio);
  const y = round2(toNum(metodos.yape)*ratio);
  const t = round2(amount-e-y);
  assigned.efectivo=round2(assigned.efectivo+e); assigned.yape=round2(assigned.yape+y); assigned.transferencia=round2(assigned.transferencia+t);
  return { efectivo:e,yape:y,transferencia:t };
}

export async function aplicarAbonosDeudaTx(tx, idCliente, clienteNombre, cobros, metodos, ctx) {
  const map = new Map();
  for (const c of cobros) if (c?.idDeuda) map.set(String(c.idDeuda).trim(), round2(toNum(c.monto)));
  const ids = [...map.keys()];
  if (!ids.length) return [];
  const req = new sql.Request(tx);
  ids.forEach((id,i)=>req.input(`d${i}`, sql.NVarChar(100), id));
  req.input('idCliente', sql.NVarChar(50), idCliente);
  const q = await req.query(`SELECT ID_DEUDA, ID_CLIENTE, SALDO_PENDIENTE, ESTADO FROM dbo.DEUDAS WHERE ID_CLIENTE=@idCliente AND ID_DEUDA IN (${ids.map((_,i)=>`@d${i}`).join(',')})`);
  const byId = new Map(q.recordset.map(r => [String(r.ID_DEUDA).trim(), r]));
  const detalle = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) throw new Error('La deuda ' + id + ' no pertenece al cliente.');
    const saldo = round2(toNum(row.SALDO_PENDIENTE));
    const abono = round2(Math.min(map.get(id), saldo));
    if (abono <= 0) continue;
    const nuevoSaldo = round2(Math.max(0, saldo - abono));
    const nuevoEstado = nuevoSaldo <= 0.009 ? 'PAGADA' : 'PARCIAL';
    const u = new sql.Request(tx);
    u.input('id', sql.NVarChar(100), id).input('saldo', sql.Decimal(12,2), nuevoSaldo).input('est', sql.NVarChar(30), nuevoEstado);
    await u.query(`UPDATE dbo.DEUDAS SET SALDO_PENDIENTE=@saldo, ESTADO=@est, ACTUALIZADO_EN=SYSDATETIME() WHERE ID_DEUDA=@id`);
    detalle.push({ idDeuda: id, monto: abono, saldoRestante: nuevoSaldo, estado: nuevoEstado });
  }

  const metTotal = round2(toNum(metodos.efectivo)+toNum(metodos.yape)+toNum(metodos.transferencia));
  const assigned = { efectivo:0,yape:0,transferencia:0 };
  for (let i=0;i<detalle.length;i++) {
    const d = detalle[i];
    const parts = splitAmount(d.monto, metodos, metTotal, i===detalle.length-1, assigned);
    await registrarMovimientoTx(tx, {
      tipo:'COBRO_DEUDA', idCliente, clienteNombre, idRuta: ctx.idRuta||'', idEntrega: ctx.idEntrega||'', idDeuda:d.idDeuda,
      montoAplicado:d.monto, efectivo:parts.efectivo, yape:parts.yape, transferencia:parts.transferencia,
      resultado: d.saldoRestante <= 0.009 ? 'CANCELA_DEUDA' : 'ABONO_DEUDA', vencimientoNuevo:'', usuario: ctx.usuario||'', observacion:'Abono de deuda anterior'
    });
  }
  return detalle;
}

export async function registrarMovimientoTx(tx, m) {
  const id = 'MOV_' + Date.now() + '_' + Math.random().toString(36).slice(2,8).toUpperCase();
  const r = new sql.Request(tx);
  r.input('id', sql.NVarChar(100), id)
   .input('tipo', sql.NVarChar(40), m.tipo || '')
   .input('idCliente', sql.NVarChar(50), m.idCliente || null)
   .input('clienteNombre', sql.NVarChar(200), m.clienteNombre || null)
   .input('idRuta', sql.NVarChar(100), m.idRuta || null)
   .input('idEntrega', sql.NVarChar(100), m.idEntrega || null)
   .input('idDeuda', sql.NVarChar(100), m.idDeuda || null)
   .input('monto', sql.Decimal(12,2), round2(toNum(m.montoAplicado)))
   .input('ef', sql.Decimal(12,2), round2(toNum(m.efectivo)))
   .input('ya', sql.Decimal(12,2), round2(toNum(m.yape)))
   .input('tr', sql.Decimal(12,2), round2(toNum(m.transferencia)))
   .input('res', sql.NVarChar(60), m.resultado || null)
   .input('venc', sql.Date, m.vencimientoNuevo ? new Date(m.vencimientoNuevo) : null)
   .input('usr', sql.NVarChar(150), m.usuario || null)
   .input('obs', sql.NVarChar(sql.MAX), m.observacion || null);
  await r.query(`INSERT INTO dbo.MOVIMIENTOS (ID_MOVIMIENTO,TIPO,ID_CLIENTE,CLIENTE_NOMBRE,ID_RUTA,ID_ENTREGA,ID_DEUDA,MONTO_APLICADO,EFECTIVO,YAPE,TRANSFERENCIA,RESULTADO,VENCIMIENTO_NUEVO,USUARIO,OBSERVACION)
    VALUES (@id,@tipo,@idCliente,@clienteNombre,@idRuta,@idEntrega,@idDeuda,@monto,@ef,@ya,@tr,@res,@venc,@usr,@obs)`);
  return id;
}

export async function actualizarSaldoClienteTx(tx, idCliente) {
  const r = new sql.Request(tx);
  r.input('idCliente', sql.NVarChar(50), idCliente);
  await r.query(`
    UPDATE dbo.CLIENTES SET SALDO_PENDIENTE = ISNULL(x.SALDO,0), ACTUALIZADO_EN=SYSDATETIME()
    FROM dbo.CLIENTES c
    OUTER APPLY (
      SELECT SUM(CASE WHEN UPPER(ESTADO)<>'ANULADA' AND SALDO_PENDIENTE>0.009 THEN SALDO_PENDIENTE ELSE 0 END) AS SALDO
      FROM dbo.DEUDAS WHERE ID_CLIENTE=c.ID_CLIENTE
    ) x
    WHERE c.ID_CLIENTE=@idCliente
  `);
}