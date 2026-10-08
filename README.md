<a id="readme-top"></a>

<div align="center">

# Bitwardenagents

**零知识的 Bitwarden 密码库管理面板，外加一套给 AI Agent 用的命令行工具。浏览器里完成全部解密，`bwvault` CLI 让 Agent 能安全地批量体检、去重、整理密码库——全程不吐明文。**

[在线演示 (bitwardenagents.itycon.cn)][demo] ·
[报告 Bug][bug] ·
[功能建议][feat] ·
[英文 llms 文档][llms]

</div>

<div align="center">

[![License: MIT][license-shield]][license-url]
[![Live Demo][demo-shield]][demo]
[![Platforms][platforms-shield]][platforms-url]
[![Node: ≥ 20][node-shield]][node-url]
[![Docker][docker-shield]][docker-url]

</div>

> [!IMPORTANT]
> **所有加解密均在浏览器本地完成。** 主密码永不离设备，服务端仅做 Bitwarden API 代理转发（Cloudflare Pages Functions 或自托管 Node），不接触任何明文数据。

<details>
<summary><strong>目录</strong></summary>

- [项目简介](#项目简介)
- [功能特性](#功能特性)
  - [Web 仪表板](#web-仪表板)
  - [智能去重引擎](#智能去重引擎)
  - [健康分析](#健康分析)
  - [URL 失效检测](#url-失效检测)
  - [命令行工具 `bwvault`](#命令行工具-bwvault)
- [快速上手](#快速上手)
  - [在线体验](#在线体验)
  - [本地开发](#本地开发)
  - [Docker 自托管](#docker-自托管)
  - [一键部署到 NAS](#一键部署到-nas)
- [CLI 命令参考](#cli-命令参考)
- [Agent 接入](#agent-接入)
- [架构与安全模型](#架构与安全模型)
- [安全审核与运行边界](#安全审核与运行边界)
- [部署选项](#部署选项)
- [常见问题](#常见问题)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

</details>

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

<a id="项目简介"></a>

## 项目简介

Bitwardenagents 是一个**面向 Bitwarden 用户的开源扩展工具**，两条腿走路：一块是浏览器里的零知识管理面板（合并重复条目、批量整理、URL 失效检测、健康评分），另一块是给 AI Agent 用的 `bwvault` 命令行工具。所有密码学运算（Argon2id/PBKDF2 密钥派生、HKDF-Expand、AES-256-CBC 解密）都在本地完成，服务端只做代理转发。

> [!TIP]
> **给 Agent 用的话，直接看 [Agent 接入](#agent-接入)**——`bwvault` 默认脱敏、变更默认 dry-run，配一份 `SKILL.md` 就能让 Agent 安全地接管密码库整理。

> [!NOTE]
> 截图待补充：`docs/assets/` 目录尚未建立真实界面截图；当前可前往 [在线演示](https://bitwardenagents.itycon.cn/) 查看实际效果（无需登录，点击"演示模式"即可）。

**为什么需要它：**

- **官方 Web Vault 没做的脏活它都做**：合并重复条目（URI + 用户名 + 密码三重匹配、含通行密钥条目的安全合并）、批量移动、回收站。
- **Agent 可以安全接管**：密码永不进 argv、输出默认脱敏、写操作默认 dry-run、删除一律软删除可恢复——这四条让 AI Agent 能在无人监督下批量整理密码库而不泄漏明文。
- **可自托管、可审计**：同一份代码既能跑在 Cloudflare Pages（静态站点 + Pages Functions 代理），也能用 Docker 自托管到 NAS——服务端只代理、不解密。
- **同一套加密引擎，Web 与命令行复用**：`bwvault` CLI 通过桥接层复用浏览器侧的加密实现，避免两套代码出现实现漂移。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

<a id="功能特性"></a>

## 功能特性

<a id="web-仪表板"></a>

### Web 仪表板

- **三种登录方式**
  - **API Key（推荐）**：`client_id` + `client_secret` + 邮箱 + 主密码，绕过 CAPTCHA。
  - **主密码登录**：官方密码登录流程，支持新设备验证。
  - **加密凭证文件**：登录后生成 `.bwcred`（AES-256-GCM 加密），下次拖拽文件 + 输入口令即可一键登录，无需重新输入 API Key。
- **多视图侧栏**：总览 / 登录条目 / 支付卡 / 身份 / 安全笔记 / SSH 密钥 / 文件夹 / 收藏 / 损坏条目 / 回收站。
- **乐观热更新**：删除、编辑、移动、文件夹管理等操作即时反映 UI，后台静默同步；服务端失败时 Toast 提示 + 自动 resync 回滚。
- **回收站**：恢复（可选目标文件夹）、永久删除、批量操作。
- **国际化**：中文 / 英文双语，约 300+ 个翻译键，浏览器自动检测 + 手动切换。
- **明暗主题**：跟随系统或手动切换，Design Tokens 统一管理。

> [!CAUTION]
> **永久删除**保持悲观模式：UI 仅在服务端确认成功后更新，不可逆操作双重保护。

<a id="智能去重引擎"></a>

### 智能去重引擎

- **完全重复检测**：URI + 用户名 + 密码三重匹配（SHA-256 摘要，不持明文）。
- **同站重复检测**：基于 eTLD+1 多段 TLD 注册表（30+ 国别 TLD）分组，识别 Android/iOS App URI 同站。
- **深度字段比较**：名称、TOTP、URI、备注、自定义字段、通行密钥（`Fido2Credentials`）、收藏、Reprompt 状态。
- **AB 两路合并策略**
  - **Path A（纯删除）**：所有字段 100% 一致 → 保留一个，软删除其余。
  - **Path B（Create-Then-Delete）**：有差异 → 合并为新条目 → 服务端确认后再删除所有原条目；包含通行密钥的条目走 per-cipher Key + Fido2Credentials 保全路径（Bitwarden API 拒绝带通行密钥条目的 PUT 更新）。
- **安全保证**：全部软删除（30 天可恢复）；Path B 新建失败绝不删除原条目。

<a id="健康分析"></a>

### 健康分析

按风险分类扫描整个密码库，0–100 分综合评分：

| 严重度 | 类别 | 规则 |
|--------|------|------|
| 高 | 弱密码 | 长度 < 8、纯数字、纯字母 |
| 高 | 空密码 | 登录条目无密码 **且** 无通行密钥 |
| 高 | 解密失败 | 条目损坏（无法解出明文） |
| 中 | 密码重复 | 同密码跨站点复用 |
| 中 | 过期密码 | > 1 年未更新 |
| 中 | 不安全 URI | 使用 `http://` 而非 `https://` |
| 低 | 缺失 URL | 登录条目未填写 URL |
| 低 | 缺失标题 | 条目名称为空 |

**评分公式**：`score = 100 − (high×3 + med×1.5 + low×0.5) / totalLogins × 25`

<a id="url-失效检测"></a>

### URL 失效检测

- **登录后一次性全量扫描**：自动检测所有条目 URL 的连通性。
- **双策略探测**：`fetch (no-cors)` + `<img>` favicon 双路验证，智能识别 Cloudflare 等 Bot 防护。
- **301 条主流域名白名单**：Google / Apple / Microsoft / Amazon / Meta / Netflix / 阿里 / 腾讯 / 字节 等；父域名同样命中，自动跳过。
- **实时进度条**：渐变动画 + 已检域名计数。
- **批量操作**：全选 / 批量删除 / 批量移动。
- **ID 去重**：同一条目绝不重复展示。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

<a id="命令行工具-bwvault"></a>

### 命令行工具 `bwvault`

- **5 个分组、17 个命令**：`auth` / `vault` / `analyze` / `manage` / `credential`。
- **凭据别名系统**：`credential set --alias nas.ssh` 用稳定别名存取服务凭据，密码只从 stdin / 隐藏 prompt / `BWVAULT_SECRET` 环境变量读取，永远不进 argv 与 stdout。
- **交互式 REPL**：直接 `bwvault` 进入交互模式。
- **零明文泄漏**：默认 redact 密码 / TOTP / 卡号 / 私钥；需明文时加 `--reveal`，且需手动确认。

完整命令清单见 [CLI 命令参考](#cli-命令参考)。

<a id="快速上手"></a>

## 快速上手

<a id="在线体验"></a>

### 在线体验

访问 **[bitwardenagents.itycon.cn](https://bitwardenagents.itycon.cn/)**，点击登录页"演示模式"按钮，无需 Bitwarden 账户即可体验所有功能。

> [!TIP]
> 演示模式下所有数据为内置假数据，不与任何真实账户通信。

<a id="本地开发"></a>

### 本地开发

```bash
git clone https://github.com/yancongya/bitwardenagents.git
cd bitwardenagents
npm install
npm run dev   # Vite 开发服务器，http://localhost:5173
```

**环境要求**：Node.js ≥ 20（Docker 镜像使用 `node:22-slim`）。Bitwarden 账户 + 推荐获取一个 Personal API Key（设置 → 安全 → 密钥 → 查看 API 密钥）。

<a id="docker-自托管"></a>

### Docker 自托管

多阶段构建（无 dev 依赖、运行用户 `node:1000`、单卷 `/data` 持久化会话）。

```bash
# 1. 启动 Web UI（HTTP 3000 + HTTPS 3443 首次启动自动签发自签证书）
docker build -t bwvault .
docker run -d --name bwvault \
  -p 3000:3000 -p 3443:3443 \
  -v bwvault-data:/data \
  --restart unless-stopped \
  bwvault

# 2. 在同一个容器内登录（一次性，写入加密的 API Key + 会话）
echo "$BWVAULT_PASSWORD" | docker exec -i bwvault \
  node /app/agent-harness/bin/bwvault.js \
  auth login --api-key \
  --client-id "user.xxxx-xxxx-xxxx" \
  --client-secret "xxxxx" \
  --email you@example.com

# 3. 日常 CLI 使用，同 Web 共享 /data/session
docker exec bwvault node /app/agent-harness/bin/bwvault.js vault list --json
docker exec bwvault node /app/agent-harness/bin/bwvault.js analyze health
```

NAS 生产环境不要另起 `docker run -v bwvault-data:/data`。线上容器使用宿主机
`/vol1/1000/services/data/bwvault:/data`，named volume 是另一套空数据。
在项目根目录直接使用固定代理命令：

```bash
./bitwardenagents auth status --json
./bitwardenagents credential list --json
./bitwardenagents vault list --json
```

写入服务凭据仍通过 stdin，不进入命令参数：

```bash
printf '%s' "$SECRET" | ./bitwardenagents credential set \
  --alias service.token --username agent --url https://service.example --apply --json
```

容器重启后，代理命令继续复用线上 `/data/session`。新版 API Key 凭据由持久
`agent-key` 保护，可自动续期；只有旧版凭据首次迁移可能需要在私密终端输入 PIN。

> [!WARNING]
> **生产环境不要把 HTTP 3000 暴露给不可信网络。** 它仍会处理会话和 API 代理请求；自托管时优先使用 `https://<your-host>:3443/`，并在防火墙或反向代理层限制 3000 仅供本机或受信网络访问。

<a id="一键部署到-nas"></a>

### 一键部署到 NAS

仓库自带 `build-and-deploy.sh`：在本地构建 `linux/amd64` 镜像 → `docker save` → SSH 传到 NAS → `docker load` → 替换容器并保留 `/vol1/1000/services/data/bwvault` 数据卷。

```bash
./build-and-deploy.sh
# 输出：
#   HTTPS: https://192.168.31.110:3443/
#   会话、PIN、设备 ID 与自动登录凭据均保存在 /vol1/1000/services/data/bwvault
```

> [!WARNING]
> 修改脚本顶部的 `NAS=` / `DATA_DIR=` 变量以匹配你的环境。脚本会保留旧容器为 `bwvault-before-<时间戳>` 30 秒后由你自行清理。

<a id="cli-模式"></a>

### CLI 模式（不开 Web）

```bash
# API Key 登录（推荐自动化场景）
export BWVAULT_CLIENT_ID="user.xxxx-xxxx-xxxx"
export BWVAULT_CLIENT_SECRET="xxxxx"
echo "主密码" | node agent-harness/bin/bwvault.js auth login \
  --api-key --email you@example.com

# 主密码登录
node agent-harness/bin/bwvault.js auth login --password --email you@example.com

# 交互式 REPL
node agent-harness/bin/bwvault.js
```

会话自动保存到 `~/.bwvault/session.json`（权限 `0600`），下次无需重复登录。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

<a id="架构与安全模型"></a>

## 架构与安全模型

```
bitwardenagents/
├── index.html               # 单页入口（含 OG / Twitter / JSON-LD）
├── server.js                # 生产服务器：静态资源 + Bitwarden API 代理 + HTTPS 自签
├── src/                     # Web 仪表板（纯 HTML/CSS/JS，无框架）
│   ├── app.js               # 主应用逻辑：URL 检测、乐观更新、UI 渲染
│   ├── bitwarden-api.js     # Bitwarden REST API 客户端
│   ├── crypto.js            # PBKDF2/Argon2 → HKDF-Expand → AES-256-CBC
│   ├── dedup-engine.js      # 去重 + 合并引擎
│   ├── health-engine.js     # 健康评分
│   ├── search-engine.js     # 搜索 / 过滤
│   ├── credfile/            # .bwcred AES-256-GCM 加解密
│   ├── data/domain-whitelist.js   # 301 条主流域名白名单
│   ├── design/tokens.css    # Design Tokens（亮/暗主题）
│   ├── icons/svg/           # 统一 SVG 图标系统（30+ 图标）
│   ├── i18n.js              # 中英双语 i18n
│   └── theme.js             # 主题切换
├── agent-harness/           # CLI（bwvault）：复用 src/ 加密引擎
│   ├── bin/bwvault.js
│   ├── core/                # bridge / session / security / vault / display
│   ├── commands/            # auth / vault / analyze / manage / credential
│   ├── utils/               # secrets / repl
│   ├── tests/               # 核心单元测试
│   └── skills/SKILL.md      # Agent 可发现的 skill 元数据
├── functions/[[path]].js    # Cloudflare Pages Functions（API 代理）
├── public/                  # 静态资源 + robots.txt + llms.txt
├── vite.config.js           # 开发代理（同 functions）
├── Dockerfile               # 多阶段、tini、非 root、HTTPS 自签
├── docker-compose.yml       # 容器编排（UID 1000、tmpfs、no-new-privileges）
├── build-and-deploy.sh      # 一键部署到 NAS
├── wrangler.toml            # Cloudflare Pages 配置
└── package.json
```

**安全模型**

- **零知识**：所有解密在本地完成，主密码不离开设备。
- **默认 redact**：密码 / TOTP / 卡号 / 私钥默认显示 `••••••••`，需 `--reveal` 才输出。
- **Digest 去重**：重复检测基于 SHA-256 摘要，不在共享数据结构中持明文。
- **Soft delete**：所有删除可恢复（~30 天），仅 `manage trash purge --id <id> --apply --yes` 不可逆。
- **会话文件**：只存派生后的对称密钥，权限 `0600`。
- **API Key 加密**：新版 API Key 凭据由持久的 `agent-key` 加密保存，容器/进程重启后可自动续期；旧版 PIN 加密文件首次迁移时才需要在私密终端输入 PIN。
- **磁盘缓存**：CLI 只缓存 Bitwarden 的加密响应，不缓存解密后的密码库。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

<a id="cli-命令参考"></a>

## CLI 命令参考

<details>
<summary><strong>完整命令清单（来源：<code>bwvault --help</code>）</strong></summary>

```
bwvault v1.0.0 — headless Bitwarden vault management

USAGE
  bwvault <group> <command> [options]

GROUPS
  auth      Authenticate and manage the local session
    login     Sign in (--api-key | --password)
    logout    Clear the stored session
    status    Show session info (never prints secrets)

  vault     Inspect and move data
    sync      Pull the latest vault from the server
    list      List entries (secrets redacted unless --reveal)
    search    Search entries by name/username/URI
    get       Show one entry in full (redacted unless --reveal)
    folders   List folders

  analyze   Read-only reporting (no vault mutation)
    health      Weak / empty / reused / stale passwords
    duplicates  Duplicate and same-site clusters
    urls        Dead-link candidates

  manage    Mutating operations (all support --dry-run)
    dedup     Merge duplicate entries (soft-delete, recoverable)
    trash     list | restore | purge  (purge is irreversible)
    folders   create | rename | delete

  credential Store service credentials by stable alias
    list      List aliases and metadata (never returns secrets)
    set       Create or update an alias (secret via stdin/prompt/env)

GLOBAL OPTIONS
  --json            Machine-readable output on stdout
  --reveal          Show secret values (passwords/TOTP/keys). Use deliberately.
  --server <url>    Server: us | eu | https://your.host  (default: us)
  -h, --help        Show help
  -v, --version     Show version
```

**凭证别名（credential）示例**

```bash
# 仅预览，不读取或保存密码
node bin/bwvault.js credential set --alias nas.ssh --username tycon --url ssh://nas

# 保存或更新——密码只来自 stdin / 隐藏 prompt / BWVAULT_SECRET
printf '%s' "$SECRET" | node bin/bwvault.js credential set \
  --alias nas.ssh --username tycon --url ssh://nas --apply

# 查看已保存别名（不返回密码）
node bin/bwvault.js credential list --json
```

**Agent 自动化示例**

```bash
node bin/bwvault.js analyze health --json   | jq '.score'
node bin/bwvault.js vault list --json        | jq '.items[].name'
node bin/bwvault.js manage dedup --json      | jq '.summary'
```

</details>

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

<a id="agent-接入"></a>

## Agent 接入

`bwvault` 是给 AI Agent 设计的：四条护栏保证 Agent 在无人监督下批量操作也不会泄漏明文或造成不可逆破坏。

| 护栏 | 机制 | 效果 |
|------|------|------|
| 密码不进 argv | 只从 stdin / 隐藏 prompt / `BWVAULT_*` 环境变量读取 | 命令历史、进程列表里看不到密钥 |
| 输出默认脱敏 | 密码 / TOTP / 卡号 / 私钥显示 `••••••••` | Agent 把输出贴进日志也不泄密 |
| 写操作默认 dry-run | 必须显式 `--apply` 才落库 | Agent 可以先演练再提交 |
| 删除一律软删除 | 回收站保留 ~30 天 | 误操作可回滚；仅 `purge --yes` 不可逆 |

**让 Agent 发现这个工具**：仓库自带 `agent-harness/skills/SKILL.md`（`name: bwvault-cli`），记录了全局 CLI 入口、凭据安全规则和 NAS 持久会话机制。项目仓库维护源文件；全局分发只由 SkillDo 管理一份中央副本，其他 Agent 工具目录使用软链。

Docker/NAS、CLI/SkillDo 和可选 macOS App 的交付边界见 [统一交付流程](docs/distribution-workflow.md)。

**典型 Agent 工作流**

```bash
# 1) 体检——只读，永远安全
bwvault analyze health --json | jq '{score, issues: .issues[].category}'

# 2) 找出重复——仍为只读
bwvault analyze duplicates --json | jq '.clusters[] | {name, count}'

# 3) 演练合并——不带 --apply，只输出计划
bwvault manage dedup --json

# 4) 确认无误后才真正执行
bwvault manage dedup --json --apply
```

**Agent 常用环境变量**

| 变量 | 用途 |
|------|------|
| `BWVAULT_CLIENT_ID` / `BWVAULT_CLIENT_SECRET` | API Key 登录凭据 |
| `BWVAULT_PIN` | Web 人工解锁 PIN；旧版 API Key 文件首次迁移时也会使用 |
| `BWVAULT_PASSWORD` | 主密码（也可走 stdin） |
| `BWVAULT_SECRET` | `credential set` 写入的服务凭据 |

> [!IMPORTANT]
> 任何需要明文的操作都要求显式 `--reveal`。Agent 侧请在系统提示里禁止自动追加该 flag——脱敏输出已经足够做去重与健康判断。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

<a id="安全审核与运行边界"></a>

## 安全审核与运行边界

项目已按 OWASP WSTG/ASVS、CIS Docker Benchmark 做过源码、容器和 NAS 线上只读审核，完整记录见 [安全审核报告](docs/security-report.md)。本轮已修复并复测：

- `/api/session` 写入要求同源请求，跨源或无 `Origin` 请求会被拒绝。
- PIN 解锁状态改为客户端绑定的短期 `HttpOnly`、`Secure`、`SameSite=Strict` cookie。
- session 删除要求同源且已认证。

生产上线验证已完成，后续维护建议：

- 不向不可信网络暴露 HTTP 3000；
- 定期验证 PIN 的 scrypt、失败退避和锁定在真实 HTTPS 入口生效；
- 定期验证静态文件目录边界和异常 URL 行为；
- 持续进行镜像漏洞扫描与实际容器 capability 检查。

### 后续 Agent 必须遵守

- 线上检查默认只读；不得执行 `--apply`、删除、purge、解锁或压力测试，除非用户明确授权。
- 不使用 `--reveal`，除非用户明确指定具体操作和目标；输出中不得打印密码、API key、access token、PIN 或解密密钥。
- NAS 只能使用仓库根目录的 `./bitwardenagents` 代理，不能另起带独立 named volume 的 `docker run`。
- 修改会话、认证、Docker 或部署代码后，必须运行 `npm run build`、`node agent-harness/tests/run.js` 和 `git diff --check`，并更新安全报告。

<a id="部署选项"></a>

## 部署选项

| 方式 | 适用场景 | 说明 |
|------|----------|------|
| Cloudflare Pages | 公开演示 / 静态托管 | `wrangler.toml` 已配置；`functions/` 代理 API，CORS 一并解决 |
| Docker 自托管 | NAS / 内网 / 个人长期使用 | `Dockerfile` 多阶段构建；同一镜像可作为 Web 服务器或 CLI |
| `node server.js` | 开发 / 裸部署 | 端口 3000（HTTP）+ 3443（自签 HTTPS，启用 Web Crypto） |
| `agent-harness/` | Agent / CI | 直接 `node bin/bwvault.js`，不依赖 Web UI |

> [!TIP]
> **Web Crypto API 要求 HTTPS 或 localhost**。在线演示（Cloudflare Pages）天然 HTTPS；自托管推荐用 `https://<host>:3443` 访问（首次需信任自签证书）；纯 HTTP 端口 3000 仅适合 API 与 CLI。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

<a id="常见问题"></a>

## 常见问题

**Q：和官方 Bitwarden Web Vault 是什么关系？**
A：本项目是**独立客户端**，不修改官方服务端。解密后从你账户的 API 拉取数据，不存储也不上传任何密码库到第三方。

**Q：可以用主密码直接登录吗？**
A：可以，登录页选"密码登录"标签。它走 Bitwarden 官方登录流程（含新设备验证），仅 API Key 登录绕开 CAPTCHA。

**Q：通行密钥（Passkey）条目会被去重误删吗？**
A：不会。包含 `Fido2Credentials` 的条目走 Path B 的 per-cipher Key 保全路径——Bitwarden API 拒绝带通行密钥条目的 PUT 更新，所以这类条目只能 Create-Then-Delete，并在过程中保留原始加密密钥与通行密钥数据。

**Q：会话、PIN、设备 ID 都存哪？**
A：Docker 模式存卷 `/data/session`，本地模式存 `~/.bwvault/`；会话文件权限 `0600`；PIN 哈希与 API Key 加密凭据同目录。

**Q：能不能离线用？**
A：不能。解密在本地，但同步（`/sync`、登录、变更提交）必须访问 Bitwarden API（生产环境 `vault.bitwarden.com` / `vault.bitwarden.eu`，自托管可改 `--server`）。

**Q：和 Bitwarden CLI (`bw`) 有什么区别？**
A：`bw` 是官方通用 CLI；`bwvault` 专注**管理**任务——去重、健康、URL 失效、回收站、凭据别名——并复用同一份浏览器端加密代码，避免实现漂移。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

<a id="参与贡献"></a>

## 参与贡献

1. Fork 本仓库
2. 创建特性分支（`git checkout -b feature/AmazingFeature`）
3. 提交改动（`git commit -m 'feat: add something'`）
4. 推送分支（`git push origin feature/AmazingFeature`）
5. 提交 Pull Request

> [!IMPORTANT]
> 安全相关变更请**不要**走公开 PR；先开 issue 讨论。涉及加解密路径的改动必须有对应的 `agent-harness/tests/run.js` 单元测试覆盖。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

<a id="许可证"></a>

## 许可证

本项目基于 **MIT License** 发布——详见 [`LICENSE`](LICENSE) 文件。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

<!-- 链接变量 -->
[demo]: https://bitwardenagents.itycon.cn/
[demo-shield]: https://img.shields.io/badge/Live-Demo-brightgreen?style=flat-square
[bug]: https://github.com/yancongya/bitwardenagents/issues/new?labels=bug
[feat]: https://github.com/yancongya/bitwardenagents/issues/new?labels=enhancement
[llms]: https://github.com/yancongya/bitwardenagents/blob/main/public/llms.txt
[license-shield]: https://img.shields.io/github/license/yancongya/bitwardenagents?style=flat-square
[license-url]: https://github.com/yancongya/bitwardenagents/blob/main/LICENSE
[platforms-shield]: https://img.shields.io/badge/Web%20%C2%B7%20Node%2020%2B%20%C2%B7%20Docker-blue?style=flat-square
[platforms-url]: https://github.com/yancongya/bitwardenagents
[node-shield]: https://img.shields.io/badge/Node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white
[node-url]: https://nodejs.org/
[docker-shield]: https://img.shields.io/badge/Docker-supported-2496ED?style=flat-square&logo=docker&logoColor=white
[docker-url]: https://hub.docker.com/
