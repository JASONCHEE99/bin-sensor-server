# 🗑️ Bin Sensor Monitoring System  
**垃圾桶传感器监测系统**

A web-based system to receive bin sensor data via MQTT, store in SQLite, and visualize via browser.  
一个基于网页的系统，通过 MQTT 接收垃圾桶传感器数据，存储在 SQLite 数据库，并在浏览器中可视化展示。

---

## 📦 Features 功能

- ✅ Receive data via MQTT 接收 MQTT 数据
- ✅ Store distance, battery, temperature, position 存储距离、电量、温度、姿态
- ✅ SQLite database integration 集成 SQLite 数据库存储
- ✅ Frontend dashboard for display and export 前端页面显示与导出
- ✅ Threshold alert on distance 距离阈值提醒
- ✅ Support multiple devices with SN filter 支持多个设备 SN 下拉筛选

---

## 📡 Data Format 数据格式（MQTT Payload）

传感器需发送以下 JSON 格式数据到 MQTT：

```json
{
  "sn": "6749D19054690031",
  "data": [
    {
      "distance": 315,
      "battery": 100,
      "temperature": 26.7,
      "position": "tilt"
    }
  ]
}
````

| Key           | Description (English)   | 描述（中文）            |
| ------------- | ----------------------- | ----------------- |
| `sn`          | Device Serial Number    | 设备序列号             |
| `distance`    | Distance in cm          | 距离（单位 cm）         |
| `battery`     | Battery percentage      | 电量百分比             |
| `temperature` | Temperature in Celsius  | 温度（摄氏度）           |
| `position`    | Orientation (e.g. tilt) | 姿态（如 tilt、normal） |

---

## 🛠️ Installation & Usage 安装与使用

### 1. Clone 项目克隆

```bash
git clone https://github.com/your-repo/bin-sensor-server.git
cd bin-sensor-server
```

### 2. Install Dependencies 安装依赖

```bash
npm install
```

### 3. Start Server 启动服务

```bash
node server.js
```

### 4. Open in Browser 打开浏览器

```
http://localhost:3000
```

---

## 📡 MQTT Setup 配置 MQTT

确保你已在本地启动 MQTT Broker（默认端口为 `1883`）：

| 项目 Item  | 值 Value              |
| -------- | -------------------- |
| Host 主机  | `localhost` or 本机 IP |
| Port 端口  | `1883`               |
| Topic 主题 | 任意（监听 `#` 所有主题）      |

系统使用 `mqtt` 模块自动连接并接收数据。

---

## 🗃️ Database Structure 数据库结构（SQLite）

| 字段 Field    | 类型 Type | 描述 Description |
| ----------- | ------- | -------------- |
| id          | INTEGER | 自增主键 Auto ID   |
| robot\_SN   | TEXT    | 设备序列号 SN       |
| distance    | REAL    | 距离（cm）         |
| battery     | INTEGER | 电量（%）          |
| temperature | REAL    | 温度（°C）         |
| position    | TEXT    | 姿态（如 tilt）     |
| timestamp   | TEXT    | 时间戳（ISO 格式）    |

---

## 🖥️ Frontend 前端功能

* 📋 Select SN to filter device 选择设备 SN 查看数据
* 📊 View sensor data in table 表格展示数据
* 🚨 Red alert when distance < threshold 距离低于阈值提醒
* ⬇️ Export CSV 导出 CSV 文件
* 🔄 Auto refresh every 30 seconds 每 30 秒自动刷新

---

## 📁 Project Structure 项目结构

```
bin-sensor-server/
├── public/              # Static front-end (静态网页)
│   └── index.html
├── server.js            # Main server with MQTT
├── app.js               # Express HTTP API
├── db.js                # SQLite DB config
├── package.json
```

---

## 🔧 Future Plans 后续计划

* 📈 图表展示设备历史趋势（Charts for historical data）
* 📬 报警推送到邮箱/Telegram（Alert via Email/Telegram）
* ☁️ 云端同步与远程管理（Cloud sync and remote access）
* 🧑‍🔧 后台用户权限与管理（Admin panel and user roles）

---

## 🧑‍💻 Author 作者

**Cheez**, 2025

* 本地部署 | 支持 MQTT | Node.js + SQLite 全栈实现
* Local deployment | MQTT Sensor Ready | Full Stack Node.js + SQLite

---

## 📎 License 许可证

MIT License

```

---

如你有 GitHub 链接、截图、部署网址，可以额外加上封面图和链接。  
需要我帮你也创建 `README.md` 文件并放进你的项目里用 Node 脚本写入，也可以告诉我！
```
