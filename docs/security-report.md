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
- `npm audit` 因当前 npm 镜像不支持 advisory endpoint，未取得有效结果

## 修复顺序

1. 保护或移除未认证的 `POST /api/session`。
2. 将解锁状态改为短期、客户端绑定、可撤销的 HttpOnly 会话。
3. 关闭对外 HTTP 3000，仅通过可信 HTTPS 反向代理提供服务。
4. 使用 Argon2id/scrypt，并加入 PIN 失败限速、退避和锁定。
5. 对静态文件路径做 `realpath`/目录边界校验。
6. 启用只读 rootfs、`cap_drop: [ALL]`，并进行镜像扫描。

## 后续建议

后续可继续接入镜像漏洞扫描、反向代理审计、日志告警和定期依赖更新；任何涉及认证、会话或部署的改动都必须重新执行本报告中的回归检查。
