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

// MQTT Connection
const mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL);

mqttClient.on('connect', () => {
  console.log("✅ Connected to MQTT Broker");
  mqttClient.subscribe('sensor/bin', (err) => {
    if (err) console.error("❌ MQTT subscribe failed:", err.message);
    else console.log("✅ Subscribed to topic: sensor/bin");
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
        if (!err) console.log(`📥 Inserted: ${sn}, ${distance}cm`);
      });
    });
  } catch (e) {
    console.error("❌ MQTT message parse failed:", e.message);
  }
});

// Returns true/false if SN is registered
function isRegisteredSN(sn, callback) {
  db.get(`SELECT 1 FROM devices WHERE sn = ? LIMIT 1`, [sn], (err, row) => {
    if (err) return callback(err);
    callback(null, !!row);
  });
}

// API to insert new sensor data
app.post('/api/data', (req, res) => {
  const { sn, data } = req.body;
  const sensor = data?.[0];
  if (!sn || !Array.isArray(data) || !sensor) {
    return res.status(400).send('Request body must contain sn and a data array');
  }

  isRegisteredSN(sn, (err, valid) => {
    if (err) return res.status(500).send('Failed to validate device');
    if (!valid) return res.status(403).send('Device not registered');

    const { distance, battery, temperature, position } = sensor;
    if (
      typeof distance !== 'number' || distance < 0 ||
      typeof battery !== 'number' || battery < 0 || battery > 100 ||
      typeof temperature !== 'number' || temperature < -40 || temperature > 85 ||
      typeof position !== 'string'
    ) {
      return res.status(400).send('Invalid data format');
    }

    const timestamp = new Date().toISOString();
    const sql = `INSERT INTO sensor_data (sn, distance, battery, temperature, position, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?)`;

    db.run(sql, [sn, distance, battery, temperature, position, timestamp], function(err) {
      if (err) {
        console.error("❌ Database insert failed:", err.message);
        return res.status(500).send("Database insert failed: " + err.message);
      }
      console.log(`📥 Inserted: SN=${sn}, distance=${distance}`);
      res.send("✅ Data inserted into database");
    });
  });
});

// Add a device SN to registration table
app.post('/api/add-sn', (req, res) => {
  const { sn } = req.body;
  if (!sn || typeof sn !== 'string') return res.status(400).send('Invalid SN');

  db.run(`INSERT OR IGNORE INTO devices (sn) VALUES (?)`, [sn], function (err) {
    if (err) return res.status(500).send("Failed to add device");
    res.send(this.changes === 0 ? "Device already exists" : "✅ New device added");
  });
});

// Get all registered SNs
app.get('/api/all-sns', (req, res) => {
  db.all(`SELECT sn FROM devices ORDER BY sn`, [], (err, rows) => {
    if (err) return res.status(500).send("Query failed");
    res.json(rows.map(r => r.sn));
  });
});

// Get latest 5 data records (optionally for a device SN)
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
    if (err) return res.status(500).send("Query failed");
    res.json(rows);
  });
});

// Export all sensor data as CSV
app.get('/api/export-csv', (req, res) => {
  const filename = `bin_sensor_${Date.now()}.csv`;
  const filePath = path.join(__dirname, filename);
  const ws = fs.createWriteStream(filePath);

  db.all(`SELECT * FROM sensor_data ORDER BY timestamp DESC`, [], (err, rows) => {
    if (err) return res.status(500).send("Export failed");

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