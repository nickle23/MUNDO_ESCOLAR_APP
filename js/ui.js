(function () {
  const qs = (s, el = document) => el.querySelector(s);
  const qsa = (s, el = document) => Array.from(el.querySelectorAll(s));

  function showLoading(show) { qs("#loading").classList.toggle("hidden", !show); }
  function toast(msg, ms = 2500) {
    const t = qs("#toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toast._tm);
    toast._tm = setTimeout(() => t.classList.add("hidden"), ms);
  }

  function money(n) {
    const v = Number(n || 0);
    return "S/ " + v.toFixed(2);
  }
  function num(v) {
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function badgeEstado(estado) {
    const e = (estado || "PENDIENTE").toUpperCase();
    const labels = { REPROGRAMADO: "REPROGRAMADO", RECHAZADO: "RECHAZÓ PEDIDO", NO_ENTREGADO: "NO ENTREGADO" };
    return `<span class="badge st-${esc(e)}">${esc(labels[e] || e)}</span>`;
  }

  function todayISO() {
    const d = new Date();
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    return local.toISOString().slice(0, 10);
  }

  window.UI = { qs, qsa, showLoading, toast, money, num, esc, badgeEstado, todayISO };
})();