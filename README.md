# 项目交付与开业倒推排期系统 (Cloudflare Pages + KV 多人实时共享版) via gemini argon

## 包含文件
- `index.html`: 前端单页应用（支持甘特图倒推、多套设备合算、多人排期共享列表、历史版本回滚、管理员权限锁）
- `functions/api/data.js`: Cloudflare Pages Functions 后端接口（对接 Cloudflare KV 实现实时多人同步与修改记录存储）


## 部署步骤
1. 在 Cloudflare Dashboard -> **Storage & Databases -> KV** 创建命名空间 `GANTT_KV_STORE`。
2. 在 **Workers & Pages -> Create -> Pages** 上传本压缩包解压后的文件夹（含 `index.html` 与 `functions/` 目录）。
3. 在 Pages 项目的 **Settings -> Functions -> KV namespace bindings** 中绑定变量名 `GANTT_KV` 指向 `GANTT_KV_STORE`，并重新部署一次即可生效。
4. 默认管理员(解锁后可维护常规产品库、国家与预计船期，也可删除历史排期）。
