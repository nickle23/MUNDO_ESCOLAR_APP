// Configuración del frontend (GitHub Pages)
// 1) Despliega el Google Apps Script como Web App y copia la URL que termina en /exec
// 2) Pega la URL en API_URL

window.APP_CONFIG = {
  APP_NAME: "Mundo Escolar - Rutas",
  // Ejemplo: "https://script.google.com/macros/s/AKfycb.../exec"
  API_URL: "https://script.google.com/macros/s/AKfycbyq-oHPqXHQZw4--a2F1NorjfPBORx9BT5ZghUAsHPW0BrPNinp-X3WVyJSQzWl_uE/exec",
  TIMEZONE: "America/Lima",
  // Fecha a consultar por defecto: "today" usa la fecha local del dispositivo
  DEFAULT_DATE: "today",
  // Si el navegador bloquea respuestas por CORS desde GitHub Pages, puedes probar "jsonp" para lecturas (si el backend lo soporta)
  REQUEST_MODE: "auto" // "auto" | "post" | "get"
};