/**
 * Configuración inicial y creación de estructuras - Mundo Escolar
 */

function setMasterId(id) {
  PropertiesService.getScriptProperties().setProperty('MASTER_ID', String(id || SpreadsheetApp.getActiveSpreadsheet().getId()));
  return { ok: true, masterId: PropertiesService.getScriptProperties().getProperty('MASTER_ID') };
}

function setupMaster() {
  var ss = getMaster_();
  try { setMasterId(ss.getId()); } catch (e) {}

  ensureSheetWithHeaders_(ss, 'CONFIG', ['CLAVE', 'VALOR', 'DESCRIPCION'], [
    ['TIMEZONE', 'America/Lima', 'Zona horaria'],
    ['RUTAS_FOLDER_ID', '', 'ID de carpeta Drive con archivos de rutas'],
    ['MASTER_ID', ss.getId(), 'ID del spreadsheet maestro'],
  ]);

  ensureSheetWithHeaders_(ss, 'USUARIOS', ['ID_USUARIO', 'NOMBRE', 'CONDUCTOR_HOJA', 'PIN', 'ACTIVO', 'ROL', 'NOTAS', 'PUEDE_COBRAR_DEUDAS'], [
    ['USR001', 'JONATAN', 'JONATAN', '1234', 'SI', 'REPARTIDOR', 'Ejemplo - cambiar PIN', 'NO'],
    ['USR002', 'NIXON', 'NIXON', '2345', 'SI', 'REPARTIDOR', 'Ejemplo - cambiar PIN', 'NO'],
  ]);

  ensureSheetWithHeaders_(ss, 'CLIENTES', ['ID_CLIENTE', 'NOMBRE', 'DIRECCION', 'ZONA', 'TELEFONO', 'ACTIVO', 'SALDO_PENDIENTE', 'FECHA_ALTA', 'NOTAS'], []);

  ensureSheetWithHeaders_(ss, 'INDICE_RUTAS', ['ID_RUTA', 'FECHA', 'CONDUCTOR', 'ID_USUARIO', 'SPREADSHEET_ID', 'SPREADSHEET_URL', 'HOJA', 'ESTADO', 'TOTAL_ENTREGAS', 'CREADO_EN', 'ACTUALIZADO_EN'], []);

  ensureSheetWithHeaders_(ss, 'DEUDAS', ['ID_DEUDA', 'ID_CLIENTE', 'CLIENTE_NOMBRE', 'FECHA_ORIGEN', 'ID_RUTA_ORIGEN', 'ID_ENTREGA_ORIGEN', 'MONTO_ORIGINAL', 'SALDO_PENDIENTE', 'FECHA_VENCIMIENTO', 'ESTADO', 'OBSERVACION', 'CREADO_POR', 'CREADO_EN', 'ACTUALIZADO_EN'], []);

  ensureSheetWithHeaders_(ss, 'MOVIMIENTOS', ['ID_MOVIMIENTO', 'FECHA_HORA', 'TIPO', 'ID_CLIENTE', 'CLIENTE_NOMBRE', 'ID_RUTA', 'ID_ENTREGA', 'ID_DEUDA', 'MONTO_APLICADO', 'EFECTIVO', 'YAPE', 'TRANSFERENCIA', 'RESULTADO', 'VENCIMIENTO_NUEVO', 'USUARIO', 'OBSERVACION'], []);

  return { ok: true, message: 'Maestro configurado correctamente.', masterId: ss.getId() };
}

function ensureSheetWithHeaders_(ss, name, headers, seedRows) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var lastCol = Math.max(sh.getLastColumn(), headers.length, 1);
  var existing = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var hasAny = existing.some(function (v) { return v !== '' && v !== null; });
  if (!hasAny) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    // Append missing headers at the end (no borra datos existentes)
    var map = {};
    for (var i = 0; i < existing.length; i++) {
      var n = normalizeName(existing[i]);
      if (n) map[n] = true;
    }
    var col = existing.length;
    headers.forEach(function (h) {
      if (!map[normalizeName(h)]) {
        col++;
        sh.getRange(1, col).setValue(h);
      }
    });
  }
  sh.setFrozenRows(1);
  if (seedRows && seedRows.length && sh.getLastRow() <= 1) {
    seedRows.forEach(function (r) { sh.appendRow(r); });
  }
  try { sh.autoResizeColumns(1, Math.min(sh.getLastColumn(), 12)); } catch (e) {}
  return sh;
}

function crearHojaRuta(params) {
  // params: { spreadsheetId (opcional, si no crea/usa uno nuevo?), spreadsheetName, hojaNombre, fecha, conductor, filas }
  // Crea una hoja de ruta con el formato estándar y columnas de sistema.
  params = params || {};
  var targetSs;
  if (params.spreadsheetId) {
    targetSs = SpreadsheetApp.openById(params.spreadsheetId);
  } else if (params.createNewSpreadsheet) {
    var folderId = getConfig_('RUTAS_FOLDER_ID');
    targetSs = SpreadsheetApp.create(params.spreadsheetName || ('RUTAS_' + todayStr().replace(/-/g, '_')));
    if (folderId) {
      try {
        var file = DriveApp.getFileById(targetSs.getId());
        DriveApp.getFolderById(String(folderId)).addFile(file);
        DriveApp.getRootFolder().removeFile(file);
      } catch (e) {}
    }
  } else {
    throw new Error('Proporciona spreadsheetId o createNewSpreadsheet=true');
  }

  var hojaNombre = params.hojaNombre || ('RUTA_' + toDateStr(params.fecha || todayStr()));
  var sh = targetSs.getSheetByName(hojaNombre);
  if (!sh) sh = targetSs.insertSheet(hojaNombre);

  sh.clear();
  var title = 'RUTA DISTRIBUIDORA MUNDO ESCOLAR SAC';
  sh.getRange(1, 1).setValue(title);
  sh.getRange(2, 1).setValue('CONDUCTOR:');
  sh.getRange(2, 2).setValue(params.conductor || '');
  sh.getRange(2, 12).setValue(params.fecha ? new Date(toDateStr(params.fecha) + 'T00:00:00') : new Date());

  var headers = [
    'DIRECCION','CLIENTE','B.O. / S/.','A1 / S/.','A2 / S/.','A3 / S/.','TOT. B.','TOT. MONT.','VEND.','EFECT','YAP/TRNSF','OBSERVACION',
    'ID_CLIENTE','ID_ENTREGA','MONTO_COBRAR','EFECTIVO','YAPE','TRANSFERENCIA','TOTAL_PAGADO_HOY','SALDO_ENTREGA_HOY','DEUDA_GENERADA_HOY','VENCE_DEUDA',
    'COBRO_DEUDA_ANTERIOR','COBRO_DEUDA_EFECTIVO','COBRO_DEUDA_YAPE','COBRO_DEUDA_TRANSFERENCIA','DETALLE_COBRO_DEUDA','ESTADO_ENTREGA','ULTIMA_EDICION','EDITADO_POR','ID_DEUDA_GENERADA'
  ];
  sh.getRange(3, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(3);

  // Seed empty rows or provided filas
  var filas = params.filas || [];
  if (filas.length) {
    var values = filas.map(function (f, idx) {
      var row = new Array(headers.length).fill('');
      row[0] = f.direccion || ''; row[1] = f.cliente || ''; row[2] = f.bo || '';
      row[3] = f.a1 || ''; row[4] = f.a2 || ''; row[5] = f.a3 || '';
      row[6] = f.totB || ''; row[7] = f.totMont || ''; row[8] = f.vend || '';
      row[11] = f.observacion || '';
      row[12] = f.idCliente || '';
      row[13] = f.idEntrega || ('ENT_' + Utilities.getUuid().slice(0,8).toUpperCase());
      row[14] = toNum(f.montoCobrar || f.totMont);
      row[27] = f.estadoEntrega || 'PENDIENTE';
      return row;
    });
    sh.getRange(4, 1, values.length, headers.length).setValues(values);
  }

  // Basic formatting
  try { sh.autoResizeColumns(1, 12); } catch (e) {}

  return { ok: true, spreadsheetId: targetSs.getId(), spreadsheetUrl: targetSs.getUrl(), hoja: hojaNombre };
}

function indexarRutas() {
  // Escanea la carpeta de rutas configurada e indexa hojas que parezcan rutas y no estén en INDICE_RUTAS
  var folderId = String(getConfig_('RUTAS_FOLDER_ID') || '').trim();
  if (!folderId) throw new Error('Configura RUTAS_FOLDER_ID en CONFIG.');
  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  var master = getMaster_();
  var idx = getSheet_(master, 'INDICE_RUTAS');
  var existing = {};
  if (idx.getLastRow() >= 2) {
    var d = idx.getRange(2, 1, idx.getLastRow() - 1, 11).getValues();
    for (var i = 0; i < d.length; i++) {
      existing[String(d[i][4]) + '||' + String(d[i][6])] = true; // spreadsheetId||hoja
    }
  }
  var added = 0;
  while (files.hasNext()) {
    var f = files.next();
    var ss;
    try { ss = SpreadsheetApp.openById(f.getId()); } catch (e) { continue; }
    var sheets = ss.getSheets();
    for (var s = 0; s < sheets.length; s++) {
      var sh = sheets[s];
      var name = sh.getName();
      var key = ss.getId() + '||' + name;
      if (existing[key]) continue;
      // Detect route sheet: A2 contains CONDUCTOR or row3 has DIRECCION/CLIENTE headers
      var a2 = String(sh.getRange(2,1).getValue() || '').toUpperCase();
      var h1 = normalizeName(sh.getRange(3,1).getValue());
      var h2 = normalizeName(sh.getRange(3,2).getValue());
      if (a2.indexOf('CONDUCTOR') === -1 && !(h1.indexOf('DIRECCION') !== -1 && h2.indexOf('CLIENTE') !== -1)) continue;
      var conductor = String(sh.getRange(2,2).getValue() || '').trim();
      var fechaVal = sh.getRange(2,12).getValue();
      var fecha = toDateStr(fechaVal) || toDateStr(name) || '';
      var idRuta = 'RUTA_' + (fecha || 'SFD').replace(/-/g, '') + '_' + (normalizeName(conductor) || 'X').replace(/[^A-Z0-9]/g,'') + '_' + Utilities.getUuid().slice(0,4).toUpperCase();
      idx.appendRow([idRuta, fecha, conductor, '', ss.getId(), ss.getUrl(), name, 'ABIERTA', '', nowTs(), nowTs()]);
      existing[key] = true; added++;
    }
  }
  return { ok: true, added: added };
}