'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');

function readMaybe(filePath) {
  if (!filePath) return undefined;
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    console.warn(`[mqtt] TLS file not found: ${resolved}`);
    return undefined;
  }
  return fs.readFileSync(resolved);
}

const mqttUrl = process.env.MQTT_URL;
if (!mqttUrl) {
  throw new Error('MQTT_URL is required');
}

const clientId =
  process.env.MQTT_CLIENT_ID || `bin-sensor-${Math.random().toString(16).slice(2, 10)}`;
const statusSn = process.env.MQTT_STATUS_SN || clientId;

const options = {
  clientId,
  clean: true,
  reconnectPeriod: 2000,
  queueQoSZero: false,
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  will: {
    topic: `sensors/bin/${statusSn}/status`,
    payload: 'offline',
    qos: 1,
    retain: false,
  },
};

const ca = readMaybe(process.env.MQTT_TLS_CA_PATH);
const cert = readMaybe(process.env.MQTT_TLS_CERT_PATH);
const key = readMaybe(process.env.MQTT_TLS_KEY_PATH);
if (ca) options.ca = ca;
if (cert) options.cert = cert;
if (key) options.key = key;
if (process.env.MQTT_TLS_REJECT_UNAUTHORIZED) {
  options.rejectUnauthorized = !['0', 'false', 'no'].includes(
    process.env.MQTT_TLS_REJECT_UNAUTHORIZED.toLowerCase()
  );
}

const client = mqtt.connect(mqttUrl, options);

client.on('connect', () => {
  console.log('[mqtt] connected');
  client.subscribe('sensors/bin/+/uplink', { qos: 1 }, (err) => {
    if (err) {
      console.error('[mqtt] subscribe error', err);
      return;
    }
    client.publish(
      `sensors/bin/${statusSn}/status`,
      'online',
      { qos: 1, retain: false },
      (pubErr) => {
        if (pubErr) {
          console.error('[mqtt] publish status error', pubErr);
        }
      }
    );
  });
});

client.on('error', (err) => {
  console.error('[mqtt] client error', err);
});

module.exports = client;
