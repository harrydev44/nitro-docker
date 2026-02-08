import mysql from 'mysql2/promise';

let pool: mysql.Pool;

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT || '13306'),
      user: process.env.DB_USER || 'arcturus_user',
      password: process.env.DB_PASSWORD || 'arcturus_pw',
      database: process.env.DB_NAME || 'arcturus',
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0,
    });
  }
  return pool;
}

export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const [rows] = await getPool().execute(sql, params);
  return rows as T[];
}

export async function execute(sql: string, params?: any[]): Promise<mysql.ResultSetHeader> {
  const [result] = await getPool().execute(sql, params);
  return result as mysql.ResultSetHeader;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
  }
}
