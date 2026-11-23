/**
 * API Web App - Mundo Escolar (Google Apps Script)
 * Acciones: ping, login, getRouteToday, getClientDebts, saveEntrega
 */

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  try {
    var params = mergeParams_(e);
    var action = String(params.action || '').trim();
    if (!action) return jsonResponse({ ok: false, error: 'Acción no especificada.' });

    var result;
    switch (action) {
      case 'ping':
        result = { ok: true, service: 'mundo-escolar-rutas', time: nowTs() };
        break;
      case 'login':
        var user = requireAuth_(params);
        result = { ok: true, usuario: user };
        break;
      case 'getRouteToday':
        result = getRouteToday(params);
        break;
      case 'listRoutes':
        result = listRoutes(params);
        break;
      case 'getRouteById':
        result = getRouteById(params);
        break;
      case 'getClientDebts':
        result = getClientDebts(params);
        break;
      case 'listDeudores':
        result = listDeudores(params);
        break;
      case 'finalizarRuta':
        var payloadFinal = params;
        if (params.payload && typeof params.payload === 'string') { try { payloadFinal = JSON.parse(params.payload); } catch (err) { payloadFinal = params; } }
        else if (params.payload && typeof params.payload === 'object') { payloadFinal = params.payload; if (!payloadFinal.pin && params.pin) payloadFinal.pin = params.pin; }
        result = finalizarRuta(payloadFinal);
        break;
      case 'cobrarDeudas':
        var payloadCobro = params;
        if (params.payload && typeof params.payload === 'string') { try { payloadCobro = JSON.parse(params.payload); } catch (err) { payloadCobro = params; } }
        else if (params.payload && typeof params.payload === 'object') { payloadCobro = params.payload; if (!payloadCobro.pin && params.pin) payloadCobro.pin = params.pin; }
        result = cobrarDeudas(payloadCobro);
        break;
      case 'saveEntrega':
        // payload may come nested in params
        var payload = params;
        if (params.payload && typeof params.payload === 'string') {
          try { payload = JSON.parse(params.payload); } catch (err) { payload = params; }
        } else if (params.payload && typeof params.payload === 'object') {
          payload = params.payload;
          // ensure pin carried over
          if (!payload.pin && params.pin) payload.pin = params.pin;
        }
        result = saveEntrega(payload);
        break;
      default:
        result = { ok: false, error: 'Acción no soportada: ' + action };
    }
    return jsonResponse(result);
  } catch (err) {
    var msg = (err && err.message) ? err.message : String(err);
    return jsonResponse({ ok: false, error: msg });
  }
}

function mergeParams_(e) {
  var params = {};
  // query params
  if (e && e.parameter) {
    Object.keys(e.parameter).forEach(function (k) {
      var v = e.parameter[k];
      // try parse JSON values for objects/arrays passed in query
      if (typeof v === 'string' && (v.charAt(0) === '{' || v.charAt(0) === '[')) {
        try { params[k] = JSON.parse(v); return; } catch (err) {}
      }
      params[k] = v;
    });
  }
  // post JSON body
  var body = safeJsonParse_(e);
  if (body && typeof body === 'object') {
    Object.keys(body).forEach(function (k) { params[k] = body[k]; });
  }
  return params;
}