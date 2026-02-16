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

  // Add webhook columns to external agents (safe ALTER — ignore duplicate column error 1060)
  const webhookColumns = [
    { name: 'callback_url', def: 'VARCHAR(500) DEFAULT NULL' },
    { name: 'webhook_interval_secs', def: 'INT DEFAULT 120' },
    { name: 'last_webhook_at', def: 'DATETIME DEFAULT NULL' },
    { name: 'webhook_failures', def: 'INT DEFAULT 0' },
  ];
  for (const col of webhookColumns) {
    try {
      await pool.execute(
        `ALTER TABLE simulation_external_agents ADD COLUMN ${col.name} ${col.def}`
      );
    } catch (err: any) {
      if (err.errno !== 1060) throw err; // 1060 = Duplicate column name (already exists)
    }
  }

  // --- Agent notes (key-value store for external agents) ---
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS simulation_external_agent_notes (
      agent_id INT NOT NULL,
      note_key VARCHAR(50) NOT NULL,
      note_value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (agent_id, note_key)
    )
  `);

  // --- Direct messages (cross-room DMs) ---
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS simulation_direct_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      from_agent_id INT NOT NULL,
      to_agent_id INT NOT NULL,
      from_name VARCHAR(25) NOT NULL,
      to_name VARCHAR(25) NOT NULL,
      message VARCHAR(200) NOT NULL,
      read_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_to_agent (to_agent_id, created_at),
      INDEX idx_from_agent (from_agent_id, created_at)
    )
  `);

  // --- Agent reviews (1-5 star ratings) ---
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS simulation_agent_reviews (
      id INT AUTO_INCREMENT PRIMARY KEY,
      reviewer_id INT NOT NULL,
      target_id INT NOT NULL,
      reviewer_name VARCHAR(25) NOT NULL,
      target_name VARCHAR(25) NOT NULL,
      rating TINYINT NOT NULL,
      comment VARCHAR(100),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_review (reviewer_id, target_id),
      INDEX idx_target (target_id)
    )
  `);

  // --- Quest definitions ---
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS simulation_quests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      quest_type VARCHAR(30) NOT NULL,
      description VARCHAR(200) NOT NULL,
      target_count INT NOT NULL,
      reward_credits INT NOT NULL,
      active BOOLEAN DEFAULT TRUE
    )
  `);

  // --- Agent quest progress ---
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS simulation_agent_quests (
      agent_id INT NOT NULL,
      quest_id INT NOT NULL,
      progress INT DEFAULT 0,
      completed BOOLEAN DEFAULT FALSE,
      claimed_at DATETIME DEFAULT NULL,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (agent_id, quest_id)
    )
  `);

  // Seed quests if empty
  const questCount = await pool.execute(`SELECT COUNT(*) as cnt FROM simulation_quests`);
  const qCount = (questCount as any)[0]?.[0]?.cnt || 0;
  if (qCount === 0) {
    await pool.execute(`
      INSERT INTO simulation_quests (quest_type, description, target_count, reward_credits) VALUES
        ('visit_rooms', 'Explorer: Visit 5 different rooms', 5, 200),
        ('chat_agents', 'Social Butterfly: Chat with 10 different agents', 10, 300),
        ('trade_complete', 'Trader: Complete 3 trades', 3, 500),
        ('host_party', 'Party Animal: Host a party', 1, 400),
        ('buy_items', 'Shopper: Buy 5 items from the catalog', 5, 150),
        ('earn_work', 'Worker: Earn credits from 5 work sessions', 5, 250),
        ('send_dms', 'Networker: Send DMs to 5 different agents', 5, 200),
        ('write_reviews', 'Critic: Write 3 agent reviews', 3, 150)
    `);
    console.log('[DB] Seeded 8 quests');
  }

  // Fix visibility: ensure all external-agent rooms appear in navigator
  await pool.execute(`
    UPDATE rooms SET is_public = '1'
    WHERE is_public = '0' AND owner_name LIKE 'ext_%'
  `);

  console.log('[DB] Simulation tables ready');
}
