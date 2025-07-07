// app.js
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');
const fastcsv = require('fast-csv');
const mqtt = require('mqtt');
const db = require('./db');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // 放前端文件夹

// MQTT 设置
const mqttClient = mqtt.connect('mqtt://localhost:1883'); // 改成你的 Broker 地址和端口

mqttClient.on('connect', () => {
  console.log("✅ 已连接到 MQTT Broker");
  mqttClient.subscribe('sensor/bin', (err) => {
    if (err) console.error("❌ MQTT 订阅失败：", err.message);
    else console.log("✅ 已订阅主题：sensor/bin");
  });
});

mqttClient.on('message', (topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    const { sn, data } = payload;
    if (!sn || !Array.isArray(data) || data.length === 0) return;

    const { distance, battery, temperature, position } = data[0];
    const timestamp = new Date().toISOString();

    const sql = `INSERT INTO sensor_data (robot_SN, distance, battery, temperature, position, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?)`;

    db.run(sql, [sn, distance, battery, temperature, position, timestamp], (err) => {
      if (err) console.error("❌ MQTT 数据写入失败：", err.message);
      else console.log(`📥 MQTT 数据写入成功：${sn}, ${distance}cm`);
    });
  } catch (e) {
    console.error("❌ MQTT 消息格式错误：", e.message);
  }
});

// HTTP POST 上传数据（备用）
app.post('/api/data', (req, res) => {
  const { sn, data } = req.body;

  if (!sn || !Array.isArray(data) || data.length === 0) {
    return res.status(400).send('请求体必须包含 sn (字符串) 和 data 数组');
  }

  const { distance, battery, temperature, position } = data[0];

  if (
    typeof distance !== 'number' ||
    typeof battery !== 'number' ||
    typeof temperature !== 'number' ||
    typeof position !== 'string'
  ) {
    return res.status(400).send('data 中字段格式不正确');
  }

  const timestamp = new Date().toISOString();
  const sql = `INSERT INTO sensor_data (robot_SN, distance, battery, temperature, position, timestamp)
               VALUES (?, ?, ?, ?, ?, ?)`;

  db.run(sql, [sn, distance, battery, temperature, position, timestamp], function (err) {
    if (err) {
      console.error("数据库插入错误：", err.message);
      return res.status(500).send("数据库写入失败");
    }
    res.send("✅ 数据已写入数据库");
  });
});

// 获取所有设备 SN
app.get('/api/all-sns', (req, res) => {
  const sql = `SELECT DISTINCT robot_SN FROM sensor_data ORDER BY robot_SN`;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).send("查询失败");
    const sns = rows.map(r => r.robot_SN);
    res.json(sns);
  });
});

// 获取指定设备最新5条数据（支持 sn 查询参数）
app.get('/api/latest', (req, res) => {
  const sn = req.query.sn;
  let sql = `SELECT * FROM sensor_data`;
  let params = [];
  if (sn) {
    sql += ` WHERE robot_SN = ?`;
    params.push(sn);
  }
  sql += ` ORDER BY timestamp DESC LIMIT 5`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).send("查询失败");
    res.json(rows);
  });
});

// 导出 CSV
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
        Distance: row.distance,
        Battery: row.battery,
        Temperature: row.temperature,
        Position: row.position,
        Time: format(new Date(row.timestamp), 'yyyy-MM-dd HH:mm:ss')
      });
    });

    csvStream.end();
  });
});

module.exports = app;
