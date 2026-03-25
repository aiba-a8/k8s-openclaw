# OpenClaw Manager

一个用于管理多个 OpenClaw 实例的可视化 Web 管理平台，支持 Kubernetes 部署、本地安装和实例注册，提供配置编辑、实时部署监控、终端等功能。

---

## 功能概览

### 实例管理
- **创建实例（Deploy New）**：填写名称、选择部署方式，自动初始化目录和配置文件
  - **Local**：自动执行 `npm install -g openclaw@latest`，实时流式展示安装日志
  - **Kubernetes**：自动生成 YAML 模板（Deployment、Service、PVC、ConfigMap、Secret、Kustomization），支持自定义或自动生成 Gateway Token
- **注册实例（Register Only）**：只创建实例目录和元数据，不做任何安装或部署，用于接入已有 OpenClaw 实例
- **删除实例**：二次确认防误操作

### 实例详情（四个 Tab）

| Tab | 说明 |
|-----|------|
| **Info** | 显示实例名称、部署类型、创建时间、Gateway Token（默认加密，点击眼睛图标显示） |
| **Connect** | 配置 WebSocket 地址和 Token 并连接 Gateway；连接后可查看 Agents、Channels、Models |
| **Config** | 可视化编辑 openclaw.json（Agents、Bindings、Providers、Channels），支持 Raw JSON 模式；Local 实例自动加载 `~/.openclaw/openclaw.json`，Kubernetes 实例通过 Pod 选择器读取 |
| **Deploy** | Kubernetes：编辑 YAML 文件（Form/YAML 双模式）并一键部署；Local：显示本地部署说明 |

### 部署流程（Kubernetes）
1. 在 **Deploy** tab 编辑配置文件，点击右上角 **Deploy** 按钮
2. 弹出进度窗口，实时显示两个阶段：
   - ✓ Apply Kubernetes manifests（`kubectl apply -k`）
   - ✓ Wait for pod to be ready（轮询 Pod 状态，最长等待 2 分钟）
3. 完整日志同步显示在底部 **Logs** 面板（自动切换）
4. 部署成功后点击 **Go to Connect**，自动跳转 Connect tab 并预填 Gateway Token

### Config 编辑器
根据 `deployType` 自动确定数据来源，无需手动切换：

| 部署类型 | Config 来源 |
|----------|-------------|
| `local` | 自动读取 `~/.openclaw/openclaw.json` |
| `kubernetes` | Kubernetes Pod 选择器（Namespace → Pod → Container → 文件路径） |
| `docker` | 本地文件路径 |

Form 模式支持：
- **Agents**：ID、名称、工作区、模型配置
- **Bindings**：Agent ↔ Channel 绑定关系
- **Providers**：API 提供商及模型列表
- **Channels**：21 种 Channel 类型，字段根据类型智能渲染（boolean/select/password/array）

所有删除操作均有二次确认（点击垃圾桶 → 确认 ✓ / 取消 ✗，3 秒后自动取消）。

### 其他
- **终端**：底部集成 xterm.js 终端，支持拖拽调整高度
- **Logs 面板**：平时显示 OpenClaw Gateway 实时日志；部署期间自动切换为部署输出
- **登录鉴权**：JWT Token 保护所有 API 接口

---

## 技术栈

**前端**
- React 18 + TypeScript
- Vite + Tailwind CSS
- Monaco Editor（YAML / JSON 编辑器）
- xterm.js（终端）
- lucide-react（图标）

**后端**
- Node.js + Express + TypeScript
- WebSocket（ws）
- node-pty（终端 PTY）
- SSE（Server-Sent Events，部署日志流、安装日志流）

---

## 目录结构

```
k8s_openclaw/
├── client/                  # React 前端（Vite）
│   └── src/
│       ├── components/
│       │   ├── CreateInstanceModal.tsx   # 新建/注册实例弹窗（Deploy New / Register Only）
│       │   ├── InstanceEditor.tsx        # 实例详情（Info / Connect / Config / Deploy）
│       │   ├── OpenClawPanel.tsx         # Connect 面板（连接管理 + Agents/Channels/Models）
│       │   ├── OcFileConfigPanel.tsx     # Config 编辑器（Form + Raw JSON）
│       │   ├── Sidebar.tsx               # 实例列表侧边栏
│       │   ├── TerminalPanel.tsx         # 底部终端
│       │   ├── LogsPanel.tsx             # 底部日志面板（Gateway 日志 / 部署日志）
│       │   ├── LoginPage.tsx             # 登录页
│       │   └── ...                       # DeploymentForm / ServiceForm / PvcForm 等子组件
│       ├── types.ts
│       └── utils/auth.ts
├── server/                  # Express 后端
│   └── src/
│       ├── index.ts                      # 所有 API 路由
│       └── openclaw-client.ts            # OpenClaw WebSocket 客户端
├── templates/               # Kubernetes YAML 模板（新建 k8s 实例时复制并替换变量）
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── pvc.yaml
│   ├── configmap.yaml
│   ├── secret.yaml          # 含 OPENCLAW_GATEWAY_TOKEN 占位符
│   └── kustomization.yaml
├── instances/               # 运行时目录：每个实例一个子目录
│   └── <instance-name>/
│       ├── instance.json    # 元数据（name, deployType, gatewayToken, createdAt）
│       ├── deployment.yaml
│       └── ...
└── package.json             # monorepo 根配置
```

---

## 快速开始

### 前置依赖

- Node.js >= 18
- npm >= 9
- kubectl（Kubernetes 部署功能需要）

### 安装

```bash
git clone <repo-url>
cd k8s_openclaw
npm install
```

### 开发模式

```bash
npm run dev
```

- 前端：http://localhost:5173
- 后端：http://localhost:3001

### 生产构建

```bash
npm run build
cd server && npm start
```

---

## 配置说明

### instance.json

每个实例目录下自动生成，记录实例元数据：

```json
{
  "name": "my-instance",
  "deployType": "kubernetes",
  "createdAt": "2025-01-01T00:00:00.000Z",
  "gatewayToken": "64位十六进制字符串"
}
```

### Gateway Token（Kubernetes）

- 创建实例时可手动填写或点击刷新自动生成（`crypto.getRandomValues` 生成 64 位 hex）
- 注入到 `secret.yaml` 的 `OPENCLAW_GATEWAY_TOKEN` 字段
- Kubernetes 中以 `secretKeyRef` 方式挂载为 Pod 环境变量
- **注意**：`secret.yaml` 包含明文 Token，请勿提交到版本控制

---

## API 参考

### 实例

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/instances` | 获取所有实例列表（含 deployType、gatewayToken、createdAt） |
| `POST` | `/api/instances` | 创建实例；传 `registerOnly: true` 仅创建目录不生成 YAML |
| `DELETE` | `/api/instances/:name` | 删除实例目录 |

### YAML 文件

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/instances/:name/files/:filename` | 读取 YAML 文件内容 |
| `PUT` | `/api/instances/:name/files/:filename` | 保存 YAML 文件内容 |

### 部署

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/instances/:name/deploy` | 执行部署（SSE：`log` / `pod_status` / `done`） |
| `GET` | `/api/instances/:name/deploy-logs` | 获取最近一次部署的完整日志行 |
| `POST` | `/api/instances/:name/local-install` | 本地安装 openclaw（SSE：`log` / `done`） |

### Config 文件

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/instances/:name/oc-config/source` | 读取当前 Config 来源配置 |
| `PUT` | `/api/instances/:name/oc-config/source` | 更新 Config 来源配置 |
| `GET` | `/api/instances/:name/oc-config/pods` | 获取 Kubernetes Pod 列表 |
| `GET` | `/api/instances/:name/oc-config/file` | 读取 openclaw.json 内容 |
| `PUT` | `/api/instances/:name/oc-config/file` | 保存 openclaw.json 内容 |

### OpenClaw 连接

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/instances/:name/openclaw/settings` | 读取 Gateway URL 和 Token |
| `PUT` | `/api/instances/:name/openclaw/settings` | 保存 Gateway URL 和 Token |
| `POST` | `/api/instances/:name/openclaw/connect` | 连接 Gateway（返回 pairingRequired 时需设备配对） |
| `POST` | `/api/instances/:name/openclaw/disconnect` | 断开连接 |
| `GET` | `/api/instances/:name/openclaw/status` | 获取连接状态（disconnected / connecting / connected / error） |
| `GET` | `/api/instances/:name/openclaw/logs` | 获取 Gateway 日志（最近 300 条） |
| `GET` | `/api/instances/:name/openclaw/agents` | 获取 Agent 列表 |
| `GET` | `/api/instances/:name/openclaw/channels` | 获取 Channel 及账号状态 |
| `GET` | `/api/instances/:name/openclaw/models` | 获取 Model 列表 |

### 终端

| 协议 | 路径 | 说明 |
|------|------|------|
| WebSocket | `/terminal` | PTY 终端连接（xterm.js） |

---

## 支持的 Channel 类型（21 种）

`discord` · `slack` · `telegram` · `whatsapp` · `signal` · `imessage` · `msteams` · `googlechat` · `irc` · `matrix` · `mattermost` · `line` · `feishu` · `bluebubbles` · `synology-chat` · `nextcloud-talk` · `twitch` · `tlon` · `nostr` · `zalo` · `zalouser`
