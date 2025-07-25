require('dotenv').config();

const app = require('./app');
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`🚀 Server is running at: http://localhost:${PORT}`);
});

// WebSocket 支持
const WebSocket = require('ws');
const wss = new WebSocket.Server({ server });

// 挂到 app 以便 app.js 使用
app.set('wss', wss);

wss.on('connection', (ws) => {
  console.log("🌐 New WebSocket client connected");

  ws.on('close', () => {
    console.log("❌ WebSocket client disconnected");
  });

  // 可在这里推欢迎消息
  ws.send(JSON.stringify({info: "Welcome WebSocket client!"}));
});