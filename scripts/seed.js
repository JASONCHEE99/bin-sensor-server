#!/usr/bin/env node

const db = require('../db');

async function main() {
  const sn = process.argv[2] || 'demo-device-001';
  await db.initialize();

  await db.run(
    `INSERT INTO devices (sn, added_at)
     VALUES (?, CURRENT_TIMESTAMP)
     ON CONFLICT(sn) DO UPDATE SET added_at = added_at`,
    [sn]
  );

  const now = Date.now();
  const samples = Array.from({ length: 5 }).map((_, idx) => ({
    sn,
    distance_cm: 45 + idx,
    distance_mm: (45 + idx) * 10,
    battery: 80 - idx,
    temperature_c: 22.5 + idx * 0.3,
    position: idx % 2 === 0 ? 'normal' : 'tilt',
    temperature_alarm: idx % 4 === 0 ? 1 : 0,
    distance_alarm: idx % 3 === 0 ? 1 : 0,
    ts: new Date(now - idx * 60_000).toISOString(),
  }));

  for (const sample of samples) {
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
        sample.sn,
        sample.distance_cm,
        sample.distance_mm,
        sample.battery,
        sample.temperature_c,
        sample.position,
        sample.temperature_alarm,
        sample.distance_alarm,
        sample.ts,
      ]
    );
  }

  console.log(`[seed] Inserted ${samples.length} sample readings for ${sn}`);
  await db.close();
}

main().catch((err) => {
  console.error('[seed] Failed', err);
  process.exit(1);
});
