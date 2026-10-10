---
name: bwvault-cli
description: 使用持久化 Bitwardenagents/bwvault CLI 管理密码库、稳定凭据别名及密码健康度。适用于密码、API key、token 和凭据支持的自动化；默认脱敏、写操作先预览。
---

# bwvault CLI

本 Skill 的唯一维护来源是本仓库 `agent-harness/skills/`。SkillDo 管理一份中央副本，再软链到各 Agent 工具。项目源码、Docker 镜像和 macOS 软件均从本仓库构建；Skill 只教 Agent 调用已安装的 CLI，不在运行时依赖仓库路径。

## 入口与数据边界

- 本机全局命令：`bwvault`；兼容别名：`bitwardenagents`。包装脚本连接既有 NAS 容器，复用持久 `/data/session`，不创建临时容器或另一套 vault。
- 在本仓库可用 `./bitwardenagents`；容器内入口是 `/app/agent-harness/bin/bwvault.js`。
- NAS 默认连接、容器名和数据挂载由全局包装脚本维护；连接失败时先检查包装脚本和现有容器，不让用户重发已托管的凭据。
- 独立本地软件若启用，使用本地独立会话目录；与 NAS 实例共享 Bitwarden 账户数据须通过 Bitwarden 同步完成，不能共用或复制 `/data/session`。

## 安全规则

1. 不输出密码、token、API key、PIN、会话材料、解密后的 vault 字段或请求载荷。仅当具体任务需要，并获明确授权时使用 `--reveal`；把结果直接送往目标进程，不写日志或报告。
2. 密值只经 stdin、隐藏输入或短期环境变量传入，绝不放在命令参数、仓库、Skill 或文档里。凭据以稳定 alias 引用，不记录 cipher id。
3. 写操作先预览，用户已授权该变更时才加 `--apply`。软删除可恢复；`purge` 不可逆且需 `--yes`。
4. 生产诊断默认只读。认证、会话、Docker 或部署代码变更后，执行本项目测试与构建，再核验实际运行版本及安全边界。
5. 不因一次 `401` 就删除会话、重置 vault 或索取主密码。先重试一次，再检查持久 API key 格式与错误原因。

## 标准流程

```bash
bwvault auth status --json
bwvault credential list --json
bwvault credential get --alias svc.api.token --reveal --json
```

`credential list` 只列 alias 和非敏感元数据。读取特定密值时，避免把 `get --reveal` 的 stdout 展示给 Agent 对话或终端记录，直接管道传给消费方。`credential set` 从 stdin 读取密值，仅报告创建或更新状态：

```bash
printf '%s' "$SECRET" | bwvault credential set --alias svc.api.token --username svc --apply
```

代表性只读命令：`bwvault vault list --json`、`bwvault vault search QUERY`、`bwvault analyze health --json`、`bwvault analyze duplicates --json`。管理命令包括 `manage dedup`、`manage trash list/restore/purge` 和 `manage folders create/rename/delete`；执行前使用各命令帮助检查精确参数。

## 持久会话

- CLI 和 NAS Web 服务复用 `/data/session`。新版 API key 凭据由 `/data/session/agent-key` 保护，可在 token 过期和容器重启后自动续期。
- NAS 部署通过 Agent Ops 登记的 `scripts/deploy_nas.py` 适配器；源码归档从 Mac 流式传到 NAS，Docker 镜像只在 NAS 构建。本机不启动 Docker、OrbStack 或容器。
- `auth status --json` 是首选的无密值检查。写入或同步返回 `401` 时先重试一次；仍失败时检查 API key 凭据是否为 `version: 2` 且 `keySource: agent-key`，只报告版本与状态。
- 仅旧版 `version: 1` 可能需要在私密终端完成一次 PIN 迁移。不得把 PIN 放在命令参数、聊天或 HTTP 请求示例中。
- 每次读取会解密整个库，避免在高频 hook、循环或每次对话中运行 `credential get`；只在任务实际需要时调用。

## Web 与容器安全边界

- `/api/session` 写入必须通过同源、客户端解锁及 schema 检查；PIN 解锁须绑定客户端、限时且限速。
- 不把 HTTP 3000 暴露到不可信网络；NAS Web 使用 HTTPS 3443。静态路径必须限制在构建产物目录内。
- 生产容器保留原有数据挂载、非 root 用户、只读根文件系统、丢弃 Linux capabilities 和 `no-new-privileges`。
- `/data/session` 是敏感数据，保留既有挂载和 `0600` 文件权限。不得用新的 named volume 诊断线上会话。

认证、会话、容器或部署代码修改后，在仓库运行 `npm run build`、`node agent-harness/tests/run.js` 和 `git diff --check`，并按 `docs/security-report.md` 更新验证记录。构建成功不等于 NAS 已更新；部署后核对容器健康、镜像身份、挂载和关键业务接口。

## SkillDo 分发

从本仓库 `agent-harness/skills/` 安装名为 `bwvault-cli` 的 Skill。中央目录应是唯一分发实体；Codex、Claude、WorkBuddy、MimoCode 等工具目录由 SkillDo 登记并使用指向中央目录的软链。更新时先检查仓库文件、中央文件与未提交改动，合并有效内容后再同步。`skilldo list` 的状态只是数据库记录，须实际检查软链及其解析路径。
