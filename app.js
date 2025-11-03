const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');
const { formatISO } = require('date-fns');

const config = require('./config');
const db = require('./db');
const {
  sensorPayloadSchema,
  addDeviceSchema,
  paginationSchema,
  statsQuerySchema,
  validate,
} = require('./validators');

const app = express();
const dbReady = db.initialize().catch((err) => {
  console.error('[db] Initialization failed', err);
  process.exit(1);
});

app.locals.dbReady = dbReady;

const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
});

const corsEnv = (process.env.CORS_ALLOW_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOrigins = corsEnv.length
  ? corsEnv
  : config.corsOrigins.length
  ? config.corsOrigins
  : undefined;

app.use(helmet());
app.use(
  cors({
    origin: corsOrigins || '*',
    credentials: true,
  })
);
app.use(limiter);
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan(config.isProduction ? 'combined' : 'dev'));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', async (_req, res) => {
  try {
    await dbReady;
    await db.get('SELECT 1');
    const mqttStatus = app.get('mqttStatus') || { state: 'unknown' };
    return sendSuccess(res, {
      status: 'ok',
      mqtt: mqttStatus,
    });
  } catch (err) {
    console.error('[healthz] failure', err);
    return sendError(res, 503, 'Service unhealthy', err.message);
  }
});

app.get('/readyz', async (_req, res) => {
  try {
    await dbReady;
    await db.get('SELECT 1');
  } catch (err) {
    console.error('[readyz] database not ready', err);
    return sendError(res, 503, 'Database not ready', err.message);
  }

  const mqttStatus = app.get('mqttStatus') || { state: 'unknown' };
  if (mqttStatus.state !== 'connected') {
    return sendError(res, 503, 'MQTT not connected', mqttStatus);
  }

  return sendSuccess(res, { ready: true, mqtt: mqttStatus });
});

function sendSuccess(res, data = null, message = 'OK') {
  return res.json({
    error: false,
    message,
    data,
    timestamp: formatISO(new Date()),
  });
}

function sendError(res, status, message, details) {
  return res.status(status).json({
    error: true,
    message,
    details,
    timestamp: formatISO(new Date()),
  });
}

function toDbBoolean(value) {
  if (value === undefined || value === null) return null;
  return value ? 1 : 0;
}

function toNumberOrNull(value) {
  if (value === undefined || value === null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function deviceExists(sn) {
  const row = await db.get('SELECT 1 FROM devices WHERE sn = ? LIMIT 1', [sn]);
  return !!row;
}

async function insertSensorReading({ sn, sensor, payloadHash, source }) {
  if (!sensor) throw new Error('Missing sensor payload');

  if (payloadHash) {
    try {
      await db.run(
        'INSERT INTO ingest_dedup (sn, payload_hash) VALUES (?, ?)',
        [sn, payloadHash]
      );
    } catch (err) {
      if (
        err &&
        (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
          err.code === 'SQLITE_CONSTRAINT')
      ) {
        return { deduped: true };
      }
      throw err;
    }
  }

  const record = {
    sn,
    distance_cm: toNumberOrNull(sensor.distance_cm),
    distance_mm: toNumberOrNull(sensor.distance_mm),
    battery: toNumberOrNull(sensor.battery),
    temperature_c: toNumberOrNull(sensor.temperature_c),
    position: sensor.position || null,
    temperature_alarm: toDbBoolean(sensor.temperature_alarm),
    distance_alarm: toDbBoolean(sensor.distance_alarm),
  };

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
        distance_alarm
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      record.sn,
      record.distance_cm,
      record.distance_mm,
      record.battery,
      record.temperature_c,
      record.position,
      record.temperature_alarm,
      record.distance_alarm,
    ]
  );

  const row = await db.get(
    'SELECT * FROM sensor_data WHERE rowid = last_insert_rowid()'
  );

  broadcastToWS({
    ...row,
    source: source || 'http',
  });

  return { deduped: false, row };
}

async function recordParseError(sn, rawPayload, errorMessage) {
  await db.run(
    `
      INSERT INTO parse_errors (sn, raw_payload, error_message)
      VALUES (?, ?, ?)
    `,
    [sn || null, rawPayload, errorMessage.slice(0, 256)]
  );
}

function broadcastToWS(data) {
  const wss = app.get('wss');
  if (!wss) return;

  const payload = JSON.stringify(data);
  let sent = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(payload);
      sent += 1;
    }
  });

  if (sent > 0 && !config.isProduction) {
    console.log(`[ws] Broadcasted to ${sent} clients`);
  }
}

app.get('/healthz', async (_req, res) => {
  const mqtt = app.get('mqttStatus') || { state: 'disconnected' };
  try {
    await dbReady;
    await db.get('SELECT 1');
    return sendSuccess(res, {
      status: 'ok',
      mqtt,
    });
  } catch (err) {
    return sendError(res, 503, 'Database unavailable', err.message);
  }
});

app.get('/readyz', async (_req, res) => {
  try {
    await dbReady;
    await db.get('SELECT 1');
    const mqtt = app.get('mqttStatus') || { state: 'disconnected' };
    if (mqtt.state !== 'connected') {
      return sendError(res, 503, 'MQTT not connected', mqtt);
    }
    return sendSuccess(res, { ready: true, mqtt });
  } catch (err) {
    return sendError(res, 503, 'Dependencies not ready', err.message);
  }
});

app.post('/api/add-sn', validate(addDeviceSchema), async (req, res) => {
  const { sn } = req.body;
  try {
    await db.run(
      `INSERT INTO devices (sn, added_at) VALUES (?, CURRENT_TIMESTAMP)
       ON CONFLICT(sn) DO UPDATE SET added_at = added_at`,
      [sn]
    );
    return sendSuccess(res, { sn }, 'Device registered');
  } catch (err) {
    console.error('[api] add-sn failed', err);
    return sendError(res, 500, 'Failed to register device');
  }
});

app.post('/api/data', validate(sensorPayloadSchema), async (req, res) => {
  const { sn, sensor } = req.body;
  try {
    if (!(await deviceExists(sn))) {
      return sendError(res, 403, 'Device not registered');
    }
    const result = await insertSensorReading({
      sn,
      sensor,
      source: 'http',
    });
    if (result.deduped) {
      return sendSuccess(res, { sn }, 'Duplicate payload ignored');
    }
    return sendSuccess(res, result.row, 'Reading stored');
  } catch (err) {
    console.error('[api] data insert failed', err);
    return sendError(res, 500, 'Failed to insert sensor data');
  }
});

app.get('/api/all-sns', validate(paginationSchema, { source: 'query' }), async (req, res) => {
  const { page, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  try {
    const rows = await db.all(
      `
      SELECT sn, added_at
      FROM devices
      ORDER BY added_at DESC
      LIMIT ? OFFSET ?
      `,
      [limit, offset]
    );
    const totalRow = await db.get('SELECT COUNT(*) as total FROM devices');
    return sendSuccess(res, {
      devices: rows,
      page,
      limit,
      total: totalRow?.total || 0,
    });
  } catch (err) {
    console.error('[api] all-sns failed', err);
    return sendError(res, 500, 'Failed to fetch devices');
  }
});

app.get('/api/latest', validate(paginationSchema, { source: 'query' }), async (req, res) => {
  const { page, limit = 50, sn } = req.query;
  const offset = (page - 1) * limit;
  const whereClause = sn ? 'WHERE sn = ?' : '';
  const params = sn ? [sn, limit, offset] : [limit, offset];
  try {
    const rows = await db.all(
      `
      SELECT *
      FROM sensor_data
      ${whereClause}
      ORDER BY ts DESC
      LIMIT ? OFFSET ?
      `,
      params
    );
    const totalRow = await db.get(
      `SELECT COUNT(*) as total FROM sensor_data ${sn ? 'WHERE sn = ?' : ''}`,
      sn ? [sn] : []
    );
    return sendSuccess(res, {
      data: rows,
      page,
      limit,
      total: totalRow?.total || 0,
    });
  } catch (err) {
    console.error('[api] latest failed', err);
    return sendError(res, 500, 'Failed to fetch sensor data');
  }
});

app.get('/api/stats', validate(statsQuerySchema, { source: 'query' }), async (req, res) => {
  const { sn } = req.query;
  const whereClause = sn ? 'WHERE sn = ?' : '';
  try {
    const stats = await db.get(
      `
      SELECT
        COUNT(*) AS total_records,
        AVG(distance_cm) AS avg_distance_cm,
        MIN(distance_cm) AS min_distance_cm,
        MAX(distance_cm) AS max_distance_cm,
        AVG(distance_mm) AS avg_distance_mm,
        AVG(battery) AS avg_battery,
        AVG(temperature_c) AS avg_temperature_c
      FROM sensor_data
      ${whereClause}
      `,
      sn ? [sn] : []
    );
    return sendSuccess(res, stats);
  } catch (err) {
    console.error('[api] stats failed', err);
    return sendError(res, 500, 'Failed to compute statistics');
  }
});

app.get('/api/export-csv', async (req, res) => {
  try {
    const rows = await db.all(
      `
      SELECT *
      FROM sensor_data
      ORDER BY ts DESC
      LIMIT 10000
      `
    );
    const header = [
      'sn',
      'distance_cm',
      'distance_mm',
      'battery',
      'temperature_c',
      'position',
      'temperature_alarm',
      'distance_alarm',
      'ts',
    ];
    const csvLines = [header.join(',')];
    rows.forEach((row) => {
      csvLines.push(
        header
          .map((field) =>
            row[field] !== undefined && row[field] !== null
              ? `"${String(row[field]).replace(/"/g, '""')}"`
              : ''
          )
          .join(',')
      );
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="sensor-data-${Date.now()}.csv"`
    );
    res.send(csvLines.join('\n'));
  } catch (err) {
    console.error('[api] export-csv failed', err);
    sendError(res, 500, 'Failed to export CSV');
  }
});

app.get('/api/parse-errors', validate(paginationSchema, { source: 'query' }), async (req, res) => {
  const { page, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  try {
    const rows = await db.all(
      `
      SELECT *
      FROM parse_errors
      ORDER BY ts DESC
      LIMIT ? OFFSET ?
      `,
      [limit, offset]
    );
    const totalRow = await db.get('SELECT COUNT(*) as total FROM parse_errors');
    return sendSuccess(res, {
      data: rows,
      page,
      limit,
      total: totalRow?.total || 0,
    });
  } catch (err) {
    console.error('[api] parse-errors failed', err);
    return sendError(res, 500, 'Failed to fetch parse errors');
  }
});

app.use((_req, res) => sendError(res, 404, 'Route not found'));

app.use((err, _req, res, _next) => {
  console.error('[api] Unhandled error:', err);
  sendError(res, 500, 'Internal server error');
});

module.exports = {
  app,
  dbReady,
  insertSensorReading,
  recordParseError,
  deviceExists,
};
