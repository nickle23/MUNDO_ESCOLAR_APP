/**
 * Gestión de rutas diarias - Mundo Escolar
 */

function getRouteToday(params) {
  var user = requireAuth_(params);
  var fecha = toDateStr(params.fecha) || todayStr();
  // Seguridad: usar siempre la identidad del usuario autenticado (ignorar conductor/idUsuario enviados por cliente)
  var conductor = String(user.conductorHoja || user.nombre || '').trim();
  var idUsuario = String(user.id || '').trim();

  var routeInfo = findRouteInfo_(fecha, conductor, idUsuario);
  if (!routeInfo) {
    return { ok: false, error: 'No tienes una ruta asignada para ' + fecha + '. Si crees que es un error, verifica INDICE_RUTAS (fecha, conductor/usuario y estado ABIERTA).' };
  }

  // Verificación adicional: la ruta debe pertenecer al usuario autenticado
  assertRouteAssignedToUser_(routeInfo, user);

  var ss = SpreadsheetApp.openById(routeInfo.spreadsheetId);
  var sh = ss.getSheetByName(routeInfo.hoja);
  if (!sh) return { ok: false, error: 'No se encontró la hoja de ruta: ' + routeInfo.hoja };

  var hmap = headerMap_(sh, 3);
  var c = routeCols_(hmap);
  var lastRow = sh.getLastRow();
  var entregas = [];
  var clientIds = {};

  if (lastRow >= 4) {
    var numRows = lastRow - 3;
    var values = sh.getRange(4, 1, numRows, Math.max(sh.getLastColumn(), 31)).getValues();
    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      var cliente = String(row[c.CLIENTE - 1] || '').trim();
      var direccion = String(row[c.DIRECCION - 1] || '').trim();
      var idEntrega = String(row[c.ID_ENTREGA - 1] || '').trim();
      var totMont = row[c.TOT_MONT - 1];
      // skip completely empty rows
      var hasData = cliente || direccion || toNum(totMont) > 0 || String(row[c.BO - 1] || '').trim();
      if (!hasData) continue;
      var idCliente = String(row[c.ID_CLIENTE - 1] || '').trim();
      var montoCobrar = toNum(row[c.MONTO_COBRAR - 1]);
      if (montoCobrar === 0) montoCobrar = toNum(totMont);
      var ent = {
        row: i + 4,
        direccion: direccion,
        cliente: cliente,
        bo: row[c.BO - 1], a1: row[c.A1 - 1], a2: row[c.A2 - 1], a3: row[c.A3 - 1],
        totB: row[c.TOT_B - 1],
        totMont: totMont,
        vend: String(row[c.VEND - 1] || ''),
        efectResumen: row[c.EFECT - 1],
        yapTrnsfResumen: row[c.YAP_TRNSF - 1],
        observacion: String(row[c.OBSERVACION - 1] || ''),
        idCliente: idCliente,
        idEntrega: idEntrega || ('ROW_' + (i + 4)),
        montoCobrar: montoCobrar,
        efectivo: toNum(row[c.EFECTIVO - 1]),
        yape: toNum(row[c.YAPE - 1]),
        transferencia: toNum(row[c.TRANSFERENCIA - 1]),
        totalPagadoHoy: toNum(row[c.TOTAL_PAGADO_HOY - 1]),
        saldoEntregaHoy: toNum(row[c.SALDO_ENTREGA_HOY - 1]),
        deudaGeneradaHoy: toNum(row[c.DEUDA_GENERADA_HOY - 1]),
        venceDeuda: toDateStr(row[c.VENCE_DEUDA - 1]),
        cobroDeudaAnterior: toNum(row[c.COBRO_DEUDA_ANTERIOR - 1]),
        cobroDeudaEfectivo: toNum(row[c.COBRO_DEUDA_EFECTIVO - 1]),
        cobroDeudaYape: toNum(row[c.COBRO_DEUDA_YAPE - 1]),
        cobroDeudaTransferencia: toNum(row[c.COBRO_DEUDA_TRANSFERENCIA - 1]),
        detalleCobroDeuda: String(row[c.DETALLE_COBRO_DEUDA - 1] || ''),
        estadoEntrega: String(row[c.ESTADO_ENTREGA - 1] || 'PENDIENTE').toUpperCase(),
        ultimaEdicion: row[c.ULTIMA_EDICION - 1],
        editadoPor: String(row[c.EDITADO_POR - 1] || ''),
        idDeudaGenerada: String(row[c.ID_DEUDA_GENERADA - 1] || ''),
      };
      entregas.push(ent);
      if (idCliente) clientIds[idCliente] = true;
    }
  }

  // Prefetch debts for clients in this route
  var deudasPorCliente = {};
  var ids = Object.keys(clientIds);
  if (ids.length) {
    deudasPorCliente = getDebtsForClients_(ids);
  }

  return {
    ok: true,
    usuario: user,
    ruta: {
      idRuta: routeInfo.idRuta,
      fecha: routeInfo.fecha,
      conductor: routeInfo.conductor,
      idUsuario: routeInfo.idUsuario,
      spreadsheetId: routeInfo.spreadsheetId,
      spreadsheetUrl: routeInfo.spreadsheetUrl,
      hoja: routeInfo.hoja,
      estado: routeInfo.estado,
    },
    entregas: entregas,
    deudasPorCliente: deudasPorCliente,
  };
}

function findRouteInfo_(fecha, conductor, idUsuario) {
  var master = getMaster_();
  var sh = getSheet_(master, 'INDICE_RUTAS');
  var last = sh.getLastRow();
  if (last < 2) return null;
  var data = sh.getRange(2, 1, last - 1, 11).getValues();
  var targetFecha = toDateStr(fecha);
  var targetConductor = normalizeName(conductor);
  var targetUser = String(idUsuario || '').trim();

  var best = null;
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var rFecha = toDateStr(r[1]);
    var rConductor = normalizeName(r[2]);
    var rUser = String(r[3] || '').trim();
    var estado = normalizeName(r[7]);
    if (estado === 'ANULADA') continue;
    if (rFecha !== targetFecha) continue;
    var matchUser = targetUser && rUser && rUser === targetUser;
    var matchCond = targetConductor && rConductor && rConductor === targetConductor;
    if (matchUser || matchCond) {
      // prefer ABIERTA
      if (!best || estado === 'ABIERTA') best = {
        idRuta: r[0], fecha: rFecha, conductor: String(r[2]||''), idUsuario: rUser,
        spreadsheetId: String(r[4]||''), spreadsheetUrl: String(r[5]||''), hoja: String(r[6]||''), estado: String(r[7]||'')
      };
    }
  }
  return best;
}

function assertRouteAssignedToUser_(routeInfo, user) {
  if (!routeInfo) throw new Error('Ruta no encontrada.');
  var userId = String(user.id || '').trim();
  var routeUser = String(routeInfo.idUsuario || '').trim();
  var userConductor = normalizeName(user.conductorHoja || user.nombre || '');
  var routeConductor = normalizeName(routeInfo.conductor || '');
  var userMatch = userId && routeUser && userId === routeUser;
  var conductorMatch = userConductor && routeConductor && userConductor === routeConductor;

  // Si INDICE_RUTAS tiene ID_USUARIO, exigimos coincidencia exacta por ID.
  if (routeUser) {
    if (!userMatch) throw new Error('No autorizado: esta ruta no está asignada a tu usuario.');
    return;
  }
  // Si no hay ID_USUARIO en el índice, validamos por conductor.
  if (!conductorMatch) throw new Error('No autorizado: esta ruta no está asignada a tu usuario.');
}

function getRouteInfoById_(idRuta) {
  var master = getMaster_();
  var sh = getSheet_(master, 'INDICE_RUTAS');
  var last = sh.getLastRow();
  if (last < 2) return null;
  var data = sh.getRange(2, 1, last - 1, 11).getValues();
  var target = String(idRuta || '').trim();
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (String(r[0] || '').trim() === target) {
      return {
        idRuta: r[0], fecha: toDateStr(r[1]), conductor: String(r[2]||''), idUsuario: String(r[3]||'').trim(),
        spreadsheetId: String(r[4]||''), spreadsheetUrl: String(r[5]||''), hoja: String(r[6]||''), estado: String(r[7]||'')
      };
    }
  }
  return null;
}

function routeCols_(hmap) {
  return {
    DIRECCION: col_(hmap, ['DIRECCION'], 1),
    CLIENTE: col_(hmap, ['CLIENTE'], 2),
    BO: col_(hmap, ['B.O. / S/.', 'BO / S/.', 'BO'], 3),
    A1: col_(hmap, ['A1 / S/.', 'A1'], 4),
    A2: col_(hmap, ['A2 / S/.', 'A2'], 5),
    A3: col_(hmap, ['A3 / S/.', 'A3'], 6),
    TOT_B: col_(hmap, ['TOT. B.', 'TOT B', 'TOTAL BULTOS'], 7),
    TOT_MONT: col_(hmap, ['TOT. MONT.', 'TOT MONT', 'TOTAL MONTO'], 8),
    VEND: col_(hmap, ['VEND.', 'VEND', 'VENDEDOR'], 9),
    EFECT: col_(hmap, ['EFECT', 'EFECTIVO_RESUMEN'], 10),
    YAP_TRNSF: col_(hmap, ['YAP/TRNSF', 'YAPE/TRNSF', 'YAPE/TRANSF'], 11),
    OBSERVACION: col_(hmap, ['OBSERVACION', 'OBSERVACIÓN'], 12),
    ID_CLIENTE: col_(hmap, ['ID_CLIENTE'], 13),
    ID_ENTREGA: col_(hmap, ['ID_ENTREGA'], 14),
    MONTO_COBRAR: col_(hmap, ['MONTO_COBRAR'], 15),
    EFECTIVO: col_(hmap, ['EFECTIVO'], 16),
    YAPE: col_(hmap, ['YAPE'], 17),
    TRANSFERENCIA: col_(hmap, ['TRANSFERENCIA'], 18),
    TOTAL_PAGADO_HOY: col_(hmap, ['TOTAL_PAGADO_HOY'], 19),
    SALDO_ENTREGA_HOY: col_(hmap, ['SALDO_ENTREGA_HOY'], 20),
    DEUDA_GENERADA_HOY: col_(hmap, ['DEUDA_GENERADA_HOY'], 21),
    VENCE_DEUDA: col_(hmap, ['VENCE_DEUDA'], 22),
    COBRO_DEUDA_ANTERIOR: col_(hmap, ['COBRO_DEUDA_ANTERIOR'], 23),
    COBRO_DEUDA_EFECTIVO: col_(hmap, ['COBRO_DEUDA_EFECTIVO'], 24),
    COBRO_DEUDA_YAPE: col_(hmap, ['COBRO_DEUDA_YAPE'], 25),
    COBRO_DEUDA_TRANSFERENCIA: col_(hmap, ['COBRO_DEUDA_TRANSFERENCIA'], 26),
    DETALLE_COBRO_DEUDA: col_(hmap, ['DETALLE_COBRO_DEUDA'], 27),
    ESTADO_ENTREGA: col_(hmap, ['ESTADO_ENTREGA'], 28),
    ULTIMA_EDICION: col_(hmap, ['ULTIMA_EDICION'], 29),
    EDITADO_POR: col_(hmap, ['EDITADO_POR'], 30),
    ID_DEUDA_GENERADA: col_(hmap, ['ID_DEUDA_GENERADA'], 31),
  };
}

function saveEntrega(payload) {
  var user = requireAuth_(payload);
  var ruta = payload.ruta || {};
  var entIn = payload.entrega || {};
  if (!ruta.idRuta) throw new Error('Datos de ruta incompletos (falta idRuta).');

  // Seguridad: nunca confiar en spreadsheetId/hoja enviados por cliente.
  var routeInfo = getRouteInfoById_(ruta.idRuta);
  if (!routeInfo) throw new Error('Ruta no encontrada en INDICE_RUTAS.');
  assertRouteAssignedToUser_(routeInfo, user);
  if (normalizeName(routeInfo.estado) === 'ANULADA') throw new Error('Esta ruta está anulada y no permite modificaciones.');

  var idEntrega = String(entIn.idEntrega || '').trim();
  var rowNum = Number(entIn.row || 0);

  var ss = SpreadsheetApp.openById(routeInfo.spreadsheetId);
  var sh = ss.getSheetByName(routeInfo.hoja);
  if (!sh) throw new Error('No se encontró la hoja de ruta.');
  var hmap = headerMap_(sh, 3);
  var c = routeCols_(hmap);

  // Locate row
  var targetRow = -1;
  if (idEntrega && !idEntrega.match(/^ROW_/)) {
    var last = sh.getLastRow();
    if (last >= 4) {
      var ids = sh.getRange(4, c.ID_ENTREGA, last - 3, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]).trim() === idEntrega) { targetRow = i + 4; break; }
      }
    }
  }
  if (targetRow === -1 && rowNum >= 4) targetRow = rowNum;
  if (targetRow === -1) throw new Error('No se pudo ubicar la fila de la entrega (ID_ENTREGA/row).');

  // Ensure ID_ENTREGA exists
  var currentIdEntrega = String(sh.getRange(targetRow, c.ID_ENTREGA).getValue() || '').trim();
  if (!currentIdEntrega) { currentIdEntrega = 'ENT_' + Utilities.getUuid().slice(0,8).toUpperCase(); sh.getRange(targetRow, c.ID_ENTREGA).setValue(currentIdEntrega); }
  var idCliente = String(entIn.idCliente || sh.getRange(targetRow, c.ID_CLIENTE).getValue() || '').trim();
  if (idCliente) sh.getRange(targetRow, c.ID_CLIENTE).setValue(idCliente);
  var clienteNombre = String(entIn.cliente || sh.getRange(targetRow, c.CLIENTE).getValue() || '').trim();

  var montoCobrar = toNum(entIn.montoCobrar);
  if (montoCobrar === 0) montoCobrar = toNum(sh.getRange(targetRow, c.TOT_MONT).getValue());
  if (montoCobrar === 0) montoCobrar = toNum(sh.getRange(targetRow, c.MONTO_COBRAR).getValue());
  sh.getRange(targetRow, c.MONTO_COBRAR).setValue(montoCobrar);

  var pago = payload.pagoHoy || {};
  var efectivo = round2(toNum(pago.efectivo));
  var yape = round2(toNum(pago.yape));
  var transferencia = round2(toNum(pago.transferencia));
  var totalPagadoHoy = round2(efectivo + yape + transferencia);
  var saldoEntrega = round2(Math.max(0, montoCobrar - totalPagadoHoy));

  var generaDeuda = !!payload.generaDeuda && saldoEntrega > 0.009;
  var deudaNueva = payload.deudaNueva || {};
  var vencimientoNuevo = generaDeuda ? toDateStr(deudaNueva.vencimiento) : '';
  var montoDeudaNueva = generaDeuda ? saldoEntrega : 0;

  // Cobro de deudas anteriores
  var cobros = Array.isArray(payload.cobroDeudas) ? payload.cobroDeudas : [];
  var cobroMet = payload.cobroDeudasMetodos || {};
  var cobroEf = round2(toNum(cobroMet.efectivo));
  var cobroYa = round2(toNum(cobroMet.yape));
  var cobroTr = round2(toNum(cobroMet.transferencia));
  var totalCobroMet = round2(cobroEf + cobroYa + cobroTr);
  var totalCobroSel = round2(cobros.reduce(function(a,b){ return a + toNum(b.monto); }, 0));
  if (totalCobroSel > 0 && Math.abs(totalCobroMet - totalCobroSel) > 0.011) {
    throw new Error('El desglose del cobro de deudas (' + totalCobroMet + ') no coincide con el total abonado (' + totalCobroSel + ').');
  }

  // Apply debt collections in master
  var detalleCobro = [];
  var lock = LockService.getScriptLock();
  try { lock.tryLock(15000); } catch(e) {}
  try {
    if (totalCobroSel > 0 && idCliente) {
      detalleCobro = aplicarAbonosDeuda_(idCliente, clienteNombre, cobros, { efectivo: cobroEf, yape: cobroYa, transferencia: cobroTr }, {
        idRuta: routeInfo.idRuta, idEntrega: currentIdEntrega, usuario: user.nombre || user.id
      });
    }

    // Create/update new debt
    var idDeudaGenerada = String(sh.getRange(targetRow, c.ID_DEUDA_GENERADA).getValue() || '').trim();
    if (generaDeuda && idCliente) {
      idDeudaGenerada = crearOActualizarDeudaEntrega_(idDeudaGenerada, {
        idCliente: idCliente, clienteNombre: clienteNombre, fechaOrigen: toDateStr(routeInfo.fecha) || todayStr(),
        idRutaOrigen: String(routeInfo.idRuta || ''), idEntregaOrigen: currentIdEntrega,
        monto: montoDeudaNueva, vencimiento: vencimientoNuevo, creadoPor: user.nombre || user.id,
        observacion: String(payload.observacion || '')
      });
    } else if (!generaDeuda && idDeudaGenerada) {
      // If previously generated debt now resolved for this entrega, adjust/close that specific debt
      ajustarDeudaGenerada_(idDeudaGenerada, 0, user.nombre || user.id, 'Ajuste por corrección en entrega');
      idDeudaGenerada = '';
    }

    // Movement for today's delivery payment
    if (totalPagadoHoy > 0 || generaDeuda) {
      registrarMovimiento_({
        tipo: 'PAGO_ENTREGA', idCliente: idCliente, clienteNombre: clienteNombre,
        idRuta: String(routeInfo.idRuta || ''), idEntrega: currentIdEntrega, idDeuda: idDeudaGenerada,
        montoAplicado: totalPagadoHoy, efectivo: efectivo, yape: yape, transferencia: transferencia,
        resultado: saldoEntrega <= 0.009 ? 'PAGO_COMPLETO' : 'PAGO_PARCIAL_GENERA_DEUDA',
        vencimientoNuevo: vencimientoNuevo, usuario: user.nombre || user.id, observacion: String(payload.observacion || '')
      });
    }

    // Update client cached balance
    if (idCliente) actualizarSaldoCliente_(idCliente);
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }

  // Update route sheet row
  var estadoEntrega = String(payload.estadoEntrega || '').toUpperCase();
  if (!estadoEntrega || estadoEntrega === 'PENDIENTE') {
    if (saldoEntrega <= 0.009 && montoCobrar > 0) estadoEntrega = 'PAGADO';
    else if (generaDeuda) estadoEntrega = 'CREDITO';
    else if (totalPagadoHoy > 0) estadoEntrega = 'PARCIAL';
    else estadoEntrega = 'PENDIENTE';
  }

  var obs = String(payload.observacion || '');
  var now = nowTs();
  var resumenYapeTrnsf = '';
  if (yape > 0 || transferencia > 0) resumenYapeTrnsf = ('YAPE: ' + yape.toFixed(2) + ' / TRANSF: ' + transferencia.toFixed(2));

  sh.getRange(targetRow, c.EFECTIVO).setValue(efectivo);
  sh.getRange(targetRow, c.YAPE).setValue(yape);
  sh.getRange(targetRow, c.TRANSFERENCIA).setValue(transferencia);
  sh.getRange(targetRow, c.TOTAL_PAGADO_HOY).setValue(totalPagadoHoy);
  sh.getRange(targetRow, c.SALDO_ENTREGA_HOY).setValue(saldoEntrega);
  sh.getRange(targetRow, c.DEUDA_GENERADA_HOY).setValue(montoDeudaNueva);
  if (vencimientoNuevo) sh.getRange(targetRow, c.VENCE_DEUDA).setValue(new Date(vencimientoNuevo + 'T00:00:00'));
  else if (!generaDeuda) sh.getRange(targetRow, c.VENCE_DEUDA).setValue('');
  sh.getRange(targetRow, c.COBRO_DEUDA_ANTERIOR).setValue(totalCobroSel);
  sh.getRange(targetRow, c.COBRO_DEUDA_EFECTIVO).setValue(cobroEf);
  sh.getRange(targetRow, c.COBRO_DEUDA_YAPE).setValue(cobroYa);
  sh.getRange(targetRow, c.COBRO_DEUDA_TRANSFERENCIA).setValue(cobroTr);
  sh.getRange(targetRow, c.DETALLE_COBRO_DEUDA).setValue(detalleCobro.length ? JSON.stringify(detalleCobro) : (String(sh.getRange(targetRow, c.DETALLE_COBRO_DEUDA).getValue() || '') || ''));
  sh.getRange(targetRow, c.ESTADO_ENTREGA).setValue(estadoEntrega);
  sh.getRange(targetRow, c.ULTIMA_EDICION).setValue(now);
  sh.getRange(targetRow, c.EDITADO_POR).setValue(user.nombre || user.id);
  sh.getRange(targetRow, c.ID_DEUDA_GENERADA).setValue(idDeudaGenerada || '');
  // summary columns for printing
  sh.getRange(targetRow, c.EFECT).setValue(efectivo > 0 ? efectivo : '');
  sh.getRange(targetRow, c.YAP_TRNSF).setValue(resumenYapeTrnsf);
  sh.getRange(targetRow, c.OBSERVACION).setValue(obs);

  // update index timestamp
  try { touchIndiceRuta_(routeInfo.idRuta); } catch(e) {}

  return {
    ok: true,
    entrega: {
      idEntrega: currentIdEntrega, row: targetRow, totalPagadoHoy: totalPagadoHoy, saldoEntregaHoy: saldoEntrega,
      deudaGeneradaHoy: montoDeudaNueva, venceDeuda: vencimientoNuevo, estadoEntrega: estadoEntrega,
      idDeudaGenerada: idDeudaGenerada || '', cobroDeudaAnterior: totalCobroSel
    }
  };
}

function touchIndiceRuta_(idRuta) {
  if (!idRuta) return;
  var master = getMaster_();
  var sh = getSheet_(master, 'INDICE_RUTAS');
  var row = findRowByValue_(sh, 1, idRuta);
  if (row !== -1) sh.getRange(row, 11).setValue(nowTs());
}