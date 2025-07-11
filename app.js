require('dotenv').config();
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

// MQTT 连接
const mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL);

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
    const sn = payload.sn;
    const sensor = payload.data?.[0];
    if (!sn || !sensor) return;

    isRegisteredSN(sn, (err, valid) => {
      if (err || !valid) return;

      const { distance, battery, temperature, position } = sensor;
      if (
        typeof distance !== 'number' || distance < 0 ||
        typeof battery !== 'number' || battery < 0 || battery > 100 ||
        typeof temperature !== 'number' || temperature < -40 || temperature > 85 ||
        typeof position !== 'string'
      ) return;

      const timestamp = new Date().toISOString();
      const sql = `INSERT INTO sensor_data (sn, distance, battery, temperature, position, timestamp)
                   VALUES (?, ?, ?, ?, ?, ?)`;

      db.run(sql, [sn, distance, battery, temperature, position, timestamp], (err) => {
        if (!err) console.log(`📥 写入成功: ${sn}, ${distance}cm`);
      });
    });
  } catch (e) {
    console.error("❌ MQTT 消息解析失败：", e.message);
  }
});

function isRegisteredSN(sn, callback) {
  db.get(`SELECT 1 FROM devices WHERE sn = ? LIMIT 1`, [sn], (err, row) => {
    if (err) return callback(err);
    callback(null, !!row);
  });
}

app.post('/api/data', (req, res) => {
  const { sn, data } = req.body;
  const sensor = data?.[0];
  if (!sn || !Array.isArray(data) || !sensor) {
    return res.status(400).send('请求体必须包含 sn 和 data 数组');
  }

  isRegisteredSN(sn, (err, valid) => {
    if (err) return res.status(500).send('验证设备失败');
    if (!valid) return res.status(403).send('未注册的设备');

    const { distance, battery, temperature, position } = sensor;
    if (
      typeof distance !== 'number' || distance < 0 ||
      typeof battery !== 'number' || battery < 0 || battery > 100 ||
      typeof temperature !== 'number' || temperature < -40 || temperature > 85 ||
      typeof position !== 'string'
    ) {
      return res.status(400).send('数据格式有误');
    }

    const timestamp = new Date().toISOString();
    const sql = `INSERT INTO sensor_data (sn, distance, battery, temperature, position, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?)`;

    db.run(sql, [sn, distance, battery, temperature, position, timestamp], function(err) {
      if (err) {
        console.error("❌ 数据库写入失败:", err.message);
        return res.status(500).send("数据库写入失败：" + err.message);
      }
      console.log(`📥 写入成功: SN=${sn}, distance=${distance}`);
      res.send("✅ 数据已写入数据库");
    });
  });
});


app.post('/api/add-sn', (req, res) => {
  const { sn } = req.body;
  if (!sn || typeof sn !== 'string') return res.status(400).send('无效 SN');

  db.run(`INSERT OR IGNORE INTO devices (sn) VALUES (?)`, [sn], function (err) {
    if (err) return res.status(500).send("添加设备失败");
    res.send(this.changes === 0 ? "设备已存在" : "✅ 新设备已添加");
  });
});

app.get('/api/all-sns', (req, res) => {
  db.all(`SELECT sn FROM devices ORDER BY sn`, [], (err, rows) => {
    if (err) return res.status(500).send("查询失败");
    res.json(rows.map(r => r.sn));
  });
});

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

app.get('/api/export-csv', (req, res) => {
  const filename = `bin_sensor_${Date.now()}.csv`;
  const filePath = path.join(__dirname, filename);
  const ws = fs.createWriteStream(filePath);

  db.all(`SELECT * FROM sensor_data ORDER BY timestamp DESC`, [], (err, rows) => {
    if (err) return res.status(500).send("导出失败");

    const csvStream = fastcsv.format({ headers: true });
    csvStream.pipe(ws).on('finish', () => {
      res.download(filePath, filename, () => fs.unlinkSync(filePath));
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
