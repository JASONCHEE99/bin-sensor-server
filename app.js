// ========================
// app.js (Node.js + SQLite)
// ========================

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');
const fastcsv = require('fast-csv');
const db = require('./db'); // SQLite 数据库模块

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// POST 数据接收
app.post('/api/data', (req, res) => {
  const { robot_SN, load_cell1 } = req.body;
  if (!robot_SN || typeof load_cell1 !== 'number') {
    return res.status(400).send('请求体必须包含 robot_SN (字符串) 和 load_cell1 (数字)');
  }

  const timestamp = new Date().toISOString();
  const sql = `INSERT INTO sensor_data (robot_SN, load_cell1, timestamp) VALUES (?, ?, ?)`;

  db.run(sql, [robot_SN, load_cell1, timestamp], function (err) {
    if (err) {
      console.error("数据库插入错误：", err.message);
      return res.status(500).send("数据库写入失败");
    }
    res.send("✅ 数据已写入数据库");
  });
});

// GET 所有数据
app.get('/api/all-data', (req, res) => {
  const sql = `SELECT * FROM sensor_data ORDER BY timestamp DESC`;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).send("查询失败");
    res.json(rows);
  });
});

// GET 最新 5 条数据
app.get('/api/latest', (req, res) => {
  const sql = `SELECT * FROM sensor_data ORDER BY timestamp DESC LIMIT 5`;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).send("查询失败");
    res.json(rows);
  });
});

// GET 导出 CSV
app.get('/api/export-csv', (req, res) => {
  const filePath = path.join(__dirname, 'exported_data.csv');
  const ws = fs.createWriteStream(filePath);

  db.all(`SELECT * FROM sensor_data ORDER BY timestamp DESC`, [], (err, rows) => {
    if (err) return res.status(500).send("导出失败");

    const csvStream = fastcsv.format({ headers: true });
    csvStream.pipe(ws).on('finish', () => {
      res.download(filePath, 'bin_sensor_data.csv', () => {
        fs.unlinkSync(filePath);
      });
    });

    rows.forEach(row => {
      csvStream.write({
        SN: row.robot_SN,
        Distance: row.load_cell1,
        Time: format(new Date(row.timestamp), 'yyyy-MM-dd HH:mm:ss')
      });
    });

    csvStream.end();
  });
});

module.exports = app;
