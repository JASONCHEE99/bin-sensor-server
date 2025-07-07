// db.js
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.db');

// 初始化表结构
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS sensor_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      robot_SN TEXT NOT NULL,
      load_cell1 REAL NOT NULL,
      timestamp TEXT NOT NULL
    )
  `);
});

module.exports = db;
