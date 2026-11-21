/**
 * Utilidades generales - Mundo Escolar
 */

var ME = ME || {};
ME.TZ = 'America/Lima';

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function nowTs() {
  return Utilities.formatDate(new Date(), ME.TZ, 'yyyy-MM-dd HH:mm:ss');
}

function todayStr() {
  return Utilities.formatDate(new Date(), ME.TZ, 'yyyy-MM-dd');
}

function toDateStr(v) {
  if (!v && v !== 0) return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
    return Utilities.formatDate(v, ME.TZ, 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  if (!s) return '';
  // Try parse common formats
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  var d = new Date(s);
  if (!isNaN(d)) return Utilities.formatDate(d, ME.TZ, 'yyyy-MM-dd');
  return s;
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var s = String(v).trim();
  if (!s) return 0;
  // handle "2/270" format -> take amount after slash if present, else parse whole
  if (s.indexOf('/') !== -1) {
    // if format like bultos/monto, prefer the monetary part after last /
    var parts = s.split('/');
    s = parts[parts.length - 1];
  }
  s = s.replace(/[^0-9.,-]/g, '').replace(',', '.');
  var n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function normalizeName(s) {
  return String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function getMaster_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('MASTER_ID');
  if (id) return SpreadsheetApp.openById(id);
  // Fallback: if script is bound to master
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) return ss;
  } catch (e) {}
  throw new Error('MASTER_ID no configurado. Ejecuta setMasterId() o vincula el script al Maestro.');
}

function getSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('No se encontró la hoja: ' + name);
  return sh;
}

function getConfig_(key) {
  var ss = getMaster_();
  var sh = getSheet_(ss, 'CONFIG');
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === key) return data[i][1];
  }
  return '';
}

function setConfig_(key, value, desc) {
  var ss = getMaster_();
  var sh = getSheet_(ss, 'CONFIG');
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === key) {
      sh.getRange(i + 1, 2).setValue(value);
      if (desc !== undefined) sh.getRange(i + 1, 3).setValue(desc);
      return;
    }
  }
  sh.appendRow([key, value, desc || '']);
}

function nextId_(sheetName, colIndex1, prefix, pad) {
  var ss = getMaster_();
  var sh = getSheet_(ss, sheetName);
  var last = sh.getLastRow();
  var maxN = 0;
  if (last >= 2) {
    var vals = sh.getRange(2, colIndex1, last - 1, 1).getValues();
    var re = new RegExp('^' + prefix + '(\\d+)$');
    for (var i = 0; i < vals.length; i++) {
      var m = String(vals[i][0] || '').match(re);
      if (m) {
        var n = parseInt(m[1], 10);
        if (n > maxN) maxN = n;
      }
    }
  }
  var next = maxN + 1;
  var s = String(next);
  while (s.length < (pad || 6)) s = '0' + s;
  return prefix + s;
}

function findRowByValue_(sh, colIndex1, value) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var vals = sh.getRange(2, colIndex1, last - 1, 1).getValues();
  var target = String(value).trim();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === target) return i + 2;
  }
  return -1;
}

function headerMap_(sh, headerRow) {
  headerRow = headerRow || 3;
  var lastCol = sh.getLastColumn();
  if (lastCol < 1) return {};
  var headers = sh.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var h = normalizeName(headers[i]);
    if (h) map[h] = i + 1; // 1-based
  }
  return map;
}

function col_(map, names, fallback1) {
  for (var i = 0; i < names.length; i++) {
    var k = normalizeName(names[i]);
    if (map[k]) return map[k];
  }
  return fallback1;
}

function safeJsonParse_(e) {
  try {
    if (e && e.postData && e.postData.contents) {
      var c = e.postData.contents;
      // support urlencoded payload= or raw json
      if (c.indexOf('payload=') === 0) return JSON.parse(decodeURIComponent(c.substring(8)));
      return JSON.parse(c);
    }
  } catch (err) {}
  return null;
}

function requireAuth_(params) {
  var pin = String(params.pin || '').trim();
  if (!pin) throw new Error('PIN requerido.');
  var ss = getMaster_();
  var sh = getSheet_(ss, 'USUARIOS');
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rowPin = String(row[3] || '').trim(); // D PIN
    var activo = normalizeName(row[4]); // E ACTIVO
    if (rowPin === pin && (activo === 'SI' || activo === 'SÍ' || activo === 'YES' || activo === 'TRUE' || activo === '1')) {
      return {
        id: String(row[0] || ''),
        nombre: String(row[1] || ''),
        conductorHoja: String(row[2] || ''),
        rol: String(row[5] || 'REPARTIDOR'),
      };
    }
  }
  throw new Error('PIN inválido o usuario inactivo.');
}