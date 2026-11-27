import sql from 'mssql';
import dotenv from 'dotenv';

dotenv.config();

const config = {
  server: process.env.DB_SERVER || 'localhost\\SQLEXPRESS',
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'MUNDO_ESCOLAR',
  options: {
    encrypt: String(process.env.DB_ENCRYPT || 'false') === 'true',
    trustServerCertificate: String(process.env.DB_TRUST_SERVER_CERT || 'true') === 'true',
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

let poolPromise;

export function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(config).then((pool) => {
      console.log('[db] conectado a SQL Server');
      return pool;
    }).catch((err) => {
      poolPromise = null;
      console.error('[db] error de conexión', err.message);
      throw err;
    });
  }
  return poolPromise;
}

export { sql };