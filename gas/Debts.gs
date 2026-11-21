/**
 * Gestión de deudas y movimientos - Mundo Escolar
 */

function getClientDebts(params) {
  requireAuth_(params);
  var idCliente = String(params.idCliente || '').trim();
  if (!idCliente) throw new Error('idCliente requerido.');
  var data = getDebtsForClients_([idCliente]);
  var entry = data[idCliente] || { saldoTotal: 0, items: [] };
  return { ok: true, idCliente: idCliente, saldoTotal: entry.saldoTotal, deudas: entry.items };
}

function getDebtsForClients_(ids) {
  var master = getMaster_();
  var sh = getSheet_(master, 'DEUDAS');
  var result = {};
  ids.forEach(function(id){ result[id] = { saldoTotal: 0, items: [] }; });
  var last = sh.getLastRow();
  if (last < 2) return result;
  var data = sh.getRange(2, 1, last - 1, 14).getValues();
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var idCliente = String(r[1] || '').trim();
    if (!result[idCliente]) continue;
    var saldo = round2(toNum(r[7]));
    var estado = String(r[9] || '').toUpperCase();
    if (saldo <= 0.009 && estado === 'PAGADA') continue;
    var item = {
      idDeuda: String(r[0] || ''),
      idCliente: idCliente,
      clienteNombre: String(r[2] || ''),
      fechaOrigen: toDateStr(r[3]),
      idRutaOrigen: String(r[4] || ''),
      idEntregaOrigen: String(r[5] || ''),
      montoOriginal: round2(toNum(r[6])),
      saldoPendiente: saldo,
      fechaVencimiento: toDateStr(r[8]),
      estado: estado,
      observacion: String(r[10] || ''),
    };
    result[idCliente].items.push(item);
    if (estado !== 'ANULADA') result[idCliente].saldoTotal = round2(result[idCliente].saldoTotal + (saldo > 0 ? saldo : 0));
  }
  // sort by vencimiento asc
  Object.keys(result).forEach(function(k){
    result[k].items.sort(function(a,b){ return String(a.fechaVencimiento||'9999').localeCompare(String(b.fechaVencimiento||'9999')); });
  });
  return result;
}

function aplicarAbonosDeuda_(idCliente, clienteNombre, cobros, metodos, ctx) {
  // cobros: [{idDeuda, monto}] ; metodos: {efectivo,yape,transferencia}
  var master = getMaster_();
  var sh = getSheet_(master, 'DEUDAS');
  var last = sh.getLastRow();
  if (last < 2) throw new Error('No hay deudas registradas.');
  var map = {};
  cobros.forEach(function(c){ if (c && c.idDeuda) map[String(c.idDeuda).trim()] = round2(toNum(c.monto)); });
  var ids = Object.keys(map);
  if (!ids.length) return [];

  var range = sh.getRange(2, 1, last - 1, 14);
  var data = range.getValues();
  var detalle = [];
  var totalAplicado = 0;

  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var idDeuda = String(r[0] || '').trim();
    if (!map[idDeuda]) continue;
    if (String(r[1] || '').trim() !== String(idCliente).trim()) throw new Error('La deuda ' + idDeuda + ' no pertenece al cliente.');
    var saldo = round2(toNum(r[7]));
    var abono = Math.min(map[idDeuda], saldo);
    abono = round2(abono);
    if (abono <= 0) continue;
    var nuevoSaldo = round2(Math.max(0, saldo - abono));
    var nuevoEstado = nuevoSaldo <= 0.009 ? 'PAGADA' : 'PARCIAL';
    data[i][7] = nuevoSaldo; // SALDO_PENDIENTE
    data[i][9] = nuevoEstado; // ESTADO
    data[i][13] = nowTs(); // ACTUALIZADO_EN
    totalAplicado = round2(totalAplicado + abono);
    detalle.push({ idDeuda: idDeuda, monto: abono, saldoRestante: nuevoSaldo, estado: nuevoEstado });

    // Register movement per debt proportionally? easier one movement per debt with proportional breakdown
  }

  range.setValues(data);

  // Register movements (proportional split of methods across abonos)
  var metTotal = round2(toNum(metodos.efectivo) + toNum(metodos.yape) + toNum(metodos.transferencia));
  var assigned = { efectivo: 0, yape: 0, transferencia: 0 };
  detalle.forEach(function(d, idx){
    var parts = splitAmountByMethods_(d.monto, metodos, metTotal, idx === detalle.length - 1, assigned);
    registrarMovimiento_({
      tipo: 'COBRO_DEUDA', idCliente: idCliente, clienteNombre: clienteNombre,
      idRuta: String(ctx.idRuta || ''), idEntrega: String(ctx.idEntrega || ''), idDeuda: d.idDeuda,
      montoAplicado: d.monto, efectivo: parts.efectivo, yape: parts.yape, transferencia: parts.transferencia,
      resultado: d.saldoRestante <= 0.009 ? 'CANCELA_DEUDA' : 'ABONO_DEUDA',
      vencimientoNuevo: '', usuario: String(ctx.usuario || ''), observacion: 'Abono de deuda anterior'
    });
  });

  return detalle;
}

function splitAmountByMethods_(amount, metodos, metTotal, isLast, assigned) {
  if (metTotal <= 0) return { efectivo: 0, yape: 0, transferencia: 0 };
  if (isLast) {
    return {
      efectivo: round2(toNum(metodos.efectivo) - assigned.efectivo),
      yape: round2(toNum(metodos.yape) - assigned.yape),
      transferencia: round2(toNum(metodos.transferencia) - assigned.transferencia),
    };
  }
  var ratio = amount / metTotal;
  var e = round2(toNum(metodos.efectivo) * ratio);
  var y = round2(toNum(metodos.yape) * ratio);
  var t = round2(amount - e - y);
  assigned.efectivo = round2(assigned.efectivo + e);
  assigned.yape = round2(assigned.yape + y);
  assigned.transferencia = round2(assigned.transferencia + t);
  return { efectivo: e, yape: y, transferencia: t };
}

function crearOActualizarDeudaEntrega_(existingId, info) {
  var master = getMaster_();
  var sh = getSheet_(master, 'DEUDAS');
  var now = nowTs();
  if (existingId) {
    var row = findRowByValue_(sh, 1, existingId);
    if (row !== -1) {
      // update existing debt for this entrega
      sh.getRange(row, 7).setValue(round2(info.monto)); // MONTO_ORIGINAL
      sh.getRange(row, 8).setValue(round2(info.monto)); // SALDO_PENDIENTE (reset to new amount for correction; assumes no abonos yet on this specific newly generated one in same flow)
      sh.getRange(row, 9).setValue(info.vencimiento ? new Date(info.vencimiento + 'T00:00:00') : '');
      sh.getRange(row, 10).setValue(round2(info.monto) > 0 ? 'PENDIENTE' : 'ANULADA');
      sh.getRange(row, 11).setValue(info.observacion || '');
      sh.getRange(row, 14).setValue(now);
      return existingId;
    }
  }
  var id = nextId_('DEUDAS', 1, 'DEU', 6);
  sh.appendRow([
    id,
    info.idCliente || '',
    info.clienteNombre || '',
    info.fechaOrigen || todayStr(),
    info.idRutaOrigen || '',
    info.idEntregaOrigen || '',
    round2(info.monto),
    round2(info.monto),
    info.vencimiento ? new Date(info.vencimiento + 'T00:00:00') : '',
    round2(info.monto) > 0 ? 'PENDIENTE' : 'ANULADA',
    info.observacion || '',
    info.creadoPor || '',
    now,
    now
  ]);
  return id;
}

function ajustarDeudaGenerada_(idDeuda, nuevoMonto, usuario, motivo) {
  if (!idDeuda) return;
  var master = getMaster_();
  var sh = getSheet_(master, 'DEUDAS');
  var row = findRowByValue_(sh, 1, idDeuda);
  if (row === -1) return;
  var saldoActual = round2(toNum(sh.getRange(row, 8).getValue()));
  var montoOriginal = round2(toNum(sh.getRange(row, 7).getValue()));
  var nuevo = round2(toNum(nuevoMonto));
  // Simple adjustment: if set to 0 mark anulada (only if not partially paid)
  if (nuevo <= 0 && Math.abs(saldoActual - montoOriginal) < 0.02) {
    sh.getRange(row, 8).setValue(0);
    sh.getRange(row, 10).setValue('ANULADA');
    sh.getRange(row, 11).setValue(motivo || 'Ajuste');
    sh.getRange(row, 14).setValue(nowTs());
  }
}

function registrarMovimiento_(m) {
  var master = getMaster_();
  var sh = getSheet_(master, 'MOVIMIENTOS');
  var id = nextId_('MOVIMIENTOS', 1, 'MOV', 7);
  sh.appendRow([
    id,
    nowTs(),
    m.tipo || '',
    m.idCliente || '',
    m.clienteNombre || '',
    m.idRuta || '',
    m.idEntrega || '',
    m.idDeuda || '',
    round2(toNum(m.montoAplicado)),
    round2(toNum(m.efectivo)),
    round2(toNum(m.yape)),
    round2(toNum(m.transferencia)),
    m.resultado || '',
    m.vencimientoNuevo || '',
    m.usuario || '',
    m.observacion || ''
  ]);
  return id;
}

function actualizarSaldoCliente_(idCliente) {
  if (!idCliente) return;
  var data = getDebtsForClients_([idCliente]);
  var saldo = (data[idCliente] && data[idCliente].saldoTotal) || 0;
  var master = getMaster_();
  var sh = getSheet_(master, 'CLIENTES');
  var row = findRowByValue_(sh, 1, idCliente);
  if (row !== -1) {
    sh.getRange(row, 7).setValue(round2(saldo)); // G SALDO_PENDIENTE
  }
}