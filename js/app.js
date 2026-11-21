(function () {
  const { qs, qsa, showLoading, toast, money, num, esc, badgeEstado, todayISO } = window.UI;
  const API = window.API;

  const state = {
    session: null, // {usuario, token?}
    route: null,   // {idRuta, fecha, conductor, hoja, spreadsheetId, ...}
    entregas: [],
    current: null, // entrega seleccionada
    debtsByClient: {}, // cache
    deudores: [],
    puedeCobrarDeudas: false,
    returnTo: "route",
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

  function saveSession() {
    if (state.session) localStorage.setItem("me_session", JSON.stringify(state.session));
    else localStorage.removeItem("me_session");
  }
  function loadSession() {
    try { state.session = JSON.parse(localStorage.getItem("me_session") || "null"); } catch { state.session = null; }
    state.puedeCobrarDeudas = !!(state.session && state.session.usuario && state.session.usuario.puedeCobrarDeudas);
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
    state.session = null; state.route = null; state.entregas = []; state.current = null; state.debtsByClient = {}; state.deudores = []; state.puedeCobrarDeudas = false; state.returnTo = "route";
    saveSession();
    qs("#pin").value = "";
    setView("login");
  }

  async function loadRoute() {
    if (!state.session) return setView("login");
    try {
      showLoading(true);
      const fecha = (window.APP_CONFIG.DEFAULT_DATE === "today" || !window.APP_CONFIG.DEFAULT_DATE) ? todayISO() : window.APP_CONFIG.DEFAULT_DATE;
      const res = await API.getRouteToday({ pin: state.session.pin, fecha });
      if (!res || !res.ok) throw new Error(res && res.error || "No se pudo cargar la ruta.");
      state.route = res.ruta || null;
      state.entregas = Array.isArray(res.entregas) ? res.entregas : [];
      if (res.deudasPorCliente) state.debtsByClient = { ...state.debtsByClient, ...res.deudasPorCliente };
      renderRoute();
      setView("route");
    } catch (e) {
      toast(e.message || String(e), 4000);
      // If route not found, still show route view with message
      state.route = state.route || null; state.entregas = [];
      renderRoute();
      setView("route");
    } finally {
      showLoading(false);
    }
  }

  function renderRoute() {
    const r = state.route;
    qs("#route-conductor").textContent = r ? (r.conductor || state.session.usuario.nombre || "-") : (state.session.usuario.nombre || "-");
    qs("#route-fecha").textContent = r ? (r.fecha || todayISO()) : todayISO();
    qs("#route-hoja").textContent = r ? `${r.hoja || ""} (${r.idRuta || ""})` : "No tienes una ruta asignada para hoy. Si crees que es un error, contacta a oficina.";
    const finalizada = routeIsFinalizada();
    qs("#subtitle").textContent = r ? (finalizada ? "Ruta finalizada" : "Ruta del día") : "Sin ruta";
    const st = qs("#route-status");
    if (st) st.textContent = finalizada ? "Ruta finalizada: ya no puedes modificar cobros de entregas. Solo queda disponible la consulta/cobro de deudores (si estás autorizado)." : "";
    const btnFin = qs("#btn-finalizar-ruta");
    if (btnFin) { btnFin.disabled = !r || finalizada; btnFin.textContent = finalizada ? "Ruta finalizada" : "Finalizar ruta"; }

    const total = state.entregas.length;
    const pagados = state.entregas.filter(e => ["PAGADO","ENTREGADO"].includes((e.estadoEntrega||"").toUpperCase())).length;
    const creditos = state.entregas.filter(e => ["CREDITO","PARCIAL"].includes((e.estadoEntrega||"").toUpperCase())).length;
    const pendientes = total - pagados - creditos;
    qs("#route-summary").innerHTML = `
      <span class="pill">Entregas: ${total}</span>
      <span class="pill">Pagadas: ${pagados}</span>
      <span class="pill">Crédito/Parcial: ${creditos}</span>
      <span class="pill">Pendientes: ${pendientes < 0 ? 0 : pendientes}</span>`;

    renderList();
  }

  function renderList() {
    const q = (qs("#search").value || "").toLowerCase().trim();
    const items = state.entregas.filter(e => {
      if (!q) return true;
      return `${e.cliente||""} ${e.direccion||""}`.toLowerCase().includes(q);
    });
    const list = qs("#route-list");
    qs("#route-empty").classList.toggle("hidden", items.length !== 0);
    list.innerHTML = items.map(e => {
      const monto = e.montoCobrar != null ? e.montoCobrar : e.totMont;
      const pagado = e.totalPagadoHoy != null ? e.totalPagadoHoy : 0;
      const saldoCliente = (state.debtsByClient[e.idCliente] && state.debtsByClient[e.idCliente].saldoTotal) || e.saldoPendienteCliente || 0;
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
    const locked = routeIsFinalizada() && !isDebtMode;
    const canDebt = !!state.puedeCobrarDeudas;

    qs("#pago-card").classList.toggle("hidden", isDebtMode);
    qs("#credito-card").classList.toggle("hidden", isDebtMode);
    qs("#obs-card").classList.toggle("hidden", isDebtMode);
    qs("#debts-card").classList.toggle("hidden", isDebtMode);
    qs("#detail-monto-wrap").classList.toggle("hidden", isDebtMode);
    qs("#detail-estado-wrap").classList.toggle("hidden", isDebtMode);

    qs("#cobro-deuda-card").classList.remove("hidden");
    qs("#cobro-title").textContent = isDebtMode ? "Cobro de deuda pendiente" : "Cobro de deudas anteriores";
    qs("#cobro-subtitle").textContent = isDebtMode
      ? "Selecciona la deuda, ingresa el monto a abonar (puede ser parcial), elige método de pago y registra el cobro."
      : "Selecciona deudas y el monto a abonar. El abono se registra con el desglose indicado.";
    qs("#btn-save").textContent = isDebtMode ? "Registrar cobro de deuda" : (locked ? "Ruta finalizada" : "Guardar y sincronizar");
    qs("#btn-save").disabled = isDebtMode ? !canDebt : locked;

    ["p-efectivo","p-yape","p-transferencia","genera-deuda","vence-deuda","estado-entrega","observacion"].forEach(id => {
      const el = qs(`#${id}`); if (el) el.disabled = !isDebtMode && locked;
    });
    ["cd-efectivo","cd-yape","cd-transferencia"].forEach(id => {
      const el = qs(`#${id}`); if (el) el.disabled = isDebtMode ? !canDebt : false;
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
    qs("#detail-estado").innerHTML = badgeEstado(e.estadoEntrega || "PENDIENTE");

    qs("#p-efectivo").value = e.efectivo != null ? e.efectivo : "";
    qs("#p-yape").value = e.yape != null ? e.yape : "";
    qs("#p-transferencia").value = e.transferencia != null ? e.transferencia : "";
    qs("#observacion").value = e.observacion || "";
    qs("#estado-entrega").value = (e.estadoEntrega || "PENDIENTE").toUpperCase();
    qs("#vence-deuda").value = e.venceDeuda || "";
    qs("#genera-deuda").checked = !!(e.deudaGeneradaHoy && Number(e.deudaGeneradaHoy) > 0) || (e.estadoEntrega || "").toUpperCase() === "CREDITO";
    qs("#cd-efectivo").value = e.cobroDeudaEfectivo || "";
    qs("#cd-yape").value = e.cobroDeudaYape || "";
    qs("#cd-transferencia").value = e.cobroDeudaTransferencia || "";
    qs("#save-msg").textContent = ""; qs("#save-msg").className = "msg";

    applyDetailMode();
    updateCalcs();
    setView("detail");
    await loadDebtsForCurrent();
  }

  async function finalizarRutaActual() {
    if (!state.route) return;
    if (!confirm("¿Finalizar la ruta? Después de finalizar no podrás modificar cobros de entregas.")) return;
    try {
      showLoading(true);
      const res = await API.finalizarRuta({ pin: state.session.pin, ruta: { idRuta: state.route.idRuta } });
      if (!res || !res.ok) throw new Error(res && res.error || "No se pudo finalizar la ruta.");
      toast("Ruta finalizada");
      await loadRoute();
    } catch (e) {
      toast(e.message || String(e), 4000);
    } finally { showLoading(false); }
  }

  async function loadDeudores() {
    if (!state.session) return;
    const msg = qs("#deudores-status");
    msg.textContent = ""; msg.className = "msg";
    try {
      showLoading(true);
      const res = await API.listDeudores({ pin: state.session.pin });
      if (!res || !res.ok) throw new Error(res && res.error || "No se pudieron cargar los deudores.");
      state.deudores = Array.isArray(res.deudores) ? res.deudores : [];
      state.puedeCobrarDeudas = !!res.puedeCobrarDeudas;
      renderDeudores();
      setView("deudores");
    } catch (e) {
      msg.textContent = e.message || String(e); msg.classList.add("err");
      toast(e.message || String(e), 4000);
    } finally { showLoading(false); }
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

  async function openDeudor(idCliente) {
    const d = state.deudores.find(x => String(x.idCliente) === String(idCliente));
    if (!d) return;
    state.current = { idEntrega: "DEUDA_"+idCliente, row: 0, idCliente: d.idCliente, cliente: d.clienteNombre, direccion: d.direccion || d.zona || "", montoCobrar: 0, estadoEntrega: "PENDIENTE", observacion: "" };
    state.returnTo = "deudores";
    qs("#detail-cliente").textContent = d.clienteNombre || d.idCliente;
    qs("#detail-meta").textContent = `${d.direccion || d.zona || ""} · ID Cliente: ${d.idCliente}`;
    qs("#detail-monto").textContent = money(0);
    qs("#detail-estado").innerHTML = badgeEstado("CREDITO");
    ["p-efectivo","p-yape","p-transferencia","cd-efectivo","cd-yape","cd-transferencia"].forEach(id => { const el = qs("#"+id); if (el) el.value = ""; });
    qs("#observacion").value = ""; qs("#estado-entrega").value = "PENDIENTE"; qs("#vence-deuda").value = ""; qs("#genera-deuda").checked = false;
    qs("#save-msg").textContent = ""; qs("#save-msg").className = "msg";
    applyDetailMode();
    updateCalcs();
    state.debtsByClient[d.idCliente] = { saldoTotal: d.saldoTotal, items: d.deudas || [] };
    renderDebts(state.debtsByClient[d.idCliente]);
    setView("detail");
  }

  async function loadDebtsForCurrent() {
    const e = state.current;
    if (!e || !e.idCliente) {
      qs("#debts-list").textContent = "Cliente sin ID_CLIENTE; no se pueden asociar deudas.";
      qs("#cobro-deudas-list").textContent = "Sin deudas pendientes.";
      return;
    }
    qs("#debts-list").textContent = "Cargando...";
    qs("#cobro-deudas-list").textContent = "Cargando...";
    try {
      let data = state.debtsByClient[e.idCliente];
      if (!data || !data.items) {
        const res = await API.getClientDebts(e.idCliente);
        if (res && res.ok) data = { saldoTotal: res.saldoTotal || 0, items: res.deudas || [] };
        else data = { saldoTotal: 0, items: [] };
        state.debtsByClient[e.idCliente] = data;
      }
      renderDebts(data);
    } catch (err) {
      qs("#debts-list").textContent = "No se pudieron cargar las deudas.";
      qs("#cobro-deudas-list").textContent = "No se pudieron cargar las deudas.";
    }
  }

  function renderDebts(data) {
    const items = (data && data.items || []).filter(d => Number(d.saldoPendiente || 0) > 0);
    const isDebtMode = state.returnTo === "deudores";
    const canDebt = !!state.puedeCobrarDeudas;
    const disabled = isDebtMode ? !canDebt : false;

    if (!items.length) {
      qs("#debts-list").innerHTML = `<span class="muted">Sin deudas pendientes. Saldo: ${money(0)}</span>`;
      qs("#cobro-deudas-list").innerHTML = `<span class="muted">Sin deudas pendientes.</span>`;
      qs("#calc-cobro-deuda").textContent = money(0);
      return;
    }

    qs("#debts-list").innerHTML = items.map(d => `
      <div class="debt-row">
        <div class="row1"><strong>${esc(d.idDeuda || "Deuda")}</strong><strong>${money(d.saldoPendiente)}</strong></div>
        <div class="row2">Origen: ${esc(d.fechaOrigen || "-")} · Vence: ${esc(d.fechaVencimiento || "-")} · Estado: ${esc(d.estado || "-")}</div>
      </div>`).join("") + `<div class="mt"><strong>Saldo total: ${money(data.saldoTotal || 0)}</strong></div>`;

    qs("#cobro-deudas-list").innerHTML = items.map(d => `
      <div class="debt-row" data-deuda="${esc(d.idDeuda)}">
        <div class="row1"><strong>${esc(d.idDeuda)}</strong><span>Saldo pendiente: ${money(d.saldoPendiente)}</span></div>
        <div class="row2">Vence: ${esc(d.fechaVencimiento || "-")} · Estado: ${esc(d.estado || "-")}</div>
        <div class="debt-pay">
          <label class="check"><input type="checkbox" class="cd-sel" data-id="${esc(d.idDeuda)}" ${disabled ? "disabled" : ""} /> Abonar esta deuda</label>
          <input type="number" step="0.01" min="0" max="${esc(d.saldoPendiente)}" class="cd-monto" data-id="${esc(d.idDeuda)}" data-max="${esc(d.saldoPendiente)}" placeholder="Monto a abonar" ${disabled ? "disabled" : ""} />
        </div>
      </div>`).join("");

    qsa(".cd-sel").forEach(ch => ch.addEventListener("change", (e) => {
      const id = e.target.getAttribute("data-id");
      const inp = qs(`.cd-monto[data-id="${id}"]`);
      if (!inp) return;
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
      updateCalcs();
    }));
  }

  function updateCalcs() {
    const e = state.current || {};
    const monto = num(e.montoCobrar != null ? e.montoCobrar : e.totMont);
    const total = num(qs("#p-efectivo").value) + num(qs("#p-yape").value) + num(qs("#p-transferencia").value);
    const saldo = Math.max(0, +(monto - total).toFixed(2));
    qs("#calc-total").textContent = money(total);
    qs("#calc-saldo").textContent = money(saldo);
    qs("#credito-fields").classList.toggle("hidden", !(qs("#genera-deuda").checked && saldo > 0));
    if (saldo <= 0) qs("#genera-deuda").checked = false;

    const cobro = num(qs("#cd-efectivo").value) + num(qs("#cd-yape").value) + num(qs("#cd-transferencia").value);
    qs("#calc-cobro-deuda").textContent = money(cobro);
  }

  async function saveCurrent() {
    const e = state.current; const r = state.route;
    if (!e) return;
    if (state.returnTo !== "deudores" && !r) return;
    const msg = qs("#save-msg"); msg.textContent = ""; msg.className = "msg";
    if (routeIsFinalizada() && state.returnTo !== "deudores") {
      msg.textContent = "La ruta está finalizada. No se pueden modificar cobros de entregas."; msg.classList.add("err"); return;
    }
    const monto = num(e.montoCobrar != null ? e.montoCobrar : e.totMont);
    const pago = { efectivo: num(qs("#p-efectivo").value), yape: num(qs("#p-yape").value), transferencia: num(qs("#p-transferencia").value) };
    const totalPagado = +(pago.efectivo + pago.yape + pago.transferencia).toFixed(2);
    const saldo = Math.max(0, +(monto - totalPagado).toFixed(2));
    const generaDeuda = qs("#genera-deuda").checked && saldo > 0;
    const vence = qs("#vence-deuda").value;
    if (generaDeuda && !vence) { msg.textContent = "Selecciona la fecha de vencimiento para la deuda."; msg.classList.add("err"); return; }

    // cobro deudas seleccionadas
    const seleccion = qsa(".cd-sel:checked").map(ch => {
      const idDeuda = ch.getAttribute("data-id");
      const input = qs(`.cd-monto[data-id="${idDeuda}"]`);
      const max = num(input && input.getAttribute("data-max"));
      let montoAbono = num(input && input.value);
      if (montoAbono <= 0) montoAbono = max; // si marcado y sin monto, abonar saldo completo
      montoAbono = Math.min(montoAbono, max);
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
        qs("#btn-save").disabled = false; showLoading(false);
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
      estadoEntrega: qs("#estado-entrega").value,
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
      qs("#btn-save").disabled = false;
      showLoading(false);
    }
  }

  function bind() {
    qs("#btn-login").addEventListener("click", handleLogin);
    qs("#pin").addEventListener("keydown", (e) => { if (e.key === "Enter") handleLogin(); });
    qs("#btn-logout").addEventListener("click", logout);
    qs("#btn-refresh").addEventListener("click", () => { if (qs("#view-deudores") && !qs("#view-deudores").classList.contains("hidden")) loadDeudores(); else loadRoute(); });
    qs("#btn-deudores").addEventListener("click", loadDeudores);
    qs("#btn-back-deudores").addEventListener("click", () => setView("route"));
    qs("#btn-finalizar-ruta").addEventListener("click", finalizarRutaActual);
    qs("#search-deudores").addEventListener("input", renderDeudores);
    qs("#btn-back").addEventListener("click", () => setView(state.returnTo === "deudores" ? "deudores" : "route"));
    qs("#search").addEventListener("input", renderList);
    ["p-efectivo","p-yape","p-transferencia","genera-deuda","cd-efectivo","cd-yape","cd-transferencia"].forEach(id => {
      qs(`#${id}`).addEventListener("input", updateCalcs);
      qs(`#${id}`).addEventListener("change", updateCalcs);
    });
    qs("#btn-save").addEventListener("click", saveCurrent);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
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