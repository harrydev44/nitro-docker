import { getPool } from './db.js';

export async function ensureSimulationTables(): Promise<void> {
  const pool = getPool();

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS simulation_room_stats (
      room_id INT PRIMARY KEY,
      visit_count INT DEFAULT 0,
      current_population INT DEFAULT 0,
      peak_population INT DEFAULT 0,
      purpose VARCHAR(20) DEFAULT 'hangout',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS simulation_agent_memory (
      id INT AUTO_INCREMENT PRIMARY KEY,
      agent_id INT NOT NULL,
      target_agent_id INT,
      event_type VARCHAR(20) NOT NULL,
      sentiment FLOAT DEFAULT 0,
      summary VARCHAR(255),
      room_id INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_agent_target (agent_id, target_agent_id),
      INDEX idx_agent_time (agent_id, created_at)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS simulation_relationships (
      agent_id INT NOT NULL,
      target_agent_id INT NOT NULL,
      score FLOAT DEFAULT 0,
      interaction_count INT DEFAULT 0,
      last_interaction TIMESTAMP NULL,
      PRIMARY KEY (agent_id, target_agent_id),
      INDEX idx_agent_score (agent_id, score)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS simulation_market_prices (
      item_base_id INT PRIMARY KEY,
      avg_price FLOAT DEFAULT 0,
      last_trade_price FLOAT DEFAULT 0,
      trade_count INT DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS simulation_agent_state (
      agent_id INT PRIMARY KEY,
      personality JSON NOT NULL,
      preferences JSON NOT NULL,
      goals JSON DEFAULT ('[]'),
      state VARCHAR(20) DEFAULT 'idle',
      ticks_in_room INT DEFAULT 0,
      ticks_working INT DEFAULT 0
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS simulation_external_agents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      api_key VARCHAR(64) UNIQUE NOT NULL,
      bot_id INT NOT NULL,
      user_id INT NOT NULL,
      name VARCHAR(25) NOT NULL UNIQUE,
      description TEXT,
      status ENUM('active','banned') DEFAULT 'active',
      last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP,
      request_count INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_api_key (api_key),
      INDEX idx_bot_id (bot_id)
    )
  `);

  // Fix visibility: ensure all external-agent rooms appear in navigator
  await pool.execute(`
    UPDATE rooms SET is_public = '1'
    WHERE is_public = '0' AND owner_name LIKE 'ext_%'
  `);

  console.log('[DB] Simulation tables ready');
}
