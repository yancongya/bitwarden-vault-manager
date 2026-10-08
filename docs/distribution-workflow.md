# Bitwardenagents 统一交付流程

## 唯一来源

`bitwarden-vault-manager` 是业务源码的唯一仓库。Web 前端在 `src/`，API 代理和会话服务在 `server.js`，CLI 在 `agent-harness/`，Agent 指南的唯一维护文件是 `agent-harness/skills/SKILL.md`。SkillDo 的中央目录是分发副本，各 Agent 工具目录只放 SkillDo 登记的软链。

三种交付物共享同一仓库版本，但数据目录各自独立。NAS Web 与容器内 CLI 复用 NAS 上的 `/data/session`；将来的 macOS App 使用自己的本地应用数据目录，通过 Bitwarden 服务同步账户内容，不复制 NAS 会话文件。

## 默认交付：Docker + NAS + CLI/Skill

1. 检查仓库状态和目标 NAS 容器身份，保留未提交页面工作；确认本次要包含的源码版本。
2. 在本地运行 `node agent-harness/tests/run.js`、`npm run build`、`git diff --check`。涉及会话或部署时按 `docs/security-report.md` 复核安全边界。
3. 使用仓库根目录的 `./build-and-deploy.sh` 构建 `linux/amd64` 镜像并替换 NAS `bwvault` 容器。该脚本保留既有 `/vol1/1000/services/data/bwvault:/data` 挂载；发布前仍须核对目标主机、架构和回滚容器。
4. 部署后验证运行镜像与本地构建身份、容器健康、数据挂载、HTTPS、受保护会话接口，以及至少一条真实 CLI 只读任务。构建日志或脚本退出码不能替代线上验证。
5. 仓库中的 `agent-harness/skills/SKILL.md` 作为 `bwvault-cli` 的唯一编辑源。合并旧中央副本的有效内容后，由 SkillDo 登记来源并同步到已安装的 Agent 工具；实际检查每条目标是指向中央目录的软链。

本机 Agent 通过全局 `bwvault` 包装命令连接既有 NAS 容器。SkillDo 运行在本机，管理本机 Agent 的 skill；它不是 NAS 容器里的运行时依赖。若将来 NAS 上也运行 Agent，需要在 NAS 上单独安装 SkillDo 客户端并同步该机器的工具目录，不能把本机路径直接挂进容器。

## 可选交付：macOS 独立 App

仅当项目改造明确选择桌面交付时实施。桌面 App 应打包同一仓库的 Web 前端与本地服务，绑定本机接口、使用独立的应用数据目录，并关闭渲染进程的 Node 权限。构建后需要在实际 macOS App 中验证首次启动、登录、关键业务、退出重启及数据持久化；签名与公证状态单独记录。当前仓库尚未提供桌面打包入口，因此不能把已有 Web 构建声称为可安装 App。

`myworkforce` 默认执行 11 阶段；需要桌面版时用 `myworkforce --json plan PROJECT --desktop` 和 `myworkforce --json start PROJECT --desktop`，额外执行 `desktop` 与 `desktop-test`。该选择属于本次运行记录，不能中途切换。SkillDo 分发与 Docker/NAS 验收仍在默认阶段中。
