const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const config = require('./config');

const databasePath = path.resolve(config.databasePath);

const db = new sqlite3.Database(databasePath);

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

const exec = (sql) =>
  new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

async function ensureTables() {
  await exec('PRAGMA foreign_keys = ON;');

  await run(`
    CREATE TABLE IF NOT EXISTS devices (
      sn TEXT PRIMARY KEY,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS sensor_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sn TEXT NOT NULL,
      distance_cm REAL,
      distance_mm INTEGER,
      battery INTEGER,
      temperature_c REAL,
      position TEXT,
      temperature_alarm INTEGER,
      distance_alarm INTEGER,
      ts DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS parse_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sn TEXT,
      raw_payload TEXT NOT NULL,
      error_message TEXT NOT NULL,
      ts DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS ingest_dedup (
      sn TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      ts DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (sn, payload_hash)
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_sensor_data_sn_ts
    ON sensor_data (sn, ts)
  `);
}

async function migrateLegacySensorData() {
  const columns = await all('PRAGMA table_info(sensor_data)');
  if (!columns.length) return;

  const missingColumns = {
    distance_cm: 'REAL',
    distance_mm: 'INTEGER',
    temperature_c: 'REAL',
    temperature_alarm: 'INTEGER',
    distance_alarm: 'INTEGER',
    ts: "DATETIME DEFAULT CURRENT_TIMESTAMP",
  };

  for (const [column, definition] of Object.entries(missingColumns)) {
    const exists = columns.some((col) => col.name === column);
    if (!exists) {
      await run(`ALTER TABLE sensor_data ADD COLUMN ${column} ${definition}`);
    }
  }

  // Legacy schema used "distance" and "temperature" columns.
  const hasDistanceLegacy = columns.some((col) => col.name === 'distance');
  const hasTemperatureLegacy = columns.some((col) => col.name === 'temperature');

  if (hasDistanceLegacy) {
    await run(`
      UPDATE sensor_data
      SET distance_cm = distance,
          distance_mm = CASE
            WHEN distance IS NOT NULL THEN ROUND(distance * 10)
            ELSE distance_mm
          END
      WHERE distance_cm IS NULL
    `);
  }

  if (hasTemperatureLegacy) {
    await run(`
      UPDATE sensor_data
      SET temperature_c = temperature
      WHERE temperature_c IS NULL
    `);
  }

  const hasTimestampLegacy = columns.some((col) => col.name === 'timestamp');
  if (hasTimestampLegacy) {
    await run(`
      UPDATE sensor_data
      SET ts = timestamp
      WHERE ts IS NULL
    `);
  }
}

async function initialize() {
  await ensureTables();
  await migrateLegacySensorData();
}

function close() {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

module.exports = {
  db,
  run,
  get,
  all,
  exec,
  initialize,
  close,
  databasePath,
};
