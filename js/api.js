(function () {
  const cfg = () => window.APP_CONFIG || {};

  function getApiUrl() {
    const url = (cfg().API_URL || "").trim();
    if (!url) throw new Error("Configura API_URL en web/js/config.js");
    return url;
  }

  function toQuery(params) {
    const usp = new URLSearchParams();
    Object.keys(params || {}).forEach((k) => {
      const v = params[k];
      if (v === undefined || v === null) return;
      usp.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    });
    return usp.toString();
  }

  async function request(action, payload = {}, method = "POST") {
    const base = getApiUrl();
    const mode = (cfg().REQUEST_MODE || "auto").toLowerCase();

    // Prefer GET for simple actions or when forced, to reduce CORS/preflight issues in some deployments
    const preferGet = method === "GET" || mode === "get" || (mode === "auto" && ["ping", "login", "getRouteToday", "getClientDebts", "listDeudores", "listRoutes"].includes(action));

    if (preferGet) {
      const qs = toQuery({ action, ...payload });
      const url = base + (base.includes("?") ? "&" : "?") + qs;
      const res = await fetch(url, { method: "GET", redirect: "follow" });
      const text = await res.text();
      return parseResponse(text);
    }

    // POST: send as text/plain to avoid preflight where possible; Apps Script reads e.postData.contents
    const body = JSON.stringify({ action, ...payload });
    const res = await fetch(base, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body,
    });
    const text = await res.text();
    return parseResponse(text);
  }

  function parseResponse(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      // Some deployments may return HTML (error/login page) if misconfigured
      const snippet = (text || "").slice(0, 200);
      throw new Error("Respuesta no válida del API. Verifica la URL /exec y permisos. Detalle: " + snippet);
    }
  }

  const api = {
    ping: () => request("ping", {}, "GET"),
    login: (pin) => request("login", { pin }),
    getRouteToday: (params) => request("getRouteToday", params),
    getClientDebts: (params) => request("getClientDebts", typeof params === "string" ? { idCliente: params } : (params || {})),
    saveEntrega: (data) => request("saveEntrega", data),
    finalizarRuta: (data) => request("finalizarRuta", data),
    listDeudores: (params) => request("listDeudores", params),
    cobrarDeudas: (data) => request("cobrarDeudas", data),
  };

  window.API = api;
})();