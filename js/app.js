(function () {
  const { qs, qsa, showLoading, toast, money, num, esc, badgeEstado, todayISO } = window.UI;
  const API = window.API;

  const state = {
    session: null,
    route: null,
    entregas: [],
    current: null,
    debtsByClient: {},
    deudores: [],
    puedeCobrarDeudas: false,
    returnTo: "route",
    routeHistory: [],
    viewingHistory: false,
    activeRouteId: null,
    routeTotals: null,
  };

  function setView(name) {
    ["login", "route", "detail", "deudores"].forEach(v => qs(`#view-${v}`).classList.toggle("hidden", v !== name));
    const logged = !!state.session;
    qs("#btn-refresh").classList.toggle("hidden", !logged || name === "login");
    qs("#btn-deudores").classList.toggle("hidden", !logged || name === "login");
    qs("#btn-logout").classList.toggle("hidden", !logged);
  }

  function routeIsFinalizada() {
    return !!(state.route && ["FINALIZADA","CERRADA"].includes(String(state.route.estado || "").toUpperCase()));
  }

  function isViewingHistory() {
    return !!state.viewingHistory && !!state.route && !!state.activeRouteId && String(state.route.idRuta) !== String(state.activeRouteId);
  }

  const ROUTE_CACHE_KEY = "me_route_cache";
  function saveSession() {
    if (state.session) localStorage.setItem("me_session", JSON.stringify(state.session));
    else localStorage.removeItem("me_session");
  }
  function loadSession() {
    try { state.session = JSON.parse(localStorage.getItem("me_session") || "null"); } catch { state.session = null; }
    state.puedeCobrarDeudas = !!(state.session && state.session.usuario && state.session.usuario.puedeCobrarDeudas);
  }
  function saveRouteCache(res) {
    try { sessionStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify({ ts: Date.now(), res })); } catch(e) {}
  }
  function loadRouteCache() {
    try {
      const c = JSON.parse(sessionStorage.getItem(ROUTE_CACHE_KEY) || "null");
      if (!c || !c.res) return null;
      if (Date.now() - (c.ts || 0) > 10 * 60 * 1000) return null; // 10 min
      return c.res;
    } catch(e) { return null; }
  }

  async function handleLogin() {
    const pin = qs("#pin").value.trim();
    qs("#login-error").textContent = "";
    if (!pin) { qs("#login-error").textContent = "Ingresa tu PIN."; return; }
    try {
      showLoading(true);
      const res = await API.login(pin);
      if (!res || !res.ok) throw new Error(res && res.error || "PIN incorrecto o usuario inactivo.");
      state.session = { usuario: res.usuario, pin }; // PIN kept locally for simple auth; for mayor seguridad usar token emitido por backend
      state.puedeCobrarDeudas = !!(res.usuario && res.usuario.puedeCobrarDeudas);
      saveSession();
      await loadRoute();
    } catch (e) {
      qs("#login-error").textContent = e.message || String(e);
    } finally {
      showLoading(false);
    }
  }

  function logout() {
    state.session = null; state.route = null; state.entregas = []; state.current = null; state.debtsByClient = {}; state.deudores = []; state.puedeCobrarDeudas = false; state.returnTo = "route"; state.routeHistory = []; state.viewingHistory = false; state.activeRouteId = null; state.routeTotals = null;
    try { saveSession(); } catch (e) {}
    const pin = qs("#pin"); if (pin) pin.value = "";
    const hist = qs("#history-panel"); if (hist) hist.classList.add("hidden");
    const search = qs("#search"); if (search) search.value = "";
    const totals = qs("#route-totals"); if (totals) { totals.classList.add("hidden"); totals.innerHTML = ""; }
    qs("#subtitle").textContent = "Rutas y Cobranza";
    setView("login");
  }

  function applyRouteResponse(res, { silent } = {}) {
    state.route = res.ruta || null;
    state.entregas = Array.isArray(res.entregas) ? res.entregas : [];
    state.routeTotals = res.totales || null;
    if (res.deudasPorCliente) state.debtsByClient = { ...state.debtsByClient, ...res.deudasPorCliente };
    state.activeRouteId = state.route ? state.route.idRuta : null;
    state.viewingHistory = false;
    renderRoute();
    setView("route");
    if (silent) toast("Ruta actualizada");
  }

  async function loadRoute(opts = {}) {
    if (!state.session) return setView("login");
    const silent = !!opts.silent;
    const fecha = (window.APP_CONFIG.DEFAULT_DATE === "today" || !window.APP_CONFIG.DEFAULT_DATE) ? todayISO() : window.APP_CONFIG.DEFAULT_DATE;

    // Carga rápida: muestra cache de sesión mientras llega la red
    if (!silent) {
      const cached = loadRouteCache();
      if (cached && cached.ok) {
        applyRouteResponse(cached, {});
        showLoading(false); // ocultar spinner, refrescar en segundo plano
      } else {
        showLoading(true);
      }
    } else {
      qs("#subtitle").textContent = "Actualizando...";
    }

    try {
      const res = await API.getRouteToday({ pin: state.session.pin, fecha });
      if (!res || !res.ok) throw new Error(res && res.error || "No se pudo cargar la ruta.");
      saveRouteCache(res);
      applyRouteResponse(res, { silent });
    } catch (e) {
      if (!state.route) {
        toast(e.message || String(e), 4000);
        state.route = null; state.entregas = []; state.routeTotals = null;
        state.viewingHistory = false;
        renderRoute();
        setView("route");
      } else {
        toast("Sin conexión: mostrando últimos datos", 2500);
      }
    } finally {
      showLoading(false);
    }
  }

  function isNoEntregaEstado(est) {
    const e = String(est || "").toUpperCase();
    return e === "REPROGRAMADO" || e === "RECHAZADO";
  }

  function getRouteTotals() {
    const st = state.routeTotals || {};
    if (state.routeTotals) {
      const ef = num(st.efectivo), ya = num(st.yape), tr = num(st.transferencia);
      const cobroEf = num(st.cobroDeudaEfectivo), cobroYa = num(st.cobroDeudaYape), cobroTr = num(st.cobroDeudaTransferencia);
      return {
        bultos: roundMoney(num(st.bultos)), monto: roundMoney(num(st.monto)),
        ef: roundMoney(ef), ya: roundMoney(ya), tr: roundMoney(tr),
        cobroEf: roundMoney(cobroEf), cobroYa: roundMoney(cobroYa), cobroTr: roundMoney(cobroTr),
        entregasTotal: roundMoney(ef+ya+tr), cobroTotal: roundMoney(cobroEf+cobroYa+cobroTr),
        totalEf: roundMoney(ef+cobroEf), totalYa: roundMoney(ya+cobroYa), totalTr: roundMoney(tr+cobroTr),
        general: roundMoney(num(st.recaudadoTotal) || (ef+ya+tr+cobroEf+cobroYa+cobroTr))
      };
    }
    const t = { ef:0, ya:0, tr:0, cobroEf:0, cobroYa:0, cobroTr:0, bultos:0, monto:0 };
    state.entregas.forEach(e => {
      t.bultos += num(e.totB); t.monto += num(e.montoCobrar != null ? e.montoCobrar : e.totMont);
      t.ef += num(e.efectivo); t.ya += num(e.yape); t.tr += num(e.transferencia);
      t.cobroEf += num(e.cobroDeudaEfectivo); t.cobroYa += num(e.cobroDeudaYape); t.cobroTr += num(e.cobroDeudaTransferencia);
    });
    const r = (v) => roundMoney(v);
    t.bultos=r(t.bultos); t.monto=r(t.monto);
    t.ef=r(t.ef); t.ya=r(t.ya); t.tr=r(t.tr);
    t.cobroEf=r(t.cobroEf); t.cobroYa=r(t.cobroYa); t.cobroTr=r(t.cobroTr);
    t.entregasTotal = r(t.ef+t.ya+t.tr);
    t.cobroTotal = r(t.cobroEf+t.cobroYa+t.cobroTr);
    t.totalEf = r(t.ef+t.cobroEf); t.totalYa = r(t.ya+t.cobroYa); t.totalTr = r(t.tr+t.cobroTr);
    t.general = r(t.totalEf+t.totalYa+t.totalTr);
    return t;
  }

  function renderRouteTotals() {
    const box = qs("#route-totals");
    if (!box) return;
    if (!state.route) { box.classList.add("hidden"); box.innerHTML = ""; return; }
    const t = getRouteTotals();
    const finalizada = routeIsFinalizada();
    const viewing = isViewingHistory();
    box.classList.remove("hidden");
    box.innerHTML = `
      <div class="totals-title">${viewing ? "Resumen de lo recaudado (ruta anterior)" : (finalizada ? "Total recaudado (ruta finalizada)" : "Recaudado hasta ahora")}</div>
      <div class="totals-grid">
        <div class="totals-cell"><span class="k">Bultos totales</span><strong>${esc(roundMoney(t.bultos))}</strong></div>
        <div class="totals-cell"><span class="k">Efectivo</span><strong>${money(t.totalEf)}</strong></div>
        <div class="totals-cell"><span class="k">Yape</span><strong>${money(t.totalYa)}</strong></div>
        <div class="totals-cell"><span class="k">Transferencia</span><strong>${money(t.totalTr)}</strong></div>
        <div class="totals-cell total"><span class="k">TOTAL GENERAL</span><strong>${money(t.general)}</strong></div>
      </div>
      <div class="totals-sub">
        <span>Entregas: Efectivo ${money(t.ef)} · Yape ${money(t.ya)} · Transf. ${money(t.tr)} = <strong>${money(t.entregasTotal)}</strong></span>
        <span>Cobro deudas: Efectivo ${money(t.cobroEf)} · Yape ${money(t.cobroYa)} · Transf. ${money(t.cobroTr)} = <strong>${money(t.cobroTotal)}</strong></span>
      </div>`;
  }

  function renderRoute() {
    const r = state.route;
    qs("#route-conductor").textContent = r ? (r.conductor || state.session.usuario.nombre || "-") : (state.session.usuario.nombre || "-");
    qs("#route-fecha").textContent = r ? (r.fecha || todayISO()) : todayISO();
    qs("#route-hoja").textContent = r ? `${r.hoja || ""} (${r.idRuta || ""})` : "No tienes una ruta asignada para hoy. Si crees que es un error, contacta a oficina.";
    const finalizada = routeIsFinalizada();
    const viewingHistory = isViewingHistory();
    qs("#subtitle").textContent = r ? (viewingHistory ? "Ruta anterior (solo lectura)" : (finalizada ? "Ruta finalizada" : "Ruta del día")) : "Sin ruta";
    const st = qs("#route-status");
    if (st) {
      if (viewingHistory) st.textContent = "Estás viendo una ruta anterior en modo solo consulta. No se pueden hacer modificaciones.";
      else if (finalizada) st.textContent = "Ruta finalizada: ya no puedes modificar cobros de entregas. Solo queda disponible la consulta/cobro de deudores (si estás autorizado).";
      else st.textContent = "";
    }
    const btnFin = qs("#btn-finalizar-ruta");
    if (btnFin) {
      btnFin.disabled = !r || finalizada || viewingHistory;
      btnFin.textContent = viewingHistory ? "Solo lectura" : (finalizada ? "Ruta finalizada" : "Finalizar ruta");
    }

    const total = state.entregas.length;
    const pagados = state.entregas.filter(e => ["PAGADO","ENTREGADO"].includes((e.estadoEntrega||"").toUpperCase())).length;
    const creditos = state.entregas.filter(e => ["CREDITO","PARCIAL"].includes((e.estadoEntrega||"").toUpperCase())).length;
    const reprogramados = state.entregas.filter(e => String(e.estadoEntrega||"").toUpperCase() === "REPROGRAMADO").length;
    const rechazados = state.entregas.filter(e => String(e.estadoEntrega||"").toUpperCase() === "RECHAZADO").length;
    const pendientes = Math.max(0, total - pagados - creditos - reprogramados - rechazados);
    qs("#route-summary").innerHTML = `
      <span class="pill">Entregas: ${total}</span>
      <span class="pill">Pagadas: ${pagados}</span>
      <span class="pill">Crédito/Parcial: ${creditos}</span>
      <span class="pill">Reprogramadas: ${reprogramados}</span>
      <span class="pill">Rechazadas: ${rechazados}</span>
      <span class="pill">Pendientes: ${pendientes}</span>`;

    renderRouteTotals();
    renderList();
  }

  function renderList() {
    const q = (qs("#search").value || "").toLowerCase().trim();
    const items = state.entregas.filter(e => {
      if (!q) return true;
      return `${e.cliente||""} ${e.direccion||""}`.toLowerCase().includes(q);
    });
    const list = qs("#route-list");
    const empty = qs("#route-empty");
    if (empty) {
      if (items.length === 0) {
        empty.textContent = state.entregas.length === 0 ? "Hoy no se te asignaron entregas." : "No hay resultados para tu búsqueda.";
        empty.classList.remove("hidden");
      } else {
        empty.classList.add("hidden");
      }
    }
    list.innerHTML = items.map(e => {
      const monto = e.montoCobrar != null ? e.montoCobrar : e.totMont;
      const pagado = e.totalPagadoHoy != null ? e.totalPagadoHoy : 0;
      const saldoCliente = (state.debtsByClient[e.idCliente] && state.debtsByClient[e.idCliente].saldoTotal) || e.saldoPendienteCliente || 0;
      const bultos = e.totB != null && e.totB !== "" ? roundMoney(num(e.totB)) : null;
      return `<div class="item" data-id="${esc(e.idEntrega || e.row)}">
        <div class="item-head">
          <div>
            <div class="item-name">${esc(e.cliente || "(Sin cliente)")}</div>
            <div class="item-addr">${esc(e.direccion || "")}</div>
          </div>
          ${badgeEstado(e.estadoEntrega || "PENDIENTE")}
        </div>
        <div class="item-meta">
          <div><span class="label">Cobrar:</span> <strong>${money(monto)}</strong></div>
          ${bultos !== null ? `<div><span class="label">Bultos:</span> <strong>${esc(bultos)}</strong></div>` : ""}
          <div><span class="label">Pagado hoy:</span> <strong>${money(pagado)}</strong></div>
          ${saldoCliente > 0 ? `<div><span class="label">Deuda cliente:</span> <strong>${money(saldoCliente)}</strong></div>` : ""}
        </div>
        <div class="item-actions"><button class="btn btn-primary" data-open="${esc(e.idEntrega || e.row)}">${routeIsFinalizada() ? "Ver" : "Abrir"}</button></div>
      </div>`;
    }).join("");

    qsa("[data-open]", list).forEach(btn => btn.addEventListener("click", () => openDetail(btn.getAttribute("data-open"), "route")));
  }

  function findEntrega(id) {
    return state.entregas.find(e => String(e.idEntrega || e.row) === String(id));
  }

  function applyDetailMode() {
    const isDebtMode = state.returnTo === "deudores";
    const routeReadOnly = isViewingHistory() && !isDebtMode;
    const locked = (routeIsFinalizada() || routeReadOnly) && !isDebtMode;
    const canDebt = !!state.puedeCobrarDeudas && !routeReadOnly;
    const est = String(qs("#estado-entrega")?.value || "PENDIENTE").toUpperCase();
    const noEntrega = isNoEntregaEstado(est);

    qs("#pago-card").classList.toggle("hidden", isDebtMode);
    qs("#credito-card").classList.toggle("hidden", isDebtMode || noEntrega);
    qs("#obs-card").classList.toggle("hidden", isDebtMode);
    qs("#debts-card").classList.toggle("hidden", isDebtMode);
    qs("#detail-monto-wrap").classList.toggle("hidden", isDebtMode);
    qs("#detail-bultos-wrap").classList.toggle("hidden", isDebtMode);
    qs("#detail-estado-wrap").classList.toggle("hidden", isDebtMode);

    qs("#cobro-deuda-card").classList.remove("hidden");
    qs("#cobro-title").textContent = isDebtMode ? "Abonar deuda" : "Cobro de deudas anteriores";
    qs("#cobro-subtitle").textContent = routeReadOnly
      ? "Ruta anterior en solo lectura. No se pueden registrar cobros ni modificar datos."
      : (isDebtMode
        ? "Ingresa el pago y la app lo reparte automáticamente a las deudas más antiguas. Puedes ajustar un monto manualmente."
        : "Ingresa el pago (Efectivo/Yape/Transferencia). Se reparte automáticamente a las deudas más antiguas; puedes ajustar montos manualmente.");
    qs("#btn-save").textContent = isDebtMode ? "Registrar cobro de deuda" : (routeReadOnly ? "Solo lectura" : (routeIsFinalizada() ? "Ruta finalizada" : "Guardar y sincronizar"));
    qs("#btn-save").disabled = isDebtMode ? !canDebt : locked;
    qs("#cobro-no-deudas").classList.add("hidden");
    qs("#cobro-deuda-body").classList.remove("hidden");

    const payDisabled = (!isDebtMode && locked) || (!isDebtMode && noEntrega);
    ["p-efectivo","p-yape","p-transferencia","p-recibido","genera-deuda","vence-deuda"].forEach(id => {
      const el = qs(`#${id}`); if (el) el.disabled = payDisabled;
    });
    ["estado-entrega","observacion"].forEach(id => {
      const el = qs(`#${id}`); if (el) el.disabled = !isDebtMode && locked;
    });
    ["cd-efectivo","cd-yape","cd-transferencia","cd-recibido"].forEach(id => {
      const el = qs(`#${id}`); if (el) el.disabled = !canDebt || (routeReadOnly && isDebtMode);
    });
  }

  async function openDetail(id, from = "route") {
    const e = findEntrega(id);
    if (!e) return;
    state.current = e;
    state.returnTo = from;
    qs("#detail-cliente").textContent = e.cliente || "(Sin cliente)";
    qs("#detail-meta").textContent = `${e.direccion || ""}${e.vend ? " · Vend: " + e.vend : ""} · ID Cliente: ${e.idCliente || "-"}`;
    const monto = e.montoCobrar != null ? e.montoCobrar : e.totMont;
    qs("#detail-monto").textContent = money(monto);
    const bultosWrap = qs("#detail-bultos-wrap");
    if (bultosWrap) bultosWrap.classList.toggle("hidden", state.returnTo === "deudores");
    const bultosEl = qs("#detail-bultos");
    if (bultosEl) bultosEl.textContent = (e.totB != null && e.totB !== "") ? String(roundMoney(num(e.totB))) : "-";
    qs("#detail-estado").innerHTML = badgeEstado(e.estadoEntrega || "PENDIENTE");

    qs("#p-efectivo").value = e.efectivo != null ? e.efectivo : "";
    qs("#p-yape").value = e.yape != null ? e.yape : "";
    qs("#p-transferencia").value = e.transferencia != null ? e.transferencia : "";
    qs("#p-recibido").value = "";
    qs("#observacion").value = e.observacion || "";
    qs("#estado-entrega").value = (e.estadoEntrega || "PENDIENTE").toUpperCase();
    qs("#vence-deuda").value = e.venceDeuda || "";
    qs("#genera-deuda").checked = !!(e.deudaGeneradaHoy && Number(e.deudaGeneradaHoy) > 0) || (e.estadoEntrega || "").toUpperCase() === "CREDITO";
    qs("#cd-efectivo").value = e.cobroDeudaEfectivo || "";
    qs("#cd-yape").value = e.cobroDeudaYape || "";
    qs("#cd-transferencia").value = e.cobroDeudaTransferencia || "";
    qs("#cd-recibido").value = "";
    qs("#save-msg").textContent = ""; qs("#save-msg").className = "msg";

    applyDetailMode();
    updateCalcs();
    setView("detail");
    await loadDebtsForCurrent();
  }

  async function finalizarRutaActual() {
    if (!state.route) return;
    const t = getRouteTotals();
    const resumen = `Efectivo: ${money(t.totalEf)}\nYape: ${money(t.totalYa)}\nTransferencia: ${money(t.totalTr)}\nTOTAL GENERAL: ${money(t.general)}`;
    if (!confirm(`¿Finalizar la ruta?\n\nTotal recaudado:\n${resumen}\n\nDespués de finalizar no podrás modificar cobros de entregas.`)) return;
    try {
      showLoading(true);
      const res = await API.finalizarRuta({ pin: state.session.pin, ruta: { idRuta: state.route.idRuta } });
      if (!res || !res.ok) throw new Error(res && res.error || "No se pudo finalizar la ruta.");
      toast(`Ruta finalizada. Total: ${money(t.general)}`, 4000);
      await loadRoute();
    } catch (e) {
      toast(e.message || String(e), 4000);
    } finally { showLoading(false); }
  }

  async function loadDeudores() {
    if (!state.session) return;
    const msg = qs("#deudores-status");
    msg.textContent = "Cargando deudores..."; msg.className = "msg muted";
    setView("deudores");
    try {
      const res = await API.listDeudores({ pin: state.session.pin });
      if (!res || !res.ok) throw new Error(res && res.error || "No se pudieron cargar los deudores.");
      state.deudores = Array.isArray(res.deudores) ? res.deudores : [];
      state.puedeCobrarDeudas = !!res.puedeCobrarDeudas;
      renderDeudores();
    } catch (e) {
      msg.textContent = e.message || String(e); msg.className = "msg err";
      toast(e.message || String(e), 4000);
    }
  }

  function renderDeudores() {
    const q = (qs("#search-deudores").value || "").toLowerCase().trim();
    const items = state.deudores.filter(d => !q || `${d.clienteNombre||""} ${d.idCliente||""} ${d.direccion||""}`.toLowerCase().includes(q));
    qs("#deudores-empty").classList.toggle("hidden", items.length !== 0);
    const can = state.puedeCobrarDeudas;
    qs("#deudores-status").textContent = can ? "Autorizado para cobrar deudas." : "Solo consulta: no tienes autorización para cobrar deudas.";
    qs("#deudores-status").className = "msg " + (can ? "ok" : "err");
    qs("#deudores-list").innerHTML = items.map(d => `
      <div class="item">
        <div class="item-head">
          <div>
            <div class="item-name">${esc(d.clienteNombre || d.idCliente)}</div>
            <div class="item-addr">${esc(d.direccion || d.zona || "")} · ID: ${esc(d.idCliente || "-")}</div>
          </div>
          <span class="badge st-CREDITO">${money(d.saldoTotal)}</span>
        </div>
        <div class="item-meta"><div><span class="label">Deudas:</span> <strong>${(d.deudas||[]).length}</strong></div></div>
        <div class="item-actions"><button class="btn ${can ? "btn-primary":"btn-light"}" data-deudor="${esc(d.idCliente)}">${can ? "Cobrar" : "Ver"}</button></div>
      </div>`).join("");
    qsa("[data-deudor]").forEach(btn => btn.addEventListener("click", () => openDeudor(btn.getAttribute("data-deudor"))));
  }

  // Deudas se precargan en getRouteToday (deudasPorCliente); no se hace prefetch extra por cliente.

  async function openDeudor(idCliente) {
    const d = state.deudores.find(x => String(x.idCliente) === String(idCliente));
    if (!d) return;
    state.current = { idEntrega: "DEUDA_"+idCliente, row: 0, idCliente: d.idCliente, cliente: d.clienteNombre, direccion: d.direccion || d.zona || "", montoCobrar: 0, estadoEntrega: "PENDIENTE", observacion: "" };
    state.returnTo = "deudores";
    qs("#detail-cliente").textContent = d.clienteNombre || d.idCliente;
    qs("#detail-meta").textContent = `${d.direccion || d.zona || ""}${d.direccion || d.zona ? " · " : ""}ID: ${d.idCliente} · Saldo pendiente: ${money(d.saldoTotal)}`;
    qs("#detail-monto").textContent = money(0);
    qs("#detail-estado").innerHTML = badgeEstado("CREDITO");
    ["p-efectivo","p-yape","p-transferencia","p-efectivo-recibido","cd-efectivo","cd-yape","cd-transferencia","cd-efectivo-recibido"].forEach(id => { const el = qs("#"+id); if (el) el.value = ""; });
    qs("#observacion").value = ""; qs("#estado-entrega").value = "PENDIENTE"; qs("#vence-deuda").value = ""; qs("#genera-deuda").checked = false;
    qs("#save-msg").textContent = ""; qs("#save-msg").className = "msg";
    state.debtsByClient[d.idCliente] = { saldoTotal: d.saldoTotal, items: d.deudas || [] };
    applyDetailMode();
    renderDebts(state.debtsByClient[d.idCliente]);
    updateCalcs();
    setView("detail");
  }

  async function loadDebtsForCurrent() {
    const e = state.current;
    if (!e || !e.idCliente) {
      qs("#debts-list").textContent = "Cliente sin ID_CLIENTE; no se pueden asociar deudas.";
      qs("#cobro-deudas-list").textContent = "Sin deudas pendientes.";
      return;
    }
    let data = state.debtsByClient[e.idCliente];
    if (data && data.items) {
      renderDebts(data); // muestra cache inmediato, sin spinner
      return;
    }
    qs("#debts-list").textContent = "Cargando...";
    qs("#cobro-deudas-list").textContent = "Cargando...";
    try {
      const res = await API.getClientDebts({ pin: state.session.pin, idCliente: e.idCliente });
      data = (res && res.ok) ? { saldoTotal: res.saldoTotal || 0, items: res.deudas || [] } : { saldoTotal: 0, items: [] };
      state.debtsByClient[e.idCliente] = data;
      renderDebts(data);
    } catch (err) {
      qs("#debts-list").textContent = "No se pudieron cargar las deudas.";
      qs("#cobro-deudas-list").textContent = "No se pudieron cargar las deudas.";
    }
  }

  function roundMoney(v){ return Math.round((num(v) + Number.EPSILON) * 100) / 100; }

  function autoAllocateDebts() {
    const inputs = qsa(".cd-monto");
    if (!inputs.length) return;
    const total = roundMoney(num(qs("#cd-efectivo").value) + num(qs("#cd-yape").value) + num(qs("#cd-transferencia").value));
    // Respetar montos manuales; repartir el resto en orden (más antiguo primero)
    let manualSum = 0;
    const autoInputs = [];
    inputs.forEach(inp => {
      const max = num(inp.getAttribute("data-max"));
      if (inp.dataset.manual === "1") {
        let v = roundMoney(num(inp.value));
        if (v > max) v = max;
        if (v < 0) v = 0;
        inp.value = v > 0 ? v.toFixed(2) : "";
        const ch = qs(`.cd-sel[data-id="${inp.getAttribute("data-id")}"]`);
        if (ch) ch.checked = v > 0;
        manualSum = roundMoney(manualSum + v);
      } else {
        autoInputs.push(inp);
      }
    });
    let remaining = Math.max(0, roundMoney(total - manualSum));
    autoInputs.forEach(inp => {
      const max = num(inp.getAttribute("data-max"));
      const v = roundMoney(Math.min(max, remaining));
      inp.value = v > 0 ? v.toFixed(2) : "";
      const ch = qs(`.cd-sel[data-id="${inp.getAttribute("data-id")}"]`);
      if (ch) ch.checked = v > 0;
      remaining = roundMoney(remaining - v);
    });
  }

  function renderDebts(data) {
    const items = (data && data.items || []).filter(d => Number(d.saldoPendiente || 0) > 0);
    const isDebtMode = state.returnTo === "deudores";
    const routeReadOnly = isViewingHistory() && !isDebtMode;
    const canDebt = !!state.puedeCobrarDeudas && !routeReadOnly;
    const disabled = !canDebt;
    const noDebtMsg = qs("#cobro-no-deudas");
    const debtBody = qs("#cobro-deuda-body");
    const debtStatus = qs("#debt-status-msg");
    const saldoTotal = roundMoney(items.reduce((a,b)=>a + num(b.saldoPendiente), 0));

    if (!items.length) {
      if (debtStatus) {
        debtStatus.className = "debt-alert ok";
        debtStatus.innerHTML = `CLIENTE NO REGISTRA DEUDAS PENDIENTES<span class="sub">Saldo pendiente: ${money(0)}</span>`;
      }
      qs("#debts-list").innerHTML = `<span class="muted">No hay deudas anteriores registradas.</span>`;
      qs("#cobro-deudas-list").innerHTML = `<span class="muted">Sin deudas pendientes.</span>`;
      ["cd-efectivo","cd-yape","cd-transferencia","cd-recibido"].forEach(id => { const el = qs("#"+id); if (el) el.value = ""; });
      qs("#calc-cobro-deuda").textContent = money(0);
      if (noDebtMsg) { noDebtMsg.classList.toggle("hidden", isDebtMode); noDebtMsg.textContent = "CLIENTE NO REGISTRA DEUDAS PENDIENTES"; }
      if (debtBody) debtBody.classList.toggle("hidden", !isDebtMode);
      return;
    }

    if (debtStatus) {
      debtStatus.className = "debt-alert err";
      debtStatus.innerHTML = `CLIENTE CON DEUDA PENDIENTE<span class="sub">Saldo pendiente total: ${money(saldoTotal)} · ${items.length} deuda(s)</span>`;
    }
    if (noDebtMsg) noDebtMsg.classList.add("hidden");
    if (debtBody) debtBody.classList.remove("hidden");

    qs("#debts-list").innerHTML = items.map(d => `
      <div class="debt-row">
        <div class="row1"><strong>${esc(d.idDeuda || "Deuda")}</strong><strong class="error">${money(d.saldoPendiente)}</strong></div>
        <div class="row2">Origen: ${esc(d.fechaOrigen || "-")} · Vence: ${esc(d.fechaVencimiento || "-")} · Estado: ${esc(d.estado || "-")}</div>
      </div>`).join("") + `<div class="mt"><strong>Saldo total pendiente: ${money(saldoTotal)}</strong></div>`;

    qs("#cobro-deudas-list").innerHTML = items.map(d => `
      <div class="debt-row" data-deuda="${esc(d.idDeuda)}">
        <div class="row1"><strong>Deuda ${esc(d.idDeuda)}</strong><span class="badge st-CREDITO" id="cd-badge-${esc(d.idDeuda)}">Saldo: ${money(d.saldoPendiente)}</span></div>
        <div class="row2">Vence: ${esc(d.fechaVencimiento || "-")}</div>
        <div class="debt-pay">
          <label class="check"><input type="checkbox" class="cd-sel" data-id="${esc(d.idDeuda)}" ${disabled ? "disabled" : ""} /> Abonar</label>
          <input type="number" step="0.01" min="0" max="${esc(d.saldoPendiente)}" class="cd-monto" data-id="${esc(d.idDeuda)}" data-max="${esc(d.saldoPendiente)}" placeholder="Monto" ${disabled ? "disabled" : ""} />
        </div>
        <div class="debt-live" id="cd-live-${esc(d.idDeuda)}">
          <div>Abonando: <strong id="cd-abonando-${esc(d.idDeuda)}">S/ 0.00</strong></div>
          <div>Saldo restante: <strong id="cd-restante-${esc(d.idDeuda)}" class="text-danger">${money(d.saldoPendiente)}</strong></div>
        </div>
      </div>`).join("");

    qsa(".cd-sel").forEach(ch => ch.addEventListener("change", (e) => {
      const id = e.target.getAttribute("data-id");
      const inp = qs(`.cd-monto[data-id="${id}"]`);
      if (!inp) return;
      inp.dataset.manual = "1";
      if (e.target.checked && !inp.value) inp.value = inp.getAttribute("data-max") || "";
      if (!e.target.checked) inp.value = "";
      updateCalcs();
    }));
    qsa(".cd-monto").forEach(inp => inp.addEventListener("input", (e) => {
      const id = e.target.getAttribute("data-id");
      const ch = qs(`.cd-sel[data-id="${id}"]`);
      const max = num(e.target.getAttribute("data-max"));
      let v = num(e.target.value);
      if (v > max) { v = max; e.target.value = max; }
      if (ch) ch.checked = v > 0;
      e.target.dataset.manual = "1"; // edición manual: se respeta en el autorreparto
      updateCalcs();
    }));
    updateCalcs();
  }

  function updateCalcs() {
    const e = state.current || {};
    const est = String(qs("#estado-entrega")?.value || "PENDIENTE").toUpperCase();
    const noEntrega = isNoEntregaEstado(est);
    if (noEntrega) {
      ["p-efectivo","p-yape","p-transferencia","p-recibido"].forEach(id => { const el = qs(`#${id}`); if (el) el.value = ""; });
      const gd = qs("#genera-deuda"); if (gd) gd.checked = false;
      const vd = qs("#vence-deuda"); if (vd) vd.value = "";
    }
    const monto = roundMoney(num(e.montoCobrar != null ? e.montoCobrar : e.totMont));
    const ef = num(qs("#p-efectivo").value);
    const ya = num(qs("#p-yape").value);
    const tr = num(qs("#p-transferencia").value);
    const total = roundMoney(ef + ya + tr);
    const saldo = noEntrega ? 0 : Math.max(0, roundMoney(monto - total));

    const calcMonto = qs("#calc-monto");
    if (calcMonto) calcMonto.textContent = money(monto);
    qs("#calc-total").textContent = money(total);
    const saldoEl = qs("#calc-saldo");
    saldoEl.textContent = money(saldo);
    saldoEl.className = saldo > 0 ? "text-danger" : "text-success";

    const recibido = num(qs("#p-recibido") && qs("#p-recibido").value);
    const vueltoWrap = qs("#calc-vuelto-wrap");
    if (vueltoWrap) {
      const cambioPorSobrepago = Math.max(0, roundMoney(total - monto));
      const showVuelto = recibido > 0 || cambioPorSobrepago > 0;
      const base = recibido > 0 ? recibido : total;
      const vuelto = roundMoney(base - monto);
      vueltoWrap.classList.toggle("hidden", !showVuelto);
      if (vuelto >= 0) {
        vueltoWrap.className = "text-success";
        vueltoWrap.innerHTML = `Cambio a devolver: <strong id="calc-vuelto">${money(vuelto)}</strong>`;
      } else {
        vueltoWrap.className = "text-danger";
        vueltoWrap.innerHTML = `Falta completar el efectivo: <strong id="calc-vuelto">${money(Math.abs(vuelto))}</strong>`;
      }
    }

    qs("#credito-fields").classList.toggle("hidden", !(qs("#genera-deuda").checked && saldo > 0 && !noEntrega));
    if (saldo <= 0 || noEntrega) { const gd = qs("#genera-deuda"); if (gd) gd.checked = false; }

    const cdEf = num(qs("#cd-efectivo").value);
    const cdYa = num(qs("#cd-yape").value);
    const cdTr = num(qs("#cd-transferencia").value);
    const cobro = roundMoney(cdEf + cdYa + cdTr);

    // Autorreparto: el pago se distribuye a deudas más antiguas; montos manuales se respetan
    autoAllocateDebts();

    const cdMontoInputs = qsa(".cd-monto");
    let selTotal = 0;
    cdMontoInputs.forEach(inp => {
      const id = inp.getAttribute("data-id");
      const max = num(inp.getAttribute("data-max"));
      const v = roundMoney(num(inp.value));
      selTotal = roundMoney(selTotal + v);
      const restante = Math.max(0, roundMoney(max - v));
      const abonandoEl = qs(`#cd-abonando-${id}`);
      const restanteEl = qs(`#cd-restante-${id}`);
      const badgeEl = qs(`#cd-badge-${id}`);
      if (abonandoEl) abonandoEl.textContent = money(v);
      if (restanteEl) { restanteEl.textContent = money(restante); restanteEl.className = restante > 0 ? "text-danger" : "text-success"; }
      if (badgeEl) badgeEl.textContent = `Saldo: ${money(restante)}`;
    });

    const refAbono = selTotal > 0 ? selTotal : cobro; // base para cambio cuando falta asignar monto en deuda
    const faltaCuadrar = Math.max(0, roundMoney(selTotal - cobro));
    const exceso = Math.max(0, roundMoney(cobro - selTotal));
    const selEl = qs("#calc-deuda-seleccionado");
    if (selEl) selEl.textContent = money(selTotal);
    qs("#calc-cobro-deuda").textContent = money(cobro);
    const faltaEl = qs("#calc-deuda-falta");
    if (faltaEl) {
      if (selTotal > 0 && exceso > 0) {
        faltaEl.textContent = `Exceso: ${money(exceso)}`;
        faltaEl.className = "text-danger";
      } else {
        faltaEl.textContent = money(faltaCuadrar);
        faltaEl.className = faltaCuadrar > 0 ? "text-danger" : "text-success";
      }
    }

    const cdRecibido = num(qs("#cd-recibido") && qs("#cd-recibido").value);
    const cdVueltoWrap = qs("#calc-deuda-vuelto-wrap");
    if (cdVueltoWrap) {
      const baseAbono = selTotal > 0 ? selTotal : cobro;
      const cambioPorSobrepago = selTotal > 0 ? Math.max(0, roundMoney(cobro - selTotal)) : 0;
      const show = cdRecibido > 0 || cambioPorSobrepago > 0;
      const base = cdRecibido > 0 ? cdRecibido : cobro;
      const vuelto = roundMoney(base - baseAbono);
      cdVueltoWrap.classList.toggle("hidden", !show);
      if (vuelto >= 0) {
        cdVueltoWrap.className = "text-success";
        cdVueltoWrap.innerHTML = `Cambio a devolver: <strong id="calc-deuda-vuelto">${money(vuelto)}</strong>`;
      } else {
        cdVueltoWrap.className = "text-danger";
        cdVueltoWrap.innerHTML = `Falta completar el efectivo: <strong id="calc-deuda-vuelto">${money(Math.abs(vuelto))}</strong>`;
      }
    }
  }

  async function saveCurrent() {
    const e = state.current; const r = state.route;
    if (!e) return;
    if (state.returnTo !== "deudores" && !r) return;
    const msg = qs("#save-msg"); msg.textContent = ""; msg.className = "msg";
    if (isViewingHistory() && state.returnTo !== "deudores") {
      msg.textContent = "Estás viendo una ruta anterior en solo lectura."; msg.classList.add("err"); return;
    }
    if (routeIsFinalizada() && state.returnTo !== "deudores") {
      msg.textContent = "La ruta está finalizada. No se pueden modificar cobros de entregas."; msg.classList.add("err"); return;
    }
    const estadoEntrega = String(qs("#estado-entrega").value || "PENDIENTE").toUpperCase();
    const noEntrega = isNoEntregaEstado(estadoEntrega);
    const monto = num(e.montoCobrar != null ? e.montoCobrar : e.totMont);
    const pago = noEntrega
      ? { efectivo: 0, yape: 0, transferencia: 0 }
      : { efectivo: num(qs("#p-efectivo").value), yape: num(qs("#p-yape").value), transferencia: num(qs("#p-transferencia").value) };
    const totalPagado = +(pago.efectivo + pago.yape + pago.transferencia).toFixed(2);
    const saldo = noEntrega ? 0 : Math.max(0, +(monto - totalPagado).toFixed(2));
    const generaDeuda = !noEntrega && qs("#genera-deuda").checked && saldo > 0;
    const vence = qs("#vence-deuda").value;
    if (noEntrega && !String(qs("#observacion").value || "").trim()) {
      msg.textContent = estadoEntrega === "REPROGRAMADO" ? "Indica el motivo/fecha acordada para reprogramar." : "Indica el motivo por el que el cliente rechazó el pedido.";
      msg.classList.add("err"); return;
    }
    if (generaDeuda && !vence) { msg.textContent = "Selecciona la fecha de vencimiento para la deuda."; msg.classList.add("err"); return; }

    // cobro deudas: toma montos ingresados (no depende solo del checkbox)
    const seleccion = qsa(".cd-monto").map(input => {
      const idDeuda = input.getAttribute("data-id");
      const max = num(input.getAttribute("data-max"));
      let montoAbono = roundMoney(num(input.value));
      if (montoAbono > max) montoAbono = max;
      return { idDeuda, monto: +montoAbono.toFixed(2) };
    }).filter(x => x.monto > 0);
    const totalAbonoSel = +seleccion.reduce((a,b)=>a+b.monto,0).toFixed(2);
    const cobroMet = { efectivo: num(qs("#cd-efectivo").value), yape: num(qs("#cd-yape").value), transferencia: num(qs("#cd-transferencia").value) };
    const totalCobroMet = +(cobroMet.efectivo + cobroMet.yape + cobroMet.transferencia).toFixed(2);
    if (totalAbonoSel > 0 && !state.puedeCobrarDeudas) {
      msg.textContent = "No tienes autorización para cobrar deudas. Solicita autorización al administrador."; msg.classList.add("err"); return;
    }
    if (totalAbonoSel > 0 && Math.abs(totalCobroMet - totalAbonoSel) > 0.01) {
      msg.textContent = `El desglose del cobro de deudas (${money(totalCobroMet)}) debe ser igual al total a abonar (${money(totalAbonoSel)}).`;
      msg.classList.add("err"); return;
    }

    if (state.returnTo === "deudores") {
      if (totalAbonoSel <= 0) { msg.textContent = "Selecciona al menos una deuda para abonar."; msg.classList.add("err"); return; }
      try {
        showLoading(true); qs("#btn-save").disabled = true;
        const res = await API.cobrarDeudas({
          pin: state.session.pin,
          idCliente: e.idCliente,
          clienteNombre: e.cliente,
          cobroDeudas: seleccion,
          cobroDeudasMetodos: cobroMet,
          idRuta: state.route ? state.route.idRuta : ""
        });
        if (!res || !res.ok) throw new Error(res && res.error || "No se pudo registrar el cobro de deuda.");
        msg.textContent = "Cobro de deuda registrado correctamente."; msg.classList.add("ok");
        toast("Cobro registrado");
        await loadDeudores();
        setView("deudores");
      } catch (err) {
        msg.textContent = err.message || String(err); msg.classList.add("err");
      } finally {
        qs("#btn-save").disabled = (state.returnTo === "deudores") ? (!state.puedeCobrarDeudas || isViewingHistory()) : (routeIsFinalizada() || isViewingHistory());
        showLoading(false);
      }
      return;
    }

    const payload = {
      pin: state.session.pin,
      idUsuario: state.session.usuario.id,
      usuarioNombre: state.session.usuario.nombre,
      ruta: { idRuta: r.idRuta, spreadsheetId: r.spreadsheetId, hoja: r.hoja, fecha: r.fecha, conductor: r.conductor },
      entrega: {
        idEntrega: e.idEntrega,
        row: e.row,
        idCliente: e.idCliente || "",
        cliente: e.cliente || "",
        montoCobrar: monto,
      },
      pagoHoy: pago,
      totalPagadoHoy: totalPagado,
      generaDeuda: generaDeuda,
      deudaNueva: generaDeuda ? { monto: saldo, vencimiento: vence } : null,
      cobroDeudas: seleccion,
      cobroDeudasMetodos: cobroMet,
      estadoEntrega: estadoEntrega,
      observacion: qs("#observacion").value || ""
    };

    try {
      showLoading(true);
      qs("#btn-save").disabled = true;
      const res = await API.saveEntrega(payload);
      if (!res || !res.ok) throw new Error(res && res.error || "No se pudo guardar.");
      msg.textContent = "Guardado y sincronizado correctamente."; msg.classList.add("ok");
      toast("Guardado correctamente");
      // actualizar estado local básico y recargar ruta para reflejar maestro/saldos
      await loadRoute();
      // volver a la ruta
      setView("route");
    } catch (err) {
      msg.textContent = err.message || String(err); msg.classList.add("err");
      toast("Error al guardar", 3000);
    } finally {
      qs("#btn-save").disabled = (state.returnTo === "deudores") ? (!state.puedeCobrarDeudas || isViewingHistory()) : (routeIsFinalizada() || isViewingHistory());
      showLoading(false);
    }
  }

  async function loadRouteHistory() {
    if (!state.session) return;
    const panel = qs("#history-panel");
    const list = qs("#history-list");
    panel.classList.remove("hidden");
    list.innerHTML = `<span class="muted small">Cargando rutas...</span>`;
    try {
      const res = await API.listRoutes({ pin: state.session.pin, limit: 20 });
      if (!res || !res.ok) throw new Error(res && res.error || "No se pudo cargar el historial de rutas.");
      state.routeHistory = Array.isArray(res.rutas) ? res.rutas : [];
      if (!state.routeHistory.length) { list.innerHTML = `<span class="muted small">No hay rutas anteriores.</span>`; return; }
      list.innerHTML = state.routeHistory.map(r => {
        const active = state.route && String(state.route.idRuta) === String(r.idRuta);
        const estado = String(r.estado || "").toUpperCase();
        return `<div class="history-item ${active ? "active" : ""}">
          <div class="h-main">
            <div class="h-title">${esc(r.fecha || "")} · ${esc(r.conductor || "")}</div>
            <div class="h-sub">${esc(r.hoja || "")} · ${esc(estado || "SIN ESTADO")}</div>
          </div>
          <button class="btn ${active ? "btn-light":"btn-primary"}" data-hist="${esc(r.idRuta)}">${active ? "Viendo" : "Ver"}</button>
        </div>`;
      }).join("");
      qsa("[data-hist]").forEach(btn => btn.addEventListener("click", () => openHistoricalRoute(btn.getAttribute("data-hist"))));
    } catch (e) {
      list.innerHTML = `<span class="msg err">${esc(e.message || String(e))}</span>`;
    }
  }

  async function openHistoricalRoute(idRuta) {
    if (!idRuta) return;
    try {
      showLoading(true);
      const res = await API.getRouteById({ pin: state.session.pin, idRuta });
      if (!res || !res.ok) throw new Error(res && res.error || "No se pudo cargar la ruta seleccionada.");
      state.route = res.ruta || null;
      state.entregas = Array.isArray(res.entregas) ? res.entregas : [];
      state.routeTotals = res.totales || null;
      if (res.deudasPorCliente) state.debtsByClient = { ...state.debtsByClient, ...res.deudasPorCliente };
      state.viewingHistory = String(idRuta) !== String(state.activeRouteId || "");
      renderRoute();
      setView("route");
      loadRouteHistory(); // refresca estado "Viendo" sin bloquear
    } catch (e) {
      toast(e.message || String(e), 4000);
    } finally { showLoading(false); }
  }

  async function backToActiveRoute() {
    qs("#history-panel").classList.add("hidden");
    if (isViewingHistory()) await loadRoute();
  }

  function bind() {
    qs("#btn-login").addEventListener("click", handleLogin);
    qs("#pin").addEventListener("keydown", (e) => { if (e.key === "Enter") handleLogin(); });
    qs("#btn-logout").addEventListener("click", logout);
    qs("#btn-refresh").addEventListener("click", () => {
      if (qs("#view-deudores") && !qs("#view-deudores").classList.contains("hidden")) loadDeudores();
      else if (isViewingHistory() && state.route) openHistoricalRoute(state.route.idRuta);
      else loadRoute({ silent: !!state.route });
    });
    qs("#btn-deudores").addEventListener("click", loadDeudores);
    qs("#btn-back-deudores").addEventListener("click", () => setView("route"));
    qs("#btn-finalizar-ruta").addEventListener("click", finalizarRutaActual);
    qs("#btn-history").addEventListener("click", loadRouteHistory);
    qs("#btn-history-close").addEventListener("click", backToActiveRoute);
    qs("#search-deudores").addEventListener("input", renderDeudores);
    qs("#btn-back").addEventListener("click", () => setView(state.returnTo === "deudores" ? "deudores" : "route"));
    qs("#search").addEventListener("input", renderList);
    const estEl = qs("#estado-entrega");
    if (estEl) estEl.addEventListener("change", () => {
      const v = String(estEl.value || "PENDIENTE").toUpperCase();
      const de = qs("#detail-estado"); if (de) de.innerHTML = badgeEstado(v);
      applyDetailMode(); updateCalcs();
    });
    ["p-efectivo","p-yape","p-transferencia","p-recibido","genera-deuda","cd-efectivo","cd-yape","cd-transferencia","cd-recibido"].forEach(id => {
      const el = qs(`#${id}`);
      if (!el) return;
      el.addEventListener("input", updateCalcs);
      el.addEventListener("change", updateCalcs);
    });
    qs("#btn-save").addEventListener("click", saveCurrent);

    if ("serviceWorker" in navigator) {
      const reloadOnce = () => {
        if (window.__meSwReloaded) return;
        window.__meSwReloaded = true;
        window.location.reload();
      };
      navigator.serviceWorker.register("sw.js").then((reg) => {
        try { reg.update(); } catch (e) {}
        setInterval(() => { try { reg.update(); } catch (e) {} }, 60 * 1000);
        if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller) {
              nw.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      }).catch(() => {});
      navigator.serviceWorker.addEventListener("controllerchange", reloadOnce);
    }
  }

  function init() {
    bind();
    loadSession();
    if (state.session && state.session.pin) {
      loadRoute();
    } else {
      setView("login");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();