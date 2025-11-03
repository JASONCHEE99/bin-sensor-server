require('dotenv').config();

const fs = require('fs');
const path = require('path');

function toInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toBool(value, fallback = false) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function toList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function loadFileMaybe(filePath) {
  if (!filePath) return null;
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    console.warn(`[config] TLS file not found: ${resolved}`);
    return null;
  }
  return fs.readFileSync(resolved);
}

const env = process.env.NODE_ENV || 'development';

const config = {
  env,
  isProduction: env === 'production',
  port: toInt(process.env.PORT, 3000),
  corsOrigins: toList(process.env.CORS_WHITELIST),
  databasePath:
    process.env.DATABASE_PATH ||
    path.join(process.cwd(), 'database.db'),
  rateLimit: {
    windowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    max: toInt(process.env.RATE_LIMIT_MAX, 120),
  },
  mqtt: {
    url: process.env.MQTT_BROKER_URL,
    username: process.env.MQTT_USERNAME || null,
    password: process.env.MQTT_PASSWORD || null,
    clean: toBool(process.env.MQTT_CLEAN_SESSION, true),
    keepalive: toInt(process.env.MQTT_KEEPALIVE, 60),
    clientId:
      process.env.MQTT_CLIENT_ID ||
      `bin-sensor-server-${Math.random().toString(16).slice(2, 10)}`,
    statusSn: process.env.MQTT_STATUS_SN || 'server',
    tls: {
      ca: loadFileMaybe(process.env.MQTT_TLS_CA),
      cert: loadFileMaybe(process.env.MQTT_TLS_CERT),
      key: loadFileMaybe(process.env.MQTT_TLS_KEY),
      rejectUnauthorized: toBool(
        process.env.MQTT_TLS_REJECT_UNAUTHORIZED,
        true
      ),
    },
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  parseErrorRetention: toInt(process.env.PARSE_ERROR_RETENTION_DAYS, 30),
};

const required = ['mqtt.url'];
const missing = required.filter((key) => {
  const pathSegments = key.split('.');
  let current = config;
  for (const segment of pathSegments) {
    if (current == null) return true;
    current = current[segment];
  }
  return !current;
});

if (missing.length > 0 && env !== 'test') {
  throw new Error(
    `Missing required configuration values: ${missing.join(', ')}`
  );
}

module.exports = config;
