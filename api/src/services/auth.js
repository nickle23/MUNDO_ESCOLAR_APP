import { getPool, sql } from '../db.js';

export async function requireAuth(params = {}) {
  const pin = String(params.pin || '').trim();
  if (!pin) throw new Error('PIN requerido.');
  const pool = await getPool();
  const r = await pool.request()
    .input('pin', sql.NVarChar(50), pin)
    .query(`
      SELECT TOP 1 ID_USUARIO, NOMBRE, CONDUCTOR_HOJA, ROL, PUEDE_COBRAR_DEUDAS, ACTIVO
      FROM dbo.USUARIOS
      WHERE PIN = @pin AND ACTIVO = 1
    `);
  const row = r.recordset[0];
  if (!row) throw new Error('PIN inválido o usuario inactivo.');
  return {
    id: String(row.ID_USUARIO),
    nombre: String(row.NOMBRE || ''),
    conductorHoja: String(row.CONDUCTOR_HOJA || ''),
    rol: String(row.ROL || 'REPARTIDOR'),
    puedeCobrarDeudas: !!row.PUEDE_COBRAR_DEUDAS,
  };
}