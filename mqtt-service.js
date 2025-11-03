'use strict';

const EventEmitter = require('events');
const mqtt = require('mqtt');
const config = require('./config');
const {
  parseNBIoTUplink,
  hashPayload,
} = require('./src/parsers/milesight-unified-em400-mud');

class MqttService extends EventEmitter {
  constructor({ onReading, onParseError, onUnknownDevice }) {
    super();
    this.onReading = onReading;
    this.onParseError = onParseError;
    this.onUnknownDevice = onUnknownDevice;
    this.client = null;
    this.connected = false;
  }

  connect() {
    if (this.client) return this.client;

    const options = {
      clientId: config.mqtt.clientId,
      clean: config.mqtt.clean,
      keepalive: config.mqtt.keepalive,
      reconnectPeriod: 5000,
      connectTimeout: 30_000,
      queueQoSZero: false,
      resubscribe: true,
      will: {
        topic: this.statusTopic(config.mqtt.statusSn),
        payload: JSON.stringify({ status: 'offline', ts: new Date().toISOString() }),
        qos: 1,
        retain: false,
      },
    };

    if (config.mqtt.username) options.username = config.mqtt.username;
    if (config.mqtt.password) options.password = config.mqtt.password;

    if (config.mqtt.tls) {
      const { ca, cert, key, rejectUnauthorized } = config.mqtt.tls;
      if (ca) options.ca = ca;
      if (cert) options.cert = cert;
      if (key) options.key = key;
      if (rejectUnauthorized !== undefined) {
        options.rejectUnauthorized = rejectUnauthorized;
      }
    }

    this.client = mqtt.connect(config.mqtt.url, options);
    this.registerHandlers();
    return this.client;
  }

  registerHandlers() {
    const client = this.client;
    if (!client) return;

    client.on('connect', () => {
      this.connected = true;
      this.emitStatus('connected');
      client.subscribe('sensors/bin/+/uplink', { qos: 1 }, (err) => {
        if (err) {
          console.error('[mqtt] Failed to subscribe:', err.message);
        }
      });
      this.publishStatus('online');
    });

    client.on('reconnect', () => {
      this.emitStatus('reconnecting');
    });

    client.on('close', () => {
      if (this.connected) {
        this.emitStatus('disconnected');
      }
      this.connected = false;
    });

    client.on('error', (err) => {
      console.error('[mqtt] error', err.message);
      this.emitStatus('error', err.message);
    });

    client.on('message', async (topic, payload) => {
      const match = topic.match(/^sensors\/bin\/([^/]+)\/uplink$/);
      if (!match) return;
      const snFromTopic = match[1];
      const rawPayload = payload.toString();
      const payloadHash = hashPayload(payload);

      try {
        const decoded = parseNBIoTUplink(payload);
        const sn = decoded.sn || snFromTopic;
        decoded.sensor = decoded.sensor || {};

        if (typeof this.onReading === 'function') {
          const handled = await this.onReading({
            sn,
            sensor: decoded.sensor,
            payloadHash,
            rawPayload,
            source: 'mqtt',
          });
          if (handled?.unknownDevice && typeof this.onUnknownDevice === 'function') {
            this.onUnknownDevice(sn);
          }
        }

        this.publishDeviceStatus(sn, 'online');
      } catch (err) {
        console.error('[mqtt] parse failed', err.message);
        if (typeof this.onParseError === 'function') {
          await this.onParseError(snFromTopic, rawPayload, err.message);
        }
      }
    });
  }

  publishStatus(status) {
    if (!this.client || !this.connected) return;
    const topic = this.statusTopic(config.mqtt.statusSn);
    this.client.publish(
      topic,
      JSON.stringify({ status, ts: new Date().toISOString() }),
      { qos: 1, retain: false }
    );
  }

  publishDeviceStatus(sn, status) {
    if (!this.client || !this.connected) return;
    const topic = this.statusTopic(sn);
    this.client.publish(
      topic,
      JSON.stringify({ status, ts: new Date().toISOString() }),
      { qos: 1, retain: false }
    );
  }

  statusTopic(sn) {
    return `sensors/bin/${sn}/status`;
  }

  emitStatus(state, detail) {
    this.emit('status', { state, detail, ts: new Date().toISOString() });
  }

  disconnect() {
    if (this.client) {
      this.client.end(true);
      this.client.removeAllListeners();
      this.client = null;
    }
  }
}

module.exports = MqttService;
