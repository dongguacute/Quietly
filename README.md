# Quietly（Demo）

本地演示项目：Vue 3 + Vite 前端，Express 内存 API。聊天页可体验「按联系人分类 + 延迟浏览器通知」的粗糙原型——**无鉴权、无持久化、不适合生产**。

包管理请用 [pnpm](https://pnpm.io/)（见 `AGENTS.md`）。

## 快速开始

```bash
pnpm install
pnpm dev:all
```

浏览器打开 Vite 提示的地址（一般为 `http://localhost:5173`），聊天需同时跑 API；`dev:all` 会一并启动。仅前端用 `pnpm dev`，仅 API 用 `pnpm dev:api`（默认 `http://127.0.0.1:3000`，开发时 `/api` 由 Vite 代理过去）。

其他：`pnpm build` 构建，`pnpm preview` 预览构建结果，`pnpm typecheck` 类型检查。

## 许可

见 `LICENSE`。
