import { getPool, sql } from '../db.js';
import { requireAuth } from './auth.js';
import { toNum, round2, norm, toDateStr, todayISO } from '../utils.js';
import { aplicarAbonosDeudaTx, registrarMovimientoTx, actualizarSaldoClienteTx } from './debts.js';

function ensureAssigned(route, user) {
  const estado = norm(route.ESTADO);
  if (estado === 'ANULADA') throw new Error('Esta ruta está anulada y no permite modificaciones.');
  if (estado === 'FINALIZADA' || estado === 'CERRADA') throw new Error('Esta ruta ya fue finalizada. No se pueden modificar cobros de entregas.');
  if (toDateStr(route.FECHA) !== todayISO()) throw new Error('Solo se puede editar la ruta del día actual. Las rutas anteriores son solo de consulta.');
  const userId = String(user.id||'').trim();
  const routeUserId = String(route.ID_USUARIO||'').trim();
  const matchUser = userId && routeUserId && userId===routeUserId;
  const matchCond = !routeUserId && norm(user.conductorHoja||user.nombre) && norm(route.CONDUCTOR)===norm(user.conductorHoja||user.nombre);
  if (!(matchUser||matchCond)) throw new Error('No autorizado: esta ruta no está asignada a tu usuario.');
}

async function crearOActualizarDeudaEntregaTx(tx, existingId, info) {
  const nowMonto = round2(info.monto);
  if (existingId) {
    const r = new sql.Request(tx);
    r.input('id', sql.NVarChar(100), existingId)
     .input('monto', sql.Decimal(12,2), nowMonto)
     .input('saldo', sql.Decimal(12,2), nowMonto)
     .input('venc', sql.Date, info.vencimiento ? new Date(info.vencimiento) : null)
     .input('obs', sql.NVarChar(sql.MAX), info.observacion || null)
     .input('est', sql.NVarChar(30), nowMonto > 0 ? 'PENDIENTE' : 'ANULADA');
    const u = await r.query(`UPDATE dbo.DEUDAS SET MONTO_ORIGINAL=@monto, SALDO_PENDIENTE=@saldo, FECHA_VENCIMIENTO=@venc, OBSERVACION=@obs, ESTADO=@est, ACTUALIZADO_EN=SYSDATETIME() WHERE ID_DEUDA=@id`);
    if (u.rowsAffected[0] > 0) return existingId;
  }
  const id = existingId || ('DEU_' + Date.now() + '_' + Math.random().toString(36).slice(2,7).toUpperCase());
  const r = new sql.Request(tx);
  r.input('id', sql.NVarChar(100), id)
   .input('idCliente', sql.NVarChar(50), info.idCliente)
   .input('clienteNombre', sql.NVarChar(200), info.clienteNombre || '')
   .input('fechaOrigen', sql.Date, info.fechaOrigen ? new Date(info.fechaOrigen) : new Date())
   .input('idRuta', sql.NVarChar(100), info.idRutaOrigen || null)
   .input('idEntrega', sql.NVarChar(100), info.idEntregaOrigen || null)
   .input('monto', sql.Decimal(12,2), nowMonto)
   .input('saldo', sql.Decimal(12,2), nowMonto)
   .input('venc', sql.Date, info.vencimiento ? new Date(info.vencimiento) : null)
   .input('est', sql.NVarChar(30), nowMonto > 0 ? 'PENDIENTE' : 'ANULADA')
   .input('obs', sql.NVarChar(sql.MAX), info.observacion || null)
   .input('creadoPor', sql.NVarChar(150), info.creadoPor || null);
  await r.query(`INSERT INTO dbo.DEUDAS (ID_DEUDA,ID_CLIENTE,CLIENTE_NOMBRE,FECHA_ORIGEN,ID_RUTA_ORIGEN,ID_ENTREGA_ORIGEN,MONTO_ORIGINAL,SALDO_PENDIENTE,FECHA_VENCIMIENTO,ESTADO,OBSERVACION,CREADO_POR)
    VALUES (@id,@idCliente,@clienteNombre,@fechaOrigen,@idRuta,@idEntrega,@monto,@saldo,@venc,@est,@obs,@creadoPor)`);
  return id;
}

async function ajustarDeudaGeneradaTx(tx, idDeuda, nuevoMonto, usuario, obs) {
  if (!idDeuda) return;
  const r = new sql.Request(tx);
  r.input('id', sql.NVarChar(100), idDeuda);
  const q = await r.query(`SELECT MONTO_ORIGINAL, SALDO_PENDIENTE, ESTADO FROM dbo.DEUDAS WHERE ID_DEUDA=@id`);
  const row = q.recordset[0];
  if (!row) return;
  const saldoActual = round2(toNum(row.SALDO_PENDIENTE));
  const pagado = round2(Math.max(0, toNum(row.MONTO_ORIGINAL) - saldoActual));
  const nuevoMontoR = round2(toNum(nuevoMonto));
  const nuevoSaldo = round2(Math.max(0, nuevoMontoR - pagado));
  const nuevoEstado = nuevoMontoR <= 0.009 && nuevoSaldo <= 0.009 ? 'ANULADA' : (nuevoSaldo <= 0.009 ? 'PAGADA' : (pagado > 0 ? 'PARCIAL' : 'PENDIENTE'));
  const u = new sql.Request(tx);
  u.input('id', sql.NVarChar(100), idDeuda).input('monto', sql.Decimal(12,2), nuevoMontoR).input('saldo', sql.Decimal(12,2), nuevoSaldo).input('est', sql.NVarChar(30), nuevoEstado);
  await u.query(`UPDATE dbo.DEUDAS SET MONTO_ORIGINAL=@monto, SALDO_PENDIENTE=@saldo, ESTADO=@est, OBSERVACION=ISNULL(OBSERVACION,'') + @obs, ACTUALIZADO_EN=SYSDATETIME() WHERE ID_DEUDA=@id`);
  u.input('obs', sql.NVarChar(200), ' | ' + (obs||'Ajuste'));
}

export async function saveEntrega(payload) {
  const user = await requireAuth(payload);
  const idRuta = String(payload.ruta?.idRuta || payload.idRuta || '').trim();
  if (!idRuta) throw new Error('Falta ruta.idRuta.');
  const pool = await getPool();
  const rr = await pool.request().input('idRuta', sql.NVarChar(100), idRuta).query(`SELECT TOP 1 * FROM dbo.INDICE_RUTAS WHERE ID_RUTA=@idRuta`);
  const route = rr.recordset[0];
  if (!route) throw new Error('Ruta no encontrada en INDICE_RUTAS.');
  ensureAssigned(route, user);

  const entIn = payload.entrega || {};
  const idEntrega = String(entIn.idEntrega || '').trim();
  if (!idEntrega) throw new Error('Falta entrega.idEntrega.');
  const er = await pool.request().input('idRuta', sql.NVarChar(100), idRuta).input('idEntrega', sql.NVarChar(100), idEntrega)
    .query(`SELECT TOP 1 * FROM dbo.ENTREGAS WHERE ID_RUTA=@idRuta AND ID_ENTREGA=@idEntrega`);
  const ent = er.recordset[0];
  if (!ent) throw new Error('No se encontró la entrega en la ruta.');

  const idCliente = String(entIn.idCliente || ent.ID_CLIENTE || '').trim();
  const clienteNombre = String(entIn.cliente || ent.CLIENTE || '').trim();
  const montoCobrar = round2(toNum(entIn.montoCobrar || ent.MONTO_COBRAR || ent.TOT_MONT));

  const estadoEntrada = norm(payload.estadoEntrega);
  const esNoEntrega = estadoEntrada === 'REPROGRAMADO' || estadoEntrada === 'RECHAZADO';
  const obsIn = String(payload.observacion || '').trim();
  if (esNoEntrega && !obsIn) throw new Error(estadoEntrada === 'REPROGRAMADO' ? 'Indica motivo/fecha acordada para reprogramar.' : 'Indica el motivo por el que el cliente rechazó el pedido.');

  const pago = payload.pagoHoy || {};
  const efectivo = esNoEntrega ? 0 : round2(toNum(pago.efectivo));
  const yape = esNoEntrega ? 0 : round2(toNum(pago.yape));
  const transferencia = esNoEntrega ? 0 : round2(toNum(pago.transferencia));
  const totalPagadoHoy = round2(efectivo + yape + transferencia);
  const saldoEntrega = esNoEntrega ? 0 : round2(Math.max(0, montoCobrar - totalPagadoHoy));

  const generaDeuda = !esNoEntrega && !!payload.generaDeuda && saldoEntrega > 0.009;
  const deudaNueva = payload.deudaNueva || {};
  const vencimientoNuevo = generaDeuda ? toDateStr(deudaNueva.vencimiento) : '';
  const montoDeudaNueva = generaDeuda ? saldoEntrega : 0;

  const cobros = Array.isArray(payload.cobroDeudas) ? payload.cobroDeudas : [];
  const cobroMet = payload.cobroDeudasMetodos || {};
  const cobroEf = round2(toNum(cobroMet.efectivo)), cobroYa = round2(toNum(cobroMet.yape)), cobroTr = round2(toNum(cobroMet.transferencia));
  const totalCobroMet = round2(cobroEf + cobroYa + cobroTr);
  const totalCobroSel = round2(cobros.reduce((a,b)=>a+toNum(b.monto),0));
  if (totalCobroSel > 0 && !user.puedeCobrarDeudas) throw new Error('No tienes autorización para cobrar deudas. Solicita autorización al administrador.');
  if (totalCobroSel > 0 && Math.abs(totalCobroMet - totalCobroSel) > 0.011) throw new Error('El desglose del cobro de deudas no coincide con el total abonado.');

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    let detalleCobro = [];
    if (totalCobroSel > 0 && idCliente) {
      detalleCobro = await aplicarAbonosDeudaTx(tx, idCliente, clienteNombre, cobros, { efectivo:cobroEf,yape:cobroYa,transferencia:cobroTr }, {
        idRuta, idEntrega, usuario: user.nombre || user.id
      });
    }

    let idDeudaGenerada = String(ent.ID_DEUDA_GENERADA || '').trim();
    if (generaDeuda && idCliente) {
      idDeudaGenerada = await crearOActualizarDeudaEntregaTx(tx, idDeudaGenerada, {
        idCliente, clienteNombre, fechaOrigen: toDateStr(route.FECHA) || todayISO(), idRutaOrigen: idRuta, idEntregaOrigen: idEntrega,
        monto: montoDeudaNueva, vencimiento: vencimientoNuevo, creadoPor: user.nombre || user.id, observacion: obsIn
      });
    } else if (!generaDeuda && idDeudaGenerada) {
      await ajustarDeudaGeneradaTx(tx, idDeudaGenerada, 0, user.nombre || user.id, 'Ajuste por corrección en entrega');
      idDeudaGenerada = '';
    }

    if (totalPagadoHoy > 0 || generaDeuda) {
      await registrarMovimientoTx(tx, {
        tipo:'PAGO_ENTREGA', idCliente, clienteNombre, idRuta, idEntrega, idDeuda: idDeudaGenerada,
        montoAplicado: totalPagadoHoy, efectivo, yape, transferencia,
        resultado: saldoEntrega <= 0.009 ? 'PAGO_COMPLETO' : 'PAGO_PARCIAL_GENERA_DEUDA',
        vencimientoNuevo, usuario: user.nombre || user.id, observacion: obsIn
      });
    }

    if (idCliente) await actualizarSaldoClienteTx(tx, idCliente);

    let estadoEntrega = estadoEntrada;
    if (esNoEntrega) estadoEntrega = estadoEntrada;
    else if (!estadoEntrega || estadoEntrega === 'PENDIENTE') {
      if (saldoEntrega <= 0.009 && montoCobrar > 0) estadoEntrega = 'PAGADO';
      else if (generaDeuda) estadoEntrega = 'CREDITO';
      else if (totalPagadoHoy > 0) estadoEntrega = 'PARCIAL';
      else estadoEntrega = 'PENDIENTE';
    }

    const u = new sql.Request(tx);
    u.input('idRuta', sql.NVarChar(100), idRuta)
     .input('idEntrega', sql.NVarChar(100), idEntrega)
     .input('idCliente', sql.NVarChar(50), idCliente || null)
     .input('montoCobrar', sql.Decimal(12,2), montoCobrar)
     .input('ef', sql.Decimal(12,2), efectivo).input('ya', sql.Decimal(12,2), yape).input('tr', sql.Decimal(12,2), transferencia)
     .input('tph', sql.Decimal(12,2), totalPagadoHoy).input('saldo', sql.Decimal(12,2), saldoEntrega).input('dgh', sql.Decimal(12,2), montoDeudaNueva)
     .input('venc', sql.Date, vencimientoNuevo ? new Date(vencimientoNuevo) : null)
     .input('cda', sql.Decimal(12,2), totalCobroSel).input('cde', sql.Decimal(12,2), cobroEf).input('cdy', sql.Decimal(12,2), cobroYa).input('cdt', sql.Decimal(12,2), cobroTr)
     .input('det', sql.NVarChar(sql.MAX), detalleCobro.length ? JSON.stringify(detalleCobro) : (ent.DETALLE_COBRO_DEUDA || null))
     .input('est', sql.NVarChar(30), estadoEntrega)
     .input('usr', sql.NVarChar(150), user.nombre || user.id)
     .input('idDeuda', sql.NVarChar(100), idDeudaGenerada || null)
     .input('obs', sql.NVarChar(sql.MAX), obsIn);
    await u.query(`
      UPDATE dbo.ENTREGAS SET
        ID_CLIENTE=@idCliente, MONTO_COBRAR=@montoCobrar, EFECTIVO=@ef, YAPE=@ya, TRANSFERENCIA=@tr,
        TOTAL_PAGADO_HOY=@tph, SALDO_ENTREGA_HOY=@saldo, DEUDA_GENERADA_HOY=@dgh, VENCE_DEUDA=@venc,
        COBRO_DEUDA_ANTERIOR=@cda, COBRO_DEUDA_EFECTIVO=@cde, COBRO_DEUDA_YAPE=@cdy, COBRO_DEUDA_TRANSFERENCIA=@cdt,
        DETALLE_COBRO_DEUDA=@det, ESTADO_ENTREGA=@est, ID_DEUDA_GENERADA=@idDeuda, OBSERVACION=@obs,
        ULTIMA_EDICION=SYSDATETIME(), EDITADO_POR=@usr, ACTUALIZADO_EN=SYSDATETIME()
      WHERE ID_RUTA=@idRuta AND ID_ENTREGA=@idEntrega
    `);
    await new sql.Request(tx).input('idRuta', sql.NVarChar(100), idRuta).query(`UPDATE dbo.INDICE_RUTAS SET ACTUALIZADO_EN=SYSDATETIME() WHERE ID_RUTA=@idRuta`);

    await tx.commit();
    return { ok: true, entrega: { idEntrega, totalPagadoHoy, saldoEntregaHoy: saldoEntrega, deudaGeneradaHoy: montoDeudaNueva, venceDeuda: vencimientoNuevo, estadoEntrega, idDeudaGenerada, cobroDeudaAnterior: totalCobroSel } };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

export async function finalizarRuta(payload) {
  const user = await requireAuth(payload);
  const idRuta = String(payload.ruta?.idRuta || payload.idRuta || '').trim();
  if (!idRuta) throw new Error('Falta idRuta.');
  const pool = await getPool();
  const rr = await pool.request().input('idRuta', sql.NVarChar(100), idRuta).query(`SELECT TOP 1 * FROM dbo.INDICE_RUTAS WHERE ID_RUTA=@idRuta`);
  const route = rr.recordset[0];
  if (!route) throw new Error('Ruta no encontrada en INDICE_RUTAS.');
  ensureAssigned(route, user);
  await pool.request().input('idRuta', sql.NVarChar(100), idRuta).query(`UPDATE dbo.INDICE_RUTAS SET ESTADO='FINALIZADA', ACTUALIZADO_EN=SYSDATETIME() WHERE ID_RUTA=@idRuta`);
  return { ok: true, ruta: { idRuta, estado: 'FINALIZADA' } };
}