# PR 摘要

## 变更概览
- 新增统一配置层（`config.js`）与 SQLite 迁移脚本，提供 `sn` 字段对齐、幂等去重、解析失败留存。
- 重写 MQTT / HTTP 服务：使用严格 TLV 解析、Helmet、白名单 CORS、速率限制、Zod 校验、健康探针及 WebSocket 推送。
- 新增 `milesight-unified-em400-mud.js` 并编写单元测试，覆盖 01/75、03/67、04/82、83/67、84/82 等告警分支。
- 前端改版，统一字段命名并修复乱码；提供 CSV 导出与实时提示。
- 项目卫生：`.gitignore`、`.env.example`、README 文档、PR 指引、脚本 (`migrate`/`seed`/`replay`) 与 npm scripts 更新。

## 风险与关注点
1. **数据库迁移**：旧版表结构（`distance`, `robot_SN` 等）会被复制到新表，需确保备份后再执行 `npm run migrate`。
2. **MQTT 凭据**：连接选项默认启用 TLS 验证；若测试环境使用自签名证书请设置 `MQTT_TLS_REJECT_UNAUTHORIZED=false`。
3. **CORS 白名单**：未配置 `CORS_WHITELIST` 时允许所有域访问，生产环境需显式设置。
4. **资源占用**：WebSocket 广播仅在有客户端时推送，仍建议部署前完成容量评估。

## 如何回滚
1. 停服：`pm2 stop bin-sensor-server` 或相应进程管理器。
2. 恢复代码：`git checkout <上一个稳定 tag 或 commit>`，并重新安装依赖、复制旧版 `.env`。
3. 如已执行迁移：从备份恢复 `database.db`，或利用迁移前导出的 SQL dump。
4. 启动旧版：`npm install && npm start`，验证 MQTT / HTTP 流程后再恢复对外流量。
