# K8s OpenClaw Manager

一个用于管理多个 OpenClaw 实例 Kubernetes 部署配置的可视化管理工具，支持 YAML 编辑、表单配置、一键发布和内置终端。

## 功能特性

- **多实例管理** — 创建、查看、删除多个 OpenClaw 部署实例，每个实例独立一套 YAML 文件
- **可视化编辑** — Monaco Editor 提供 YAML 语法高亮编辑器，支持折叠、格式化
- **表单模式** — 针对 Deployment、PVC、Service、ConfigMap 提供结构化表单，无需手写 YAML
- **一键发布** — 调用 `kubectl apply -k` 部署，实时流式输出部署日志
- **内置终端** — 集成全功能 Linux 终端（xterm.js + PTY），可执行任意命令

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite + Tailwind CSS |
| 编辑器 | Monaco Editor (`@monaco-editor/react`) |
| 终端 | xterm.js + node-pty (PTY) + WebSocket |
| 后端 | Node.js + Express + TypeScript |
| YAML 解析 | js-yaml |

## 项目结构

```
k8s_openclaw/
├── templates/              # YAML 模板文件（创建实例时复制）
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── pvc.yaml
│   ├── configmap.yaml
│   └── kustomization.yaml
├── instances/              # 各实例的 YAML 目录（运行时生成）
│   └── <instance-name>/
│       ├── deployment.yaml
│       ├── service.yaml
│       ├── pvc.yaml
│       ├── configmap.yaml
│       └── kustomization.yaml
├── server/                 # Express 后端
│   └── src/index.ts
└── client/                 # React 前端
    └── src/
        ├── App.tsx
        └── components/
            ├── Sidebar.tsx
            ├── InstanceEditor.tsx
            ├── YamlFileEditor.tsx
            ├── DeploymentForm.tsx
            ├── PvcForm.tsx
            ├── ServiceForm.tsx
            ├── ConfigMapForm.tsx
            ├── TerminalPanel.tsx
            └── CreateInstanceModal.tsx
```

## 快速开始

### 环境要求

- Node.js >= 18
- kubectl（已配置好 kubeconfig）
- npm >= 9

### 安装依赖

```bash
npm install
```

### 启动开发服务

```bash
npm run dev
```

- 前端：http://localhost:5173
- 后端 API：http://localhost:3001

### 生产构建

```bash
npm run build
```

构建完成后，直接启动后端即可（后端会托管前端静态文件）：

```bash
node server/dist/index.js
```

访问 http://localhost:3001

## 使用说明

### 创建实例

1. 点击左侧栏 **New Instance** 按钮
2. 输入实例名称（仅支持小写字母、数字、短横线，如 `my-openclaw`）
3. 点击 **Create Instance**，系统自动从模板复制 YAML 并将所有 `openclaw` 引用替换为实例名

### 编辑配置

选中实例后，顶部 Tab 可切换编辑不同文件：

| Tab | 文件 | 支持表单 |
|-----|------|---------|
| Deployment | deployment.yaml | 名称、镜像、副本数、资源限制 |
| Service | service.yaml | 服务类型、端口 |
| PVC | pvc.yaml | 存储大小、访问模式 |
| ConfigMap | configmap.yaml | JSON 配置、AGENTS.md |
| Kustomization | kustomization.yaml | 仅 YAML 模式 |

每个 Tab 可在 **Form**（表单）和 **YAML**（原始编辑器）之间切换。修改后点击 **Save** 保存到磁盘。

### 部署

点击右上角 **Deploy** 按钮，执行 `kubectl apply -k <instance-dir>`，弹窗实时展示部署输出。

### 终端

页面底部内置完整终端，支持交互式命令（vim、kubectl、bash 脚本等）。启动目录为 `instances/`。点击顶部 **Hide/Show** 可折叠终端面板。

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/instances` | 获取所有实例列表 |
| POST | `/api/instances` | 创建新实例 |
| DELETE | `/api/instances/:name` | 删除实例 |
| GET | `/api/instances/:name/files/:filename` | 读取 YAML 文件内容 |
| PUT | `/api/instances/:name/files/:filename` | 保存 YAML 文件内容 |
| POST | `/api/instances/:name/deploy` | 执行部署（流式响应） |
| GET | `/api/instances/:name/status` | 查询 kubectl 状态 |
| WS | `/ws/terminal` | WebSocket 终端连接 |
