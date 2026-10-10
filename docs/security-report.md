# Bitwardenagents 安全审核报告

> 状态：生产部署后版本。已部署到 NAS 并完成线上只读验证。

## 范围

- 应用：`server.js`、Cloudflare Functions、`agent-harness`、会话与 PIN 逻辑
- 部署：Dockerfile、Compose、NAS 线上容器暴露面
- 方法：OWASP WSTG/ASVS、CIS Docker Benchmark、低风险动态验证
- 限制：未读取或展示真实密码、API key、access token；未执行线上写操作、删除、解锁或压力测试

## 当前结论

修复前版本不建议直接暴露到不可信网络。当前代码已收紧 session 写入、按客户端隔离 PIN 解锁状态、使用 scrypt 和失败限速、校验静态路径边界，并完成基础容器加固；本次已完成生产部署与上线验证。

## 发现摘要

| 等级 | 问题 | 证据 | 状态 |
| --- | --- | --- | --- |
| 严重 | `POST /api/session` 未认证即可覆盖 session 文件 | 已增加同源、解锁 cookie 和 schema 校验 | 已修复并线上验证 |
| 高危 | PIN 解锁状态是进程级全局状态 | 已改为客户端绑定解锁 cookie | 已修复并线上验证 |
| 高危 | HTTP 3000 对外发布并处理会话 API | 已绑定 localhost，远程访问失败 | 已修复并线上验证 |
| 中高 | PIN 使用单次 SHA-256 且无限速/锁定 | 新 PIN 使用 scrypt，失败 5 次限速 | 已修复并线上验证 |
| 中 | 静态路径缺少明确的 `DIST` 边界校验 | 已做 URL 解码和目录边界校验 | 已修复并线上验证 |
| 中 | 容器 root filesystem 可写 | 已启用 read-only 和 cap_drop | 已修复并线上验证 |

## 已完成验证

- `npm run build` 通过
- `node agent-harness/tests/run.js`：23/23 通过
- `git diff --check` 通过
- 隔离环境：无 `Origin` 或跨源 `Origin` 的 session 写入返回 403；合法同源请求仍返回 200
- scrypt PIN：正确 PIN 验证成功，错误 PIN 失败；失败次数达到阈值后返回 429
- 静态路径：请求路径经过解码、规范化和 `DIST` 边界校验
- 线上容器：`healthy`、用户为 `node`、只读 rootfs、`cap_drop=ALL`、`no-new-privileges=true`
- 线上接口：HTTPS 3443 正常；远程 HTTP 3000 不可达；未授权 session 写入返回 403；未解锁 session 读取返回 401
- NAS 线上 `/api/pin`、HTTPS/HTTP 端口和容器非秘密配置完成只读确认
- 本机默认 npm 镜像不支持 advisory endpoint；改用官方 npm registry 审计。2026-10-08 修复构建依赖后，全量及 `--omit=dev` 审计均为 0 项告警

## 2026-10-08 发布复核

- 源码已推送到 `main`，构建依赖修复提交为 `000ccc8`；CLI 测试 23/23、Web 构建、`git diff --check` 通过。
- NAS 上新容器的镜像 ID 与本机构建一致：`sha256:bebeba518bcde7505aa681f4a21d2626dfaeda3cc182dbe2c35947c709d29158`。容器 `healthy`，运行用户 `node`，只读 rootfs、`cap_drop=ALL`、`no-new-privileges=true`，数据挂载仍为 `/vol1/1000/services/data/bwvault:/data`。
- 实际 HTTPS 入口返回 200；未解锁 session 读取返回 401，未授权 session 写入返回 403，远程 HTTP 3000 不可达。本机 `bwvault auth status --json` 通过新容器返回有效会话，仅核对安全元数据，未输出密值。
- NAS 页面在真实浏览器中显示 PIN 验证界面；首次加载时登录页与面板均隐藏。公开落地页在浏览器中先显示引导层，结束后才显示主内容。
- 本轮未执行线上解锁、密码读取、凭据写入、删除或压力测试；这些业务路径不属于此次只读发布验收。

## 修复顺序

1. 保护或移除未认证的 `POST /api/session`。
2. 将解锁状态改为短期、客户端绑定、可撤销的 HttpOnly 会话。
3. 关闭对外 HTTP 3000，仅通过可信 HTTPS 反向代理提供服务。
4. 使用 Argon2id/scrypt，并加入 PIN 失败限速、退避和锁定。
5. 对静态文件路径做 `realpath`/目录边界校验。
6. 启用只读 rootfs、`cap_drop: [ALL]`，并进行镜像扫描。

## 后续建议

后续可继续接入镜像漏洞扫描、反向代理审计、日志告警和定期依赖更新；任何涉及认证、会话或部署的改动都必须重新执行本报告中的回归检查。

## 2026-10-09 部署入口加固与 NAS 验收

- `build-and-deploy.sh` 默认显示计划；仅 `apply --yes` 才构建并连接 NAS。
- 部署要求 Git 工作区干净，镜像标签由源码 HEAD 生成；当前通过 `~/.config/agent-ops/runtime.json` 中的非秘密 `nasSshTarget` 使用非交互密钥 SSH 传输，不依赖 SkillDo `infra-ops` wrapper，也不拼接凭据。
- NAS 侧先验证现有 `/data` bind mount 与固定数据目录一致。新容器必须通过 Docker healthcheck；失败时保留失败容器并尝试恢复先前容器，不删除容器或数据卷。
- Agent Ops 已登记该更新适配器。提交 `35790bb20a773c0b4a289ce35ae041794293d1aa` 已推送并部署；NAS 容器镜像为 `bwvault:release-35790bb20a773c0b`，运行和 Docker healthcheck 均为 healthy，`/data` 仍绑定到 `/vol1/1000/services/data/bwvault`，HTTPS 首页返回 200。
- 历史部署曾使用 `infra-ops` SSH wrapper，并修复过其输入转发缺陷；当前部署入口已改为直连系统 SSH，仍以独立回归验证镜像流和远端脚本的标准输入。

## 2026-10-10 NAS 原生构建部署入口

- 更新适配器不再调用 Mac 本地 Docker Buildx；它从干净 Git revision 创建源码归档并通过 Agent Ops 配置的 SSH 目标流式发送给 NAS。
- 镜像构建在 NAS 的 Docker Engine 上完成，部署前验证候选镜像存在；保留既有 `/data` bind mount、健康检查和旧容器恢复逻辑。
- 回归覆盖源码流、远端构建命令、无本地 Docker 调用、脏工作树阻断和健康验收失败恢复；自动化测试通过不等于 NAS 实际部署验收。

## 2026-10-10 CLI 写入会话续期修复（待生产验证）

- 发现：CLI 只读操作可复用 10 分钟加密缓存；若写入前命中缓存，访问令牌可能已过期，而写请求路径不会触发 API Key 自动续期，导致合法 `credential set` 等操作返回 401。
- 修复：所有带 `--apply` 的密码库变更先强制进行远端同步；同步 401 时使用持久化 API Key 凭据续期并重试。远端同步或续期失败时不回退缓存，写操作保持失败关闭。只读查询继续复用缓存。
- 验证：新增隔离测试验证只读缓存命中不访问网络、强制远端模式遇到 401 不回退缓存、持久 API Key 可续期并重试；Agent Harness 23 项基础测试与会话缓存测试、npm 包 smoke test、Web 构建均通过。
- 状态：本地源码已验证；生产容器尚未更新，本节不代表线上写入已验收。
