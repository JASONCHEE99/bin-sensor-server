# Bin Sensor Server

Unified EM400-MUD uplink bridge. Messages from MQTT are verified, normalised, and persisted into SQLite with HTTP APIs and dashboard visualisation.

## Contents
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Data Flow](#data-flow)
- [Database Schema](#database-schema)
- [Operations](#operations)
- [Testing & Replays](#testing--replays)
- [Security Incident: Secret Rotation](#security-incident-secret-rotation)

## Quick Start
```bash
npm install
npm run migrate
npm run seed        # optional demo data
npm run dev         # nodemon
# or
npm start
```
Dashboard: [http://localhost:3000](http://localhost:3000)

## Environment Variables
Create `.env` from `.env.example`. Values are read via `config.js`.

| Name | Purpose |
|------|---------|
| `NODE_ENV` | `development` / `production` / `test`. Enables safe defaults. |
| `PORT` | HTTP listen port (default `3000`). |
| `DATABASE_PATH` | SQLite file path. |
| `MQTT_BROKER_URL` | Broker URL e.g. `mqtts://broker:8883`. |
| `MQTT_USERNAME`, `MQTT_PASSWORD` | Optional MQTT credentials. |
| `MQTT_CLIENT_ID` | Custom client ID (random default). |
| `MQTT_STATUS_SN` | SN used when publishing server status messages (default `server`). |
| `MQTT_TLS_CA`, `MQTT_TLS_CERT`, `MQTT_TLS_KEY` | TLS material paths (optional). |
| `MQTT_TLS_REJECT_UNAUTHORIZED` | Enforce broker certificate validation (`true` by default). |
| `CORS_WHITELIST` | Comma separated origins for the dashboard. Empty ⇒ allow all. |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | HTTP rate limiting window & max requests. |
| `PARSE_ERROR_RETENTION_DAYS` | Future cleanup policy for `parse_errors`. |
| `LOG_LEVEL` | Application log level (planned). |

## Data Flow
```
               ┌─────────────────────────────┐
               │  Milesight EM400-MUD Sensor │
               └──────────────┬──────────────┘
                              │ TLV payload
                              ▼
                     sensors/bin/{sn}/uplink
                              │
                ┌─────────────┴─────────────┐
                │       MQTT Broker         │
                └─────────────┬─────────────┘
                              │ QoS1, clean session,
                              │ TLS/credentials from .env
                              ▼
                   Bin Sensor Server (this repo)
                   ├─ `mqtt-service.js` → TLV parser
                   │    └─ store idempotent records (sn + payload hash)
                   ├─ `app.js` HTTP API / dashboard
                   └─ WebSocket push for live charts
                              │
                              ▼
                     SQLite (`sensor_data`, `parse_errors`)
                              │
                              ▼
                  `/api/*` & `/public/index.html`
```

Topic conventions (all QoS 1, retain disabled):
- Uplink ingest: `sensors/bin/{sn}/uplink`
- Device status: `sensors/bin/{sn}/status` (`online/offline/unknown`)
- Downlink staging: `sensors/bin/{sn}/downlink` (reserved)

## Database Schema
`sensor_data`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Autoincrement |
| `sn` | TEXT NOT NULL | Device serial |
| `distance_cm` | REAL | Derived from TLV |
| `distance_mm` | INTEGER | Exact millimetres |
| `battery` | INTEGER | Percentage |
| `temperature_c` | REAL | Celsius |
| `position` | TEXT | `normal` / `tilt` |
| `temperature_alarm` | INTEGER | 0/1 |
| `distance_alarm` | INTEGER | 0/1 |
| `ts` | DATETIME DEFAULT CURRENT_TIMESTAMP | Server timestamp |

Supporting tables:
- `devices(sn PRIMARY KEY, added_at)`
- `parse_errors(id, sn?, raw_payload, error_message, ts)` – samples for replay.
- `ingest_dedup(sn, payload_hash, ts)` – prevents duplicate inserts.

Indexes:
- `idx_sensor_data_sn_ts` on `(sn, ts)`
- Primary key (sn, payload_hash) on `ingest_dedup`

## Operations
- **Migrations**: `npm run migrate`
  - Converts legacy `robot_SN` fields to `sn`
  - Backfills new measurement columns
- **Seed data**: `npm run seed demo-device-001`
- **Replay parse errors**: `npm run replay -- --apply`
- **Lint**: `npm run lint`
- **Tests**: `npm test`

### HTTP APIs (selected)
| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/add-sn` | Register device `{ sn }` |
| POST | `/api/data` | Manual insert `{ sn, sensor: { distance_cm?, battery?, ... } }` |
| GET | `/api/latest?sn=&limit=` | Paginated readings |
| GET | `/api/stats?sn=` | Aggregate metrics |
| GET | `/api/parse-errors` | Inspect failed MQTT payloads |
| GET | `/healthz` / `/readyz` | Liveness & readiness (checks DB + MQTT) |

All request bodies validated via Zod; responses normalised numeric-only fields.

## Testing & Replays
| Command | Description |
|---------|-------------|
| `npm test` | Jest unit tests covering TLV channels & alarm flags. |
| `npm run replay -- --limit 10` | Dry-run decoding of recent parse failures. |
| `npm run replay -- --apply` | Replay and insert successful decodes; clears entries. |

## Security Incident: Secret Rotation
If `.env` or credentials leak:
1. Rotate keys/secrets at the provider (MQTT, TLS, downstream APIs).
2. Replace environment values in deployment targets.
3. **Repository cleanup**  
   - `git filter-repo --path .env --invert-paths` (preferred)  
   - or `bfg --delete-files .env`  
   - Force-push and invalidate existing clones.
4. Reissue certificates if TLS assets were exposed.
5. Document incident date & credentials rotated in your operational log.

Historical backups containing secrets must be purged; ensure CI/CD artifacts are rotated as well.
