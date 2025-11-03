#!/usr/bin/env node

const path = require('path');
const db = require('../db');

async function renameDeviceColumnIfNeeded() {
  const columns = await db.all('PRAGMA table_info(devices)');
  const hasRobotSn = columns.some((col) => col.name === 'robot_SN');
  if (!hasRobotSn) return;

  console.log('[migrate] Normalising devices table (robot_SN -> sn)');
  await db.exec('BEGIN');
  try {
    await db.run('ALTER TABLE devices RENAME TO devices_legacy');
    await db.run(`
      CREATE TABLE devices (
        sn TEXT PRIMARY KEY,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const rows = await db.all(
      'SELECT robot_SN as sn, added_at FROM devices_legacy'
    );
    for (const row of rows) {
      if (!row.sn) continue;
      await db.run(
        'INSERT OR IGNORE INTO devices (sn, added_at) VALUES (?, ?)',
        [row.sn, row.added_at]
      );
    }
    await db.run('DROP TABLE devices_legacy');
    await db.exec('COMMIT');
  } catch (err) {
    await db.exec('ROLLBACK');
    throw err;
  }
}

async function migrateSensorDataColumns() {
  const columns = await db.all('PRAGMA table_info(sensor_data)');
  const hasLegacySn = columns.some((col) => col.name === 'robot_SN');
  const hasDistance = columns.some((col) => col.name === 'distance');
  const hasTemperature = columns.some((col) => col.name === 'temperature');
  const hasTimestamp = columns.some((col) => col.name === 'timestamp');

  if (!hasLegacySn && !hasDistance && !hasTemperature && !hasTimestamp) {
    return;
  }

  console.log('[migrate] Transforming sensor_data to new schema');
  await db.exec('BEGIN');
  try {
    await db.run('ALTER TABLE sensor_data RENAME TO sensor_data_legacy');
    await db.run(`
      CREATE TABLE sensor_data (
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
    const rows = await db.all('SELECT * FROM sensor_data_legacy');
    for (const row of rows) {
      const sn = row.sn || row.robot_SN;
      if (!sn) continue;
      const distanceCm =
        row.distance_cm ??
        row.distance ??
        (row.distance_mm != null ? row.distance_mm / 10 : null);
      const distanceMm =
        row.distance_mm ?? (distanceCm != null ? Math.round(distanceCm * 10) : null);
      const temperature =
        row.temperature_c ?? row.temperature ?? null;
      const timestamp = row.ts || row.timestamp || new Date().toISOString();
      await db.run(
        `
        INSERT INTO sensor_data (
          sn,
          distance_cm,
          distance_mm,
          battery,
          temperature_c,
          position,
          temperature_alarm,
          distance_alarm,
          ts
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          sn,
          distanceCm,
          distanceMm,
          row.battery ?? null,
          temperature,
          row.position ?? null,
          row.temperature_alarm ?? null,
          row.distance_alarm ?? null,
          timestamp,
        ]
      );
    }
    await db.run('DROP TABLE sensor_data_legacy');
    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_sensor_data_sn_ts
      ON sensor_data (sn, ts)
    `);
    await db.exec('COMMIT');
  } catch (err) {
    await db.exec('ROLLBACK');
    throw err;
  }
}

async function main() {
  console.log(`[migrate] Using database at ${path.resolve(db.databasePath)}`);
  await db.initialize();
  await renameDeviceColumnIfNeeded();
  await migrateSensorDataColumns();
  console.log('[migrate] Migration completed');
  await db.close();
}

main().catch((err) => {
  console.error('[migrate] Failed', err);
  process.exit(1);
});
