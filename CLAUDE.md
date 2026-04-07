# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start both client and server in dev mode
npm run dev

# Build everything
npm run build

# Server only
cd server && npm run dev       # dev (hot-reload via ts-node-dev)
cd server && npm run build     # compile TypeScript → dist/
cd server && npm start         # run compiled build

# Client only
cd client && npm run dev       # Vite dev server (port 5173)
cd client && npm run build     # tsc + vite build

# Type check without emitting
cd server && npx tsc --noEmit
cd client && npx tsc --noEmit
```

No test runner is configured.

## Architecture

Monorepo with two npm workspaces: `server/` (Express + Node) and `client/` (React + Vite). The client proxies `/api/*` and `/ws/*` to the server on port 3001.

### Server (`server/src/index.ts`)

Single-file Express server (~1,200 lines) that:
- Authenticates all `/api` routes via Bearer token (from `AUTH_TOKEN` env var or `config.json`)
- Manages **instances** as directories under `instances/<name>/` on the filesystem
- Copies Kubernetes YAML templates from `templates/` when creating a new Kubernetes instance
- Streams SSE for deploy logs (`kubectl apply -k`) and install output (`npm install -g openclaw` locally or via SSH)
- Serves a WebSocket PTY terminal at `/ws/terminal` using `node-pty`
- Delegates OpenClaw Gateway communication to `openclaw-client.ts`

### OpenClaw Client (`server/src/openclaw-client.ts`)

Manages persistent WebSocket connections to OpenClaw Gateway instances. Uses Ed25519 keypair challenge-response for device authentication. Keypair is generated once and stored in `instances/<name>/openclaw-connection.json`. RPC calls: `agents.list`, `channels.status`, `models.list`, `chat.send`, etc.

### Client (`client/src/`)

React 18 + Tailwind + Monaco Editor + xterm.js. The main layout in `App.tsx` is a resizable sidebar + editor panel. `InstanceEditor.tsx` is the top-level tab container (Info / Connect / Config / Deploy). Config editing lives in `OcFileConfigPanel.tsx`; gateway connection in `OpenClawPanel.tsx`.

## Instance Data Model

Each instance is a directory `instances/<name>/` containing:

| File | Purpose |
|---|---|
| `instance.json` | `{ name, deployType, createdAt, gatewayToken? }` |
| `openclaw-connection.json` | Gateway URL, token, Ed25519 device keypair |
| `openclaw-file-source.json` | Where openclaw.json lives: `{ type: 'local'\|'kubernetes'\|'ssh', localPath?, namespace?, pod?, container?, filePath? }` |
| `ssh-credentials.json` | `{ host, port, username, password }` — only for `ssh` deployType |
| `deployment.yaml` etc. | Kubernetes manifests — only for `kubernetes` deployType |

## Deploy Types

`DeployType = 'kubernetes' | 'local' | 'ssh' | 'docker'`

- **kubernetes**: Creates YAML files from `templates/`, deploys with `kubectl apply -k <instanceDir>`
- **local**: Installs openclaw via `npm install -g openclaw@latest` on this machine (SSE-streamed)
- **ssh**: Saves `ssh-credentials.json`, installs openclaw on the remote host via SSH using `ssh2`
- **docker**: Disabled/not implemented

For `local` and `ssh` instances, `isLocal = true` in `InstanceEditor.tsx`, which hides the YAML file editor and Deploy tab.

## Key Routes

| Method + Path | Purpose |
|---|---|
| `POST /api/instances` | Create instance; copies YAML templates for kubernetes, saves SSH creds for ssh |
| `POST /api/instances/:name/local-install` | SSE: `npm install -g openclaw@latest` locally |
| `POST /api/instances/:name/ssh-install` | SSE: same but over SSH using `ssh-credentials.json` |
| `POST /api/instances/:name/deploy` | SSE: `kubectl apply -k` + pod status polling |
| `GET/PUT /api/instances/:name/oc-config/file` | Read/write `openclaw.json` from local path or kubectl exec |
| `PUT /api/instances/:name/oc-config/source` | Update `openclaw-file-source.json` |
| `POST /api/instances/:name/openclaw/connect` | Connect to OpenClaw Gateway (WebSocket + Ed25519 auth) |
| `GET /api/instances/:name/openclaw/status` | Gateway connection status |
| `WS /ws/terminal` | PTY terminal shell (token in query string) |

## Authentication

Single shared token. Stored in `config.json` at project root if not set via `AUTH_TOKEN` env var; auto-generated as UUID on first run. The `/api/auth/verify` endpoint is public (used by the login page).
