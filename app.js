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

// --- Environment Validation ---
const requiredEnvVars = ['MQTT_BROKER_URL', 'MQTT_TOPIC'];
const missingEnvVars = requiredEnvVars.filter(key => !process.env[key]);

if (missingEnvVars.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingEnvVars.join(', ')}`);
    process.exit(1);
}

// --- Configuration ---
const CONFIG = {
    MQTT_BROKER_URL: process.env.MQTT_BROKER_URL,
    MQTT_TOPIC: process.env.MQTT_TOPIC,
    ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || '*',
    DEFAULT_LIMIT: 50,
    MAX_LIMIT: 1000,
    CSV_CHUNK_SIZE: 1000
};

// --- Middleware ---
app.use(cors({ 
    origin: CONFIG.ALLOWED_ORIGIN === '*' ? true : CONFIG.ALLOWED_ORIGIN.split(','),
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// --- Utility Functions ---
function sendError(res, status, message, details = null) {
    const errorResponse = { 
        error: true, 
        message, 
        status,
        timestamp: new Date().toISOString()
    };
    if (details) errorResponse.details = details;
    return res.status(status).json(errorResponse);
}

function sendSuccess(res, data = null, message = 'Success') {
    return res.json({
        error: false,
        message,
        data,
        timestamp: new Date().toISOString()
    });
}

function validateSensorData(sensor) {
    const errors = [];
    
    if (typeof sensor.distance !== 'number' || sensor.distance < 0) {
        errors.push('Distance must be a positive number');
    }
    if (typeof sensor.battery !== 'number' || sensor.battery < 0 || sensor.battery > 100) {
        errors.push('Battery must be a number between 0 and 100');
    }
    if (typeof sensor.temperature !== 'number' || sensor.temperature < -40 || sensor.temperature > 85) {
        errors.push('Temperature must be a number between -40 and 85');
    }
    if (typeof sensor.position !== 'string' || sensor.position.trim() === '') {
        errors.push('Position must be a non-empty string');
    }
    
    return errors;
}

function sanitizeInput(input) {
    if (typeof input === 'string') {
        return input.trim().replace(/[<>\"']/g, '');
    }
    return input;
}

// --- WebSocket Broadcast ---
function broadcastToWSClients(data) {
    const wss = app.get('wss');
    if (!wss) return;
    
    let clientCount = 0;
    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            try {
                client.send(JSON.stringify(data));
                clientCount++;
            } catch (err) {
                console.error('❌ WebSocket send error:', err.message);
            }
        }
    });
    
    if (clientCount > 0) {
        console.log(`📡 Broadcasted to ${clientCount} WebSocket clients`);
    }
}

// --- MQTT Connection ---
const mqttClient = mqtt.connect(CONFIG.MQTT_BROKER_URL, {
    reconnectPeriod: 5000,
    connectTimeout: 30000,
    keepalive: 60
});

mqttClient.on('connect', () => {
    console.log("✅ Connected to MQTT Broker");
    mqttClient.subscribe(CONFIG.MQTT_TOPIC, (err) => {
        if (err) {
            console.error("❌ MQTT subscribe failed:", err.message);
        } else {
            console.log(`✅ Subscribed to topic: ${CONFIG.MQTT_TOPIC}`);
        }
    });
});

mqttClient.on('error', (err) => {
    console.error("❌ MQTT error:", err.message);
});

mqttClient.on('reconnect', () => {
    console.log("🔄 MQTT reconnecting...");
});

mqttClient.on('close', () => {
    console.log("⚠️ MQTT connection closed");
});

mqttClient.on('message', (topic, message) => {
    try {
        const payload = JSON.parse(message.toString());
        const sn = sanitizeInput(payload.sn);
        const sensor = payload.data?.[0];
        
        if (!sn || !sensor) {
            console.warn("⚠️ Invalid MQTT message format");
            return;
        }

        isRegisteredSN(sn, (err, valid) => {
            if (err) {
                console.error("❌ Device validation error:", err.message);
                return;
            }
            if (!valid) {
                console.warn(`⚠️ Unregistered device: ${sn}`);
                return;
            }

            const validationErrors = validateSensorData(sensor);
            if (validationErrors.length > 0) {
                console.warn(`⚠️ Invalid sensor data for ${sn}:`, validationErrors.join(', '));
                return;
            }

            const { distance, battery, temperature, position } = sensor;
            const timestamp = new Date().toISOString();
            
            const sql = `INSERT INTO sensor_data (sn, distance, battery, temperature, position, timestamp)
                        VALUES (?, ?, ?, ?, ?, ?)`;

            db.run(sql, [sn, distance, battery, temperature, position, timestamp], (err) => {
                if (err) {
                    console.error("❌ Database insert failed:", err.message);
                    return;
                }
                
                console.log(`📥 MQTT Inserted: ${sn}, distance: ${distance}cm, battery: ${battery}%, temp: ${temperature}°C`);
                
                broadcastToWSClients({ 
                    sn, 
                    distance, 
                    battery, 
                    temperature, 
                    position, 
                    timestamp,
                    source: 'mqtt'
                });
            });
        });
    } catch (e) {
        console.error("❌ MQTT message parse failed:", e.message);
    }
});

// --- Database Helpers ---
function isRegisteredSN(sn, callback) {
    if (!sn || typeof sn !== 'string') {
        return callback(new Error('Invalid SN format'));
    }
    
    db.get(`SELECT 1 FROM devices WHERE sn = ? LIMIT 1`, [sn], (err, row) => {
        if (err) return callback(err);
        callback(null, !!row);
    });
}

function promisifyDb(db, method) {
    return function(...args) {
        return new Promise((resolve, reject) => {
            db[method](...args, (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });
    };
}

// --- HTTP API Routes ---

// Health check endpoint
app.get('/api/health', (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        mqtt: mqttClient.connected ? 'connected' : 'disconnected',
        database: 'connected'
    };
    res.json(health);
});

// Insert new sensor data
app.post('/api/data', (req, res) => {
    try {
        const { sn, data } = req.body;
        
        if (!sn || !Array.isArray(data) || !data[0]) {
            return sendError(res, 400, 'Request body must contain sn and a non-empty data array');
        }

        const sanitizedSN = sanitizeInput(sn);
        if (sanitizedSN.length < 3) {
            return sendError(res, 400, 'SN must be at least 3 characters long');
        }

        isRegisteredSN(sanitizedSN, (err, valid) => {
            if (err) {
                console.error("❌ Device validation error:", err.message);
                return sendError(res, 500, 'Failed to validate device');
            }
            if (!valid) {
                return sendError(res, 403, 'Device not registered');
            }

            const sensor = data[0];
            const validationErrors = validateSensorData(sensor);
            if (validationErrors.length > 0) {
                return sendError(res, 400, 'Invalid sensor data format', validationErrors);
            }

            const { distance, battery, temperature, position } = sensor;
            const timestamp = new Date().toISOString();
            
            const sql = `INSERT INTO sensor_data (sn, distance, battery, temperature, position, timestamp)
                        VALUES (?, ?, ?, ?, ?, ?)`;

            db.run(sql, [sanitizedSN, distance, battery, temperature, position, timestamp], function(err) {
                if (err) {
                    console.error("❌ Database insert failed:", err.message);
                    return sendError(res, 500, "Database insert failed");
                }
                
                console.log(`📥 HTTP Inserted: SN=${sanitizedSN}, distance=${distance}cm`);
                
                broadcastToWSClients({ 
                    sn: sanitizedSN, 
                    distance, 
                    battery, 
                    temperature, 
                    position, 
                    timestamp,
                    source: 'http'
                });
                
                sendSuccess(res, { 
                    id: this.lastID,
                    sn: sanitizedSN,
                    timestamp 
                }, "Data inserted successfully");
            });
        });
    } catch (error) {
        console.error("❌ Unexpected error in /api/data:", error.message);
        sendError(res, 500, 'Internal server error');
    }
});

// Add a device SN
app.post('/api/add-sn', (req, res) => {
    try {
        const { sn } = req.body;
        
        if (!sn || typeof sn !== 'string') {
            return sendError(res, 400, 'Invalid SN format');
        }

        const sanitizedSN = sanitizeInput(sn);
        if (sanitizedSN.length < 3) {
            return sendError(res, 400, 'SN must be at least 3 characters long');
        }

        db.run(`INSERT OR IGNORE INTO devices (sn, created_at) VALUES (?, ?)`, 
            [sanitizedSN, new Date().toISOString()], 
            function (err) {
                if (err) {
                    console.error("❌ Failed to add device:", err.message);
                    return sendError(res, 500, "Failed to add device");
                }
                
                const message = this.changes === 0 ? "Device already exists" : "New device added successfully";
                sendSuccess(res, { 
                    sn: sanitizedSN, 
                    added: this.changes > 0,
                    changes: this.changes 
                }, message);
            }
        );
    } catch (error) {
        console.error("❌ Unexpected error in /api/add-sn:", error.message);
        sendError(res, 500, 'Internal server error');
    }
});

// Get all registered SNs with pagination
app.get('/api/all-sns', (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || CONFIG.DEFAULT_LIMIT, CONFIG.MAX_LIMIT);
        const offset = (page - 1) * limit;

        // Get total count
        db.get(`SELECT COUNT(*) as total FROM devices`, [], (err, countRow) => {
            if (err) {
                console.error("❌ Count query failed:", err.message);
                return sendError(res, 500, "Query failed");
            }

            const total = countRow.total;
            const totalPages = Math.ceil(total / limit);

            // Get paginated results
            db.all(`SELECT sn, created_at FROM devices ORDER BY created_at DESC LIMIT ? OFFSET ?`, 
                [limit, offset], (err, rows) => {
                    if (err) {
                        console.error("❌ Query failed:", err.message);
                        return sendError(res, 500, "Query failed");
                    }

                    sendSuccess(res, {
                        devices: rows,
                        pagination: {
                            page,
                            limit,
                            total,
                            totalPages,
                            hasNext: page < totalPages,
                            hasPrev: page > 1
                        }
                    });
                }
            );
        });
    } catch (error) {
        console.error("❌ Unexpected error in /api/all-sns:", error.message);
        sendError(res, 500, 'Internal server error');
    }
});

// Get latest sensor data with pagination and filtering
app.get('/api/latest', (req, res) => {
    try {
        const sn = req.query.sn ? sanitizeInput(req.query.sn) : null;
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 5, CONFIG.MAX_LIMIT);
        const offset = (page - 1) * limit;

        let sql = `SELECT * FROM sensor_data`;
        let countSql = `SELECT COUNT(*) as total FROM sensor_data`;
        const params = [];
        const countParams = [];

        if (sn) {
            sql += ` WHERE sn = ?`;
            countSql += ` WHERE sn = ?`;
            params.push(sn);
            countParams.push(sn);
        }

        sql += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        // Get total count
        db.get(countSql, countParams, (err, countRow) => {
            if (err) {
                console.error("❌ Count query failed:", err.message);
                return sendError(res, 500, "Query failed");
            }

            const total = countRow.total;
            const totalPages = Math.ceil(total / limit);

            // Get paginated results
            db.all(sql, params, (err, rows) => {
                if (err) {
                    console.error("❌ Query failed:", err.message);
                    return sendError(res, 500, "Query failed");
                }

                sendSuccess(res, {
                    data: rows,
                    pagination: {
                        page,
                        limit,
                        total,
                        totalPages,
                        hasNext: page < totalPages,
                        hasPrev: page > 1
                    }
                });
            });
        });
    } catch (error) {
        console.error("❌ Unexpected error in /api/latest:", error.message);
        sendError(res, 500, 'Internal server error');
    }
});

// Export sensor data as CSV with filtering and pagination
app.get('/api/export-csv', (req, res) => {
    try {
        const sn = req.query.sn ? sanitizeInput(req.query.sn) : null;
        const startDate = req.query.start_date;
        const endDate = req.query.end_date;
        const limit = parseInt(req.query.limit) || CONFIG.CSV_CHUNK_SIZE;

        let sql = `SELECT * FROM sensor_data`;
        const params = [];
        const conditions = [];

        if (sn) {
            conditions.push(`sn = ?`);
            params.push(sn);
        }
        if (startDate) {
            conditions.push(`timestamp >= ?`);
            params.push(startDate);
        }
        if (endDate) {
            conditions.push(`timestamp <= ?`);
            params.push(endDate);
        }

        if (conditions.length > 0) {
            sql += ` WHERE ` + conditions.join(' AND ');
        }

        sql += ` ORDER BY timestamp DESC`;
        if (limit > 0) {
            sql += ` LIMIT ?`;
            params.push(limit);
        }

        const filename = `bin_sensor_${sn || 'all'}_${Date.now()}.csv`;
        const filePath = path.join(__dirname, filename);
        const ws = fs.createWriteStream(filePath);

        db.all(sql, params, (err, rows) => {
            if (err) {
                console.error("❌ Export query failed:", err.message);
                return sendError(res, 500, "Export failed");
            }

            if (rows.length === 0) {
                return sendError(res, 404, "No data found for export");
            }

            const csvStream = fastcsv.format({ 
                headers: true,
                writeHeaders: true
            });

            csvStream.pipe(ws);

            csvStream.on('finish', () => {
                res.download(filePath, filename, (err) => {
                    if (err) {
                        console.error("❌ Download error:", err.message);
                    }
                    // Clean up file
                    try {
                        fs.unlinkSync(filePath);
                    } catch (unlinkErr) {
                        console.error("❌ File cleanup error:", unlinkErr.message);
                    }
                });
            });

            // Process rows in chunks to avoid memory issues
            let processed = 0;
            const processChunk = () => {
                const chunk = rows.slice(processed, processed + 100);
                if (chunk.length === 0) {
                    csvStream.end();
                    return;
                }

                chunk.forEach(row => {
                    csvStream.write({
                        SN: row.sn,
                        Distance: row.distance,
                        Battery: row.battery,
                        Temperature: row.temperature,
                        Position: row.position,
                        Time: format(new Date(row.timestamp), 'yyyy-MM-dd HH:mm:ss')
                    });
                });

                processed += chunk.length;
                setImmediate(processChunk);
            };

            processChunk();
        });
    } catch (error) {
        console.error("❌ Unexpected error in /api/export-csv:", error.message);
        sendError(res, 500, 'Internal server error');
    }
});

// Get device statistics
app.get('/api/stats', (req, res) => {
    try {
        const sn = req.query.sn ? sanitizeInput(req.query.sn) : null;
        
        let sql = `SELECT 
            COUNT(*) as total_records,
            AVG(distance) as avg_distance,
            MIN(distance) as min_distance,
            MAX(distance) as max_distance,
            AVG(battery) as avg_battery,
            AVG(temperature) as avg_temperature
            FROM sensor_data`;
        
        const params = [];
        if (sn) {
            sql += ` WHERE sn = ?`;
            params.push(sn);
        }

        db.get(sql, params, (err, stats) => {
            if (err) {
                console.error("❌ Stats query failed:", err.message);
                return sendError(res, 500, "Query failed");
            }

            // Round numeric values
            Object.keys(stats).forEach(key => {
                if (typeof stats[key] === 'number' && !isNaN(stats[key])) {
                    stats[key] = Math.round(stats[key] * 100) / 100;
                }
            });

            sendSuccess(res, stats);
        });
    } catch (error) {
        console.error("❌ Unexpected error in /api/stats:", error.message);
        sendError(res, 500, 'Internal server error');
    }
});

// 404 handler for undefined routes
app.use('*', (req, res) => {
    sendError(res, 404, `Route ${req.originalUrl} not found`);
});

// Global error handler
app.use((error, req, res, next) => {
    console.error("❌ Unhandled error:", error.message);
    sendError(res, 500, 'Internal server error');
});

// --- Graceful Shutdown ---
function shutdown(signal) {
    console.log(`\n⚠️ Shutting down gracefully (${signal})...`);
    
    // Close MQTT connection
    if (mqttClient.connected) {
        mqttClient.end(true, () => {
            console.log('✅ MQTT connection closed');
        });
    }
    
    // Close database connection
    db.close((err) => {
        if (err) {
            console.error('❌ Database close error:', err.message);
        } else {
            console.log('✅ Database connection closed');
        }
        
        console.log('👋 Server shutdown complete');
        process.exit(0);
    });
}

// Handle shutdown signals
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err.message);
    shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    shutdown('unhandledRejection');
});

module.exports = app;
