const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'database.db'), (err) => {
  if (err) {
    console.error("❌ 无法连接数据库：", err.message);
  } else {
    console.log("✅ 已连接到 SQLite 数据库");
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS sensor_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sn TEXT NOT NULL,
      distance REAL NOT NULL,
      battery INTEGER NOT NULL,
      temperature REAL NOT NULL,
      position TEXT NOT NULL,
      timestamp TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS devices (
      sn TEXT PRIMARY KEY,
      added_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
});

module.exports = db;
