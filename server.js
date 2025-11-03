const http = require('http');
const WebSocket = require('ws');
const config = require('./config');
const {
  app,
  dbReady,
  insertSensorReading,
  recordParseError,
  deviceExists,
} = require('./app');
const MqttService = require('./mqtt-service');

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.set('wss', wss);
app.set('mqttStatus', { state: 'initialising', ts: new Date().toISOString() });

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ info: 'connected' }));
});

const mqttService = new MqttService({
  onReading: async ({ sn, sensor, payloadHash, rawPayload, source }) => {
    if (!(await deviceExists(sn))) {
      console.warn(`[mqtt] Unregistered device payload ignored: ${sn}`);
      if (mqttService && typeof mqttService.publishDeviceStatus === 'function') {
        mqttService.publishDeviceStatus(sn, 'unknown');
      }
      return { unknownDevice: true };
    }

    return insertSensorReading({
      sn,
      sensor,
      payloadHash,
      source,
    });
  },
  onParseError: async (sn, rawPayload, errorMessage) =>
    recordParseError(sn, rawPayload, errorMessage),
  onUnknownDevice: (sn) =>
    console.warn(`[mqtt] Received payload from unknown device: ${sn}`),
});

mqttService.on('status', (state) => {
  app.set('mqttStatus', state);
});

dbReady
  .then(() => {
    app.set('mqttStatus', { state: 'connecting', ts: new Date().toISOString() });
    mqttService.connect();
  })
  .catch((err) => {
    console.error('[server] Failed to initialise services', err);
    process.exit(1);
  });

server.listen(config.port, () => {
  console.log(`[http] Listening on port ${config.port}`);
});

function shutdown(signal) {
  console.log(`[system] Received ${signal}, shutting down...`);
  mqttService.disconnect();
  wss.close();
  server.close(() => {
    require('./db')
      .close()
      .then(() => {
        process.exit(0);
      })
      .catch((err) => {
        console.error('[system] Failed to close database', err);
        process.exit(1);
      });
  });
}

['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => shutdown(signal));
});

process.on('unhandledRejection', (reason) => {
  console.error('[system] Unhandled rejection', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[system] Uncaught exception', err);
  shutdown('uncaughtException');
});
