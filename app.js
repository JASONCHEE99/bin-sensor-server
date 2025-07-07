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
app.use(express.static('public'));

const mqttClient = mqtt.connect('mqtt://localhost:1883');

mqttClient.on('connect', () => {
  console.log("✅ 已连接到 MQTT Broker");
  mqttClient.subscribe('sensor/bin', (err) => {
    if (err) console.error("❌ MQTT 订阅失败：", err.message);
    else console.log("✅ 已订阅主题：sensor/bin");
  });
});

mqttClient.on('error', (err) => {
  console.error("❌ MQTT 连接错误：", err.message);
});

mqttClient.on('reconnect', () => {
  console.log("🔄 MQTT 正在尝试重连...");
});

mqttClient.on('message', (topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    const sn = payload.sn;
    const sensor = payload.data?.[0];

    if (!sn || !sensor) return;

    const { distance, battery, temperature, position } = sensor;

    // 加强数据校验
    if (
      typeof distance !== 'number' || distance < 0 ||
      typeof battery !== 'number' || battery < 0 || battery > 100 ||
      typeof temperature !== 'number' || temperature < -40 || temperature > 85 ||
      typeof position !== 'string'
    ) {
      console.warn("⚠️ MQTT 数据不合法，已忽略");
      return;
    }

    const timestamp = new Date().toISOString();
    const sql = `INSERT INTO sensor_data (sn, distance, battery, temperature, position, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?)`;

    db.run(sql, [sn, distance, battery, temperature, position, timestamp], (err) => {
      if (err) console.error("❌ MQTT 数据写入失败：", err.message);
      else console.log(`📥 MQTT 数据写入成功：${sn}, ${distance}cm`);
    });
  } catch (e) {
    console.error("❌ MQTT 消息解析错误：", e.message);
  }
});

// HTTP POST 上传（测试备用）
app.post('/api/data', (req, res) => {
  const { sn, data } = req.body;
  const sensor = data?.[0];

  if (!sn || !Array.isArray(data) || !sensor) {
    return res.status(400).send('请求体必须包含 sn 和 data 数组');
  }

  const { distance, battery, temperature, position } = sensor;

  if (
    typeof distance !== 'number' || distance < 0 ||
    typeof battery !== 'number' || battery < 0 || battery > 100 ||
    typeof temperature !== 'number' || temperature < -40 || temperature > 85 ||
    typeof position !== 'string'
  ) {
    return res.status(400).send('data 中字段格式不正确或值异常');
  }

  const timestamp = new Date().toISOString();
  const sql = `INSERT INTO sensor_data (sn, distance, battery, temperature, position, timestamp)
               VALUES (?, ?, ?, ?, ?, ?)`;

  db.run(sql, [sn, distance, battery, temperature, position, timestamp], function (err) {
    if (err) {
      console.error("数据库插入错误：", err.message);
      return res.status(500).send("数据库写入失败");
    }
    res.send("✅ 数据已写入数据库");
  });
});

// 获取所有 SN
app.get('/api/all-sns', (req, res) => {
  const sql = `SELECT DISTINCT sn FROM sensor_data ORDER BY sn`;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).send("查询失败");
    const sns = rows.map(r => r.sn);
    res.json(sns);
  });
});

// 获取最新数据（可选 sn）
app.get('/api/latest', (req, res) => {
  const sn = req.query.sn;
  let sql = `SELECT * FROM sensor_data`;
  const params = [];

  if (sn) {
    sql += ` WHERE sn = ?`;
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
  const filename = `bin_sensor_${Date.now()}.csv`;
  const filePath = path.join(__dirname, filename);
  const ws = fs.createWriteStream(filePath);

  db.all(`SELECT * FROM sensor_data ORDER BY timestamp DESC`, [], (err, rows) => {
    if (err) return res.status(500).send("导出失败");

    const csvStream = fastcsv.format({ headers: true });
    csvStream.pipe(ws).on('finish', () => {
      res.download(filePath, filename, () => {
        fs.unlinkSync(filePath);
      });
    });

    rows.forEach(row => {
      csvStream.write({
        SN: row.sn,
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
