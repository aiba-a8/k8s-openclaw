import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as url from 'url';
import { Client as SshClient } from 'ssh2';
import {
  OpenClawConnectionConfig,
  getOrCreateClient,
  getClient,
  removeClient,
} from './openclaw-client';

const app = express();
const PORT = 3001;

// ── Per-instance deploy log buffer ───────────────────────────────────────────
const deployLogs = new Map<string, string[]>();
const MAX_DEPLOY_LOGS = 500;

function pushDeployLog(name: string, text: string) {
  let lines = deployLogs.get(name);
  if (!lines) { lines = []; deployLogs.set(name, lines); }
  lines.push(...text.split('\n'));
  if (lines.length > MAX_DEPLOY_LOGS) lines.splice(0, lines.length - MAX_DEPLOY_LOGS);
}

// ── Per-instance log buffer ───────────────────────────────────────────────────

interface LogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error';
  tag: string;
  message: string;
  data?: unknown;
}

const instanceLogs = new Map<string, LogEntry[]>();
const MAX_LOGS = 300;

function ocLog(instanceName: string, level: LogEntry['level'], tag: string, message: string, data?: unknown) {
  let logs = instanceLogs.get(instanceName);
  if (!logs) { logs = []; instanceLogs.set(instanceName, logs); }
  logs.push({ ts: Date.now(), level, tag, message, data });
  if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
  const prefix = `[${instanceName}][${tag}]`;
  if (level === 'error') console.error(prefix, message, data ?? '');
  else console.log(prefix, message, data === undefined ? '' : JSON.stringify(data, null, 2));
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const INSTANCES_DIR = path.join(__dirname, '../../instances');
const TEMPLATES_DIR = path.join(__dirname, '../../templates');
const CONFIG_FILE = path.join(__dirname, '../../config.json');

// ── Token configuration ──────────────────────────────────────────────────────

interface AppConfig {
  authToken: string;
}

function loadOrCreateConfig(): AppConfig {
  // Env var takes priority
  if (process.env.AUTH_TOKEN) {
    return { authToken: process.env.AUTH_TOKEN };
  }
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const cfg = JSON.parse(raw) as AppConfig;
      if (cfg.authToken) return cfg;
    } catch {
      // fall through to generate
    }
  }
  // First run: generate a random token and persist it
  const cfg: AppConfig = { authToken: randomUUID() };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  return cfg;
}

const config = loadOrCreateConfig();
const AUTH_TOKEN = config.authToken;

console.log(`\n🔑 Auth token: ${AUTH_TOKEN}\n   (set AUTH_TOKEN env var or edit config.json to change)\n`);

// ── Auth middleware ───────────────────────────────────────────────────────────

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['authorization'] ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (token === AUTH_TOKEN) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized' });
}

// Public: verify endpoint (client uses this to test a token before storing)
app.post('/api/auth/verify', (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  if (token === AUTH_TOKEN) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false, error: 'Invalid token' });
  }
});

// All other /api routes require auth
app.use('/api', authMiddleware);

// Ensure directories exist
[INSTANCES_DIR, TEMPLATES_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

const YAML_FILES = ['secret.yaml', 'deployment.yaml', 'service.yaml', 'pvc.yaml', 'configmap.yaml', 'kustomization.yaml'];

function replaceOpenclaw(content: string, instanceName: string): string {
  // Replace all occurrences of "openclaw" with the instance name
  // but be careful to preserve partial matches like "openclawpro" image names
  // We do a targeted replacement for metadata names, labels, selectors, claimNames, configMap names
  return content
    .replace(/name: openclaw-home-pvc/g, `name: ${instanceName}-home-pvc`)
    .replace(/name: openclaw-config/g, `name: ${instanceName}-config`)
    .replace(/name: openclaw-secrets/g, `name: ${instanceName}-secrets`)
    .replace(/claimName: openclaw-home-pvc/g, `claimName: ${instanceName}-home-pvc`)
    .replace(/configMap:\n(\s+)name: openclaw-config/g, `configMap:\n$1name: ${instanceName}-config`)
    .replace(/name: openclaw\n/g, `name: ${instanceName}\n`)
    .replace(/app: openclaw\n/g, `app: ${instanceName}\n`)
    .replace(/app: openclaw$/gm, `app: ${instanceName}`)
    .replace(/name: openclaw$/gm, `name: ${instanceName}`);
}

// GET /api/instances
app.get('/api/instances', (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(INSTANCES_DIR)) {
      return res.json([]);
    }
    const entries = fs.readdirSync(INSTANCES_DIR, { withFileTypes: true });
    const instances = entries
      .filter(e => e.isDirectory())
      .map(e => {
        const metaPath = path.join(INSTANCES_DIR, e.name, 'instance.json');
        let deployType: string | undefined;
        let gatewayToken: string | undefined;
        let createdAt: string | undefined;
        let description: string | undefined;
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { deployType?: string; gatewayToken?: string; createdAt?: string; description?: string };
            deployType = meta.deployType;
            gatewayToken = meta.gatewayToken;
            createdAt = meta.createdAt;
            description = meta.description;
          } catch { /* ignore */ }
        }
        return {
          name: e.name,
          deployType: deployType ?? 'kubernetes',
          ...(gatewayToken ? { gatewayToken } : {}),
          ...(createdAt ? { createdAt } : {}),
          ...(description ? { description } : {}),
          files: YAML_FILES.filter(f => fs.existsSync(path.join(INSTANCES_DIR, e.name, f))),
        };
      });
    return res.json(instances);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// POST /api/instances
app.post('/api/instances', (req: Request, res: Response) => {
  const { name, deployType = 'kubernetes', gatewayToken, registerOnly, sshCredentials, gatewayUrl } = req.body as { name: string; deployType?: string; gatewayToken?: string; registerOnly?: boolean; sshCredentials?: { host: string; port: number; username: string; password: string }; gatewayUrl?: string };
  if (!name || !/^[a-z0-9-]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid instance name. Use lowercase letters, numbers, and dashes only.' });
  }

  const instanceDir = path.join(INSTANCES_DIR, name);
  if (fs.existsSync(instanceDir)) {
    return res.status(409).json({ error: `Instance "${name}" already exists.` });
  }

  try {
    fs.mkdirSync(instanceDir, { recursive: true });

    // For kubernetes full deploy: auto-generate token if not provided
    // For register-only: use the token as-is (user provided)
    const resolvedToken = registerOnly
      ? (gatewayToken?.trim() || undefined)
      : deployType === 'kubernetes'
        ? (gatewayToken?.trim() || require('crypto').randomBytes(32).toString('hex') as string)
        : undefined;

    // Save metadata
    const createdAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(instanceDir, 'instance.json'),
      JSON.stringify({ name, deployType, createdAt, ...(resolvedToken ? { gatewayToken: resolvedToken } : {}) }, null, 2),
      'utf-8',
    );

    // Save SSH credentials separately
    if (deployType === 'ssh' && sshCredentials) {
      fs.writeFileSync(
        path.join(instanceDir, 'ssh-credentials.json'),
        JSON.stringify(sshCredentials, null, 2),
        'utf-8',
      );
    }

    // Save gateway URL to connection config if provided
    if (gatewayUrl?.trim()) {
      let ocUrl = gatewayUrl.trim();
      if (ocUrl.startsWith('http://')) ocUrl = 'ws://' + ocUrl.slice(7);
      else if (ocUrl.startsWith('https://')) ocUrl = 'wss://' + ocUrl.slice(8);
      else if (!ocUrl.startsWith('ws://') && !ocUrl.startsWith('wss://')) ocUrl = 'ws://' + ocUrl.replace(/^\/\//, '');
      writeOcConfig(name, { url: ocUrl });
    }

    // For register-only: skip YAML template creation
    const files: string[] = [];
    if (!registerOnly && deployType === 'kubernetes') {
      for (const file of YAML_FILES) {
        const templatePath = path.join(TEMPLATES_DIR, file);
        if (fs.existsSync(templatePath)) {
          let content = fs.readFileSync(templatePath, 'utf-8');
          content = replaceOpenclaw(content, name);
          if (file === 'secret.yaml' && resolvedToken) {
            content = content.replace('OPENCLAW_GATEWAY_TOKEN_VALUE', resolvedToken);
          }
          fs.writeFileSync(path.join(instanceDir, file), content, 'utf-8');
          files.push(file);
        }
      }
    }

    return res.status(201).json({ name, deployType, gatewayToken: resolvedToken, files });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// DELETE /api/instances/:name
app.delete('/api/instances/:name', (req: Request, res: Response) => {
  const { name } = req.params;
  const instanceDir = path.join(INSTANCES_DIR, name);

  if (!fs.existsSync(instanceDir)) {
    return res.status(404).json({ error: `Instance "${name}" not found.` });
  }

  try {
    fs.rmSync(instanceDir, { recursive: true, force: true });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// PATCH /api/instances/:name  – update name and/or description
app.patch('/api/instances/:name', (req: Request, res: Response) => {
  const { name } = req.params;
  const { newName, description } = req.body as { newName?: string; description?: string };

  const instanceDir = path.join(INSTANCES_DIR, name);
  if (!fs.existsSync(instanceDir)) {
    return res.status(404).json({ error: `Instance "${name}" not found.` });
  }

  try {
    let targetDir = instanceDir;
    let finalName = name;

    if (newName && newName !== name) {
      if (!/^[a-z0-9-]+$/.test(newName)) {
        return res.status(400).json({ error: 'Invalid name. Use lowercase letters, numbers, and dashes only.' });
      }
      const newDir = path.join(INSTANCES_DIR, newName);
      if (fs.existsSync(newDir)) {
        return res.status(409).json({ error: `Instance "${newName}" already exists.` });
      }
      fs.renameSync(instanceDir, newDir);
      targetDir = newDir;
      finalName = newName;
      removeClient(name);
    }

    const metaPath = path.join(targetDir, 'instance.json');
    const meta = fs.existsSync(metaPath)
      ? (JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Record<string, unknown>)
      : {};
    meta.name = finalName;
    if (description !== undefined) meta.description = description;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

    return res.json({ ok: true, name: finalName });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// GET /api/instances/:name/files/:filename
app.get('/api/instances/:name/files/:filename', (req: Request, res: Response) => {
  const { name, filename } = req.params;

  if (!YAML_FILES.includes(filename)) {
    return res.status(400).json({ error: 'Invalid filename.' });
  }

  const filePath = path.join(INSTANCES_DIR, name, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found.' });
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return res.json({ content });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// PUT /api/instances/:name/files/:filename
app.put('/api/instances/:name/files/:filename', (req: Request, res: Response) => {
  const { name, filename } = req.params;
  const { content } = req.body as { content: string };

  if (!YAML_FILES.includes(filename)) {
    return res.status(400).json({ error: 'Invalid filename.' });
  }

  const instanceDir = path.join(INSTANCES_DIR, name);
  if (!fs.existsSync(instanceDir)) {
    return res.status(404).json({ error: `Instance "${name}" not found.` });
  }

  try {
    fs.writeFileSync(path.join(instanceDir, filename), content, 'utf-8');
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// POST /api/instances/:name/deploy
app.post('/api/instances/:name/deploy', (req: Request, res: Response) => {
  const { name } = req.params;
  const instanceDir = path.join(INSTANCES_DIR, name);

  if (!fs.existsSync(instanceDir)) {
    return res.status(404).json({ error: `Instance "${name}" not found.` });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Clear previous deploy logs
  deployLogs.set(name, []);

  const send = (type: string, data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    if (type === 'log' && typeof data.text === 'string') {
      pushDeployLog(name, data.text);
    }
  };

  let pollTimer: NodeJS.Timeout | null = null;
  const cleanup = () => { if (pollTimer) clearInterval(pollTimer); };
  req.on('close', cleanup);

  // Step 1: kubectl apply -k
  const apply = spawn('kubectl', ['apply', '-k', instanceDir], { cwd: instanceDir, env: process.env });

  apply.stdout.on('data', (d: Buffer) => send('log', { text: d.toString() }));
  apply.stderr.on('data', (d: Buffer) => send('log', { text: d.toString() }));

  apply.on('error', (err: Error) => {
    send('log', { text: `\nError: ${err.message}\n` });
    send('done', { success: false });
    res.end();
  });

  apply.on('close', (code: number | null) => {
    if (code !== 0) {
      send('log', { text: `\n✗ kubectl apply failed (exit code ${code}).\n` });
      send('done', { success: false });
      res.end();
      return;
    }

    send('log', { text: '\n✓ kubectl apply completed. Watching pod status...\n' });

    // Step 2: poll pod status every 3s, up to 2 min
    let attempts = 0;
    const maxAttempts = 40;

    pollTimer = setInterval(() => {
      attempts++;
      const check = spawn('kubectl', ['get', 'pods', '-l', `app=${name}`, '-o', 'json'], { env: process.env });
      let out = '';
      check.stdout.on('data', (d: Buffer) => { out += d.toString(); });
      check.on('close', () => {
        try {
          const result = JSON.parse(out) as { items: Array<{ metadata: { name: string }; status: { phase: string; conditions?: Array<{ type: string; status: string }> } }> };
          const pod = result.items?.[0];
          if (!pod) {
            send('pod_status', { phase: 'Pending', ready: false, message: 'Waiting for pod to be created...' });
            return;
          }
          const phase = pod.status?.phase ?? 'Unknown';
          const ready = pod.status?.conditions?.some(c => c.type === 'Ready' && c.status === 'True') ?? false;
          const podName = pod.metadata?.name ?? '';
          send('pod_status', { phase, ready, podName });

          if (ready || attempts >= maxAttempts) {
            cleanup();
            if (ready) {
              send('log', { text: `\n✓ Pod ${podName} is Running and Ready.\n` });
              send('done', { success: true });
            } else {
              send('log', { text: '\n✗ Timed out waiting for pod to become ready.\n' });
              send('done', { success: false });
            }
            res.end();
          }
        } catch {
          // kubectl output not ready yet, ignore
        }
      });
    }, 3000);
  });
});

// GET /api/instances/:name/deploy-logs
app.get('/api/instances/:name/deploy-logs', (req: Request, res: Response) => {
  const { name } = req.params;
  return res.json({ lines: deployLogs.get(name) ?? [] });
});

// POST /api/instances/:name/local-install  – stream installation output
app.post('/api/instances/:name/local-install', (req: Request, res: Response) => {
  const { name } = req.params;
  const instanceDir = path.join(INSTANCES_DIR, name);
  if (!fs.existsSync(instanceDir)) {
    return res.status(404).json({ error: `Instance "${name}" not found.` });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (type: 'log' | 'done' | 'error', text: string) => {
    res.write(`data: ${JSON.stringify({ type, text })}\n\n`);
  };

  // Chain of commands to run sequentially
  const STEPS: Array<{ label: string; cmd: string; args: string[] }> = [
    { label: 'npm install -g openclaw@latest', cmd: 'npm', args: ['install', '-g', 'openclaw@latest'] },
  ];

  let stepIdx = 0;

  const runNext = () => {
    if (stepIdx >= STEPS.length) {
      send('log', '\n✓ Installation completed.\n');
      send('done', 'success');
      res.end();
      return;
    }
    const step = STEPS[stepIdx++];
    send('log', `\n▶ ${step.label}\n`);

    const child = spawn(step.cmd, step.args, {
      env: process.env,
      shell: process.platform === 'win32',
    });

    child.stdout.on('data', (d: Buffer) => send('log', d.toString()));
    child.stderr.on('data', (d: Buffer) => send('log', d.toString()));

    child.on('close', (code: number | null) => {
      if (code !== 0) {
        send('log', `\n✗ Step failed with exit code ${code}.\n`);
        send('done', 'error');
        res.end();
      } else {
        runNext();
      }
    });

    child.on('error', (err: Error) => {
      send('log', `\nError: ${err.message}\n`);
      send('done', 'error');
      res.end();
    });
  };

  runNext();
});

// POST /api/instances/:name/ssh-install  – install openclaw on remote server via SSH
app.post('/api/instances/:name/ssh-install', (req: Request, res: Response) => {
  const { name } = req.params;
  const instanceDir = path.join(INSTANCES_DIR, name);
  if (!fs.existsSync(instanceDir)) {
    return res.status(404).json({ error: `Instance "${name}" not found.` });
  }

  const credsPath = path.join(instanceDir, 'ssh-credentials.json');
  if (!fs.existsSync(credsPath)) {
    return res.status(400).json({ error: 'SSH credentials not found for this instance.' });
  }

  let creds: { host: string; port: number; username: string; password: string };
  try {
    creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8')) as { host: string; port: number; username: string; password: string };
  } catch {
    return res.status(500).json({ error: 'Failed to read SSH credentials.' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (type: 'log' | 'done', text: string) => {
    res.write(`data: ${JSON.stringify({ type, text })}\n\n`);
  };

  const conn = new SshClient();

  req.on('close', () => { try { conn.end(); } catch { /* ignore */ } });

  conn.on('ready', () => {
    send('log', `✓ Connected to ${creds.host}:${creds.port} as ${creds.username}\n`);
    send('log', '\n▶ npm install -g openclaw@latest\n');

    conn.exec('npm install -g openclaw@latest', (err, stream) => {
      if (err) {
        send('log', `\n✗ Error: ${err.message}\n`);
        send('done', 'error');
        conn.end();
        res.end();
        return;
      }

      stream.on('data', (data: Buffer) => { send('log', data.toString()); });
      stream.stderr.on('data', (data: Buffer) => { send('log', data.toString()); });

      stream.on('close', (code: number) => {
        conn.end();
        if (code === 0) {
          send('log', '\n✓ Installation completed.\n');
          send('done', 'success');
        } else {
          send('log', `\n✗ Installation failed (exit code ${code}).\n`);
          send('done', 'error');
        }
        res.end();
      });
    });
  });

  conn.on('error', (err: Error) => {
    send('log', `\n✗ SSH connection error: ${err.message}\n`);
    send('done', 'error');
    res.end();
  });

  conn.connect({
    host: creds.host,
    port: creds.port,
    username: creds.username,
    password: creds.password,
    readyTimeout: 20000,
  });
});

// GET /api/instances/:name/status
app.get('/api/instances/:name/status', (req: Request, res: Response) => {
  const { name } = req.params;

  const child = spawn('kubectl', ['get', 'all', '-l', `app=${name}`], {
    env: process.env,
  });

  let output = '';
  let errorOutput = '';

  child.stdout.on('data', (data: Buffer) => { output += data.toString(); });
  child.stderr.on('data', (data: Buffer) => { errorOutput += data.toString(); });

  child.on('close', (code: number | null) => {
    if (code === 0) {
      return res.json({ output, error: null });
    } else {
      return res.json({ output: output || errorOutput, error: errorOutput });
    }
  });

  child.on('error', (err: Error) => {
    return res.status(500).json({ error: err.message });
  });
});

// ── OpenClaw connection routes ────────────────────────────────────────────────

const OC_CONFIG_FILE = 'openclaw-connection.json';

function readOcConfig(instanceName: string): (OpenClawConnectionConfig & { deviceId?: string; privateKeyPem?: string; publicKeyBase64?: string }) | null {
  const filePath = path.join(INSTANCES_DIR, instanceName, OC_CONFIG_FILE);
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function writeOcConfig(instanceName: string, cfg: object): void {
  const filePath = path.join(INSTANCES_DIR, instanceName, OC_CONFIG_FILE);
  fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2), 'utf-8');
}

// GET /api/instances/:name/openclaw/settings
app.get('/api/instances/:name/openclaw/settings', (req: Request, res: Response) => {
  const cfg = readOcConfig(req.params.name);
  if (!cfg) return res.json({ url: '', token: '' });
  // Don't return private key
  return res.json({ url: cfg.url, token: cfg.token });
});

// PUT /api/instances/:name/openclaw/settings
app.put('/api/instances/:name/openclaw/settings', (req: Request, res: Response) => {
  const { name } = req.params;
  let { url: ocUrl, token } = req.body as { url: string; token: string };
  if (!ocUrl || !token) return res.status(400).json({ error: 'url and token required' });

  // Normalize URL: ensure ws:// or wss:// prefix
  ocUrl = ocUrl.trim();
  if (ocUrl.startsWith('http://')) ocUrl = 'ws://' + ocUrl.slice(7);
  else if (ocUrl.startsWith('https://')) ocUrl = 'wss://' + ocUrl.slice(8);
  else if (!ocUrl.startsWith('ws://') && !ocUrl.startsWith('wss://')) {
    ocUrl = 'ws://' + ocUrl.replace(/^\/\//, '');
  }

  // Preserve device keypair if exists
  const existing = readOcConfig(name) ?? {};
  writeOcConfig(name, { ...existing, url: ocUrl, token });
  // If client exists with different config, disconnect it
  removeClient(name);
  return res.json({ ok: true });
});

// POST /api/instances/:name/openclaw/connect
app.post('/api/instances/:name/openclaw/connect', async (req: Request, res: Response) => {
  const { name } = req.params;
  const cfg = readOcConfig(name);
  if (!cfg || !cfg.url || !cfg.token) {
    return res.status(400).json({ error: 'Connection not configured. Set url and token first.' });
  }

  removeClient(name);
  const client = getOrCreateClient(name, cfg);
  ocLog(name, 'info', 'connect', `Connecting to ${cfg.url}`);

  try {
    await client.connect();
    const kp = client.getDeviceKeypair();
    writeOcConfig(name, { ...cfg, ...kp });
    ocLog(name, 'info', 'connect', `Connected successfully, deviceId=${kp.deviceId}`);
    return res.json({ ok: true });
  } catch (err) {
    const kp = client.getDeviceKeypair();
    writeOcConfig(name, { ...cfg, ...kp });
    removeClient(name);

    const e = err as Error & { pairingRequired?: boolean; requestId?: string; deviceId?: string };
    if (e.pairingRequired) {
      ocLog(name, 'warn', 'connect', `Pairing required, deviceId=${e.deviceId}, requestId=${e.requestId}`);
      return res.status(403).json({
        error: e.message,
        pairingRequired: true,
        requestId: e.requestId,
        deviceId: e.deviceId,
      });
    }
    ocLog(name, 'error', 'connect', String(err));
    return res.status(502).json({ error: String(err) });
  }
});

// POST /api/instances/:name/openclaw/disconnect
app.post('/api/instances/:name/openclaw/disconnect', (req: Request, res: Response) => {
  ocLog(req.params.name, 'info', 'connect', 'Disconnected by user');
  removeClient(req.params.name);
  return res.json({ ok: true });
});

// GET /api/instances/:name/openclaw/status
app.get('/api/instances/:name/openclaw/status', (req: Request, res: Response) => {
  const client = getClient(req.params.name);
  if (!client) return res.json({ status: 'disconnected', error: null });
  return res.json({ status: client.getStatus(), error: client.getLastError() });
});

// GET /api/instances/:name/openclaw/agents
app.get('/api/instances/:name/openclaw/agents', async (req: Request, res: Response) => {
  const { name } = req.params;
  const client = getClient(name);
  if (!client || client.getStatus() !== 'connected') return res.status(503).json({ error: 'Not connected' });
  try {
    ocLog(name, 'info', 'rpc', 'agents.list →');
    const result = await client.rpc('agents.list');
    ocLog(name, 'info', 'rpc', 'agents.list ←', result);
    return res.json(result);
  } catch (err) {
    ocLog(name, 'error', 'rpc', `agents.list error: ${String(err)}`);
    return res.status(502).json({ error: String(err) });
  }
});

// GET /api/instances/:name/openclaw/channels
app.get('/api/instances/:name/openclaw/channels', async (req: Request, res: Response) => {
  const { name } = req.params;
  const client = getClient(name);
  if (!client || client.getStatus() !== 'connected') return res.status(503).json({ error: 'Not connected' });
  try {
    ocLog(name, 'info', 'rpc', 'channels.status →');
    const result = await client.rpc('channels.status', { probe: false, timeoutMs: 8000 });
    ocLog(name, 'info', 'rpc', 'channels.status ←', result);
    return res.json(result);
  } catch (err) {
    ocLog(name, 'error', 'rpc', `channels.status error: ${String(err)}`);
    return res.status(502).json({ error: String(err) });
  }
});

// GET /api/instances/:name/openclaw/models
app.get('/api/instances/:name/openclaw/models', async (req: Request, res: Response) => {
  const { name } = req.params;
  const client = getClient(name);
  if (!client || client.getStatus() !== 'connected') return res.status(503).json({ error: 'Not connected' });
  try {
    ocLog(name, 'info', 'rpc', 'models.list →');
    const result = await client.rpc('models.list');
    ocLog(name, 'info', 'rpc', 'models.list ←', result);
    return res.json(result);
  } catch (err) {
    ocLog(name, 'error', 'rpc', `models.list error: ${String(err)}`);
    return res.status(502).json({ error: String(err) });
  }
});

// GET /api/instances/:name/openclaw/logs
app.get('/api/instances/:name/openclaw/logs', (req: Request, res: Response) => {
  const logs = instanceLogs.get(req.params.name) ?? [];
  return res.json({ logs });
});

// GET /api/instances/:name/openclaw/sessions
app.get('/api/instances/:name/openclaw/sessions', async (req: Request, res: Response) => {
  const client = getClient(req.params.name);
  if (!client || client.getStatus() !== 'connected') return res.status(503).json({ error: 'Not connected' });
  try {
    const result = await client.rpc('sessions.list');
    return res.json(result);
  } catch (err) {
    return res.status(502).json({ error: String(err) });
  }
});

// GET /api/instances/:name/openclaw/gateway-config
app.get('/api/instances/:name/openclaw/gateway-config', async (req: Request, res: Response) => {
  const client = getClient(req.params.name);
  if (!client || client.getStatus() !== 'connected') return res.status(503).json({ error: 'Not connected' });
  try {
    const result = await client.rpc('config.get');
    return res.json(result);
  } catch (err) {
    return res.status(502).json({ error: String(err) });
  }
});

// PUT /api/instances/:name/openclaw/gateway-config
app.put('/api/instances/:name/openclaw/gateway-config', async (req: Request, res: Response) => {
  const client = getClient(req.params.name);
  if (!client || client.getStatus() !== 'connected') return res.status(503).json({ error: 'Not connected' });
  try {
    const result = await client.rpc('config.patch', { patch: req.body });
    return res.json(result);
  } catch (err) {
    return res.status(502).json({ error: String(err) });
  }
});

// POST /api/instances/:name/openclaw/chat  – SSE streaming
app.post('/api/instances/:name/openclaw/chat', async (req: Request, res: Response) => {
  const client = getClient(req.params.name);
  if (!client || client.getStatus() !== 'connected') {
    return res.status(503).json({ error: 'Not connected' });
  }

  const { message, sessionKey = 'agent:default:main' } = req.body as { message: string; sessionKey?: string };
  if (!message) return res.status(400).json({ error: 'message required' });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  const writeEvent = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const handler = (payload: unknown) => {
    const p = payload as { state?: string; message?: unknown; runId?: string; sessionKey?: string };
    if (p.sessionKey && p.sessionKey !== sessionKey) return;
    writeEvent(p);
    if (p.state === 'final' || p.state === 'aborted' || p.state === 'error') {
      client.off('event:chat', handler);
      res.end();
    }
  };

  client.on('event:chat', handler);

  req.on('close', () => {
    client.off('event:chat', handler);
  });

  try {
    await client.rpc('chat.send', {
      sessionKey,
      message,
      idempotencyKey: randomUUID(),
    }, 30000);
  } catch (err) {
    client.off('event:chat', handler);
    writeEvent({ state: 'error', error: String(err) });
    res.end();
  }
});

// ── OC File Config (openclaw.json via kubectl or local) ──────────────────────

function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', p.slice(1));
  }
  return p;
}

const OC_FILE_SOURCE = 'openclaw-file-source.json';
const OC_FILE_DEFAULT_PATH = '~/.openclaw/openclaw.json';

interface OcFileSource {
  type: 'kubernetes' | 'local' | 'ssh';
  namespace?: string;
  pod?: string;
  container?: string;
  filePath?: string;
  localPath?: string;
}

interface SshCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
}

function readSshCredentials(instanceName: string): SshCredentials | null {
  const p = path.join(INSTANCES_DIR, instanceName, 'ssh-credentials.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as SshCredentials; } catch { return null; }
}

function sshExec(creds: SshCredentials, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new SshClient();
    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) { conn.end(); reject(err); return; }
        let out = '';
        stream.on('data', (d: Buffer) => { out += d.toString(); });
        stream.stderr.on('data', (d: Buffer) => { out += d.toString(); });
        stream.on('close', (code: number) => {
          conn.end();
          if (code === 0) resolve(out);
          else reject(new Error(out.trim() || `exit code ${code}`));
        });
      });
    });
    conn.on('error', reject);
    conn.connect({ host: creds.host, port: creds.port, username: creds.username, password: creds.password, readyTimeout: 15000 });
  });
}

function sshWriteFile(creds: SshCredentials, filePath: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const conn = new SshClient();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) { conn.end(); reject(err); return; }
        const writeStream = sftp.createWriteStream(filePath);
        writeStream.on('close', () => { conn.end(); resolve(); });
        writeStream.on('error', (e: Error) => { conn.end(); reject(e); });
        writeStream.write(content);
        writeStream.end();
      });
    });
    conn.on('error', reject);
    conn.connect({ host: creds.host, port: creds.port, username: creds.username, password: creds.password, readyTimeout: 15000 });
  });
}

function readOcFileSource(instanceName: string): OcFileSource {
  const p = path.join(INSTANCES_DIR, instanceName, OC_FILE_SOURCE);
  if (!fs.existsSync(p)) return { type: 'local', localPath: `${process.env.HOME ?? '~'}/.openclaw/openclaw.json` };
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as OcFileSource; } catch { return { type: 'local' }; }
}

function writeOcFileSource(instanceName: string, src: OcFileSource): void {
  fs.writeFileSync(path.join(INSTANCES_DIR, instanceName, OC_FILE_SOURCE), JSON.stringify(src, null, 2), 'utf-8');
}

function spawnCollect(cmd: string, args: string[], stdin?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = ''; let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `exit code ${code}`));
    });
    if (stdin !== undefined) { proc.stdin.write(stdin); proc.stdin.end(); }
  });
}

function buildKubectlArgs(src: OcFileSource, baseArgs: string[]): string[] {
  const args = [...baseArgs];
  if (src.namespace) args.splice(1, 0, '-n', src.namespace);
  if (src.container) args.splice(1, 0, '-c', src.container);
  return args;
}

// GET /api/instances/:name/oc-config/source
app.get('/api/instances/:name/oc-config/source', (req: Request, res: Response) => {
  return res.json(readOcFileSource(req.params.name));
});

// PUT /api/instances/:name/oc-config/source
app.put('/api/instances/:name/oc-config/source', (req: Request, res: Response) => {
  const src = req.body as OcFileSource;
  if (!['kubernetes', 'local', 'ssh'].includes(src.type)) return res.status(400).json({ error: 'invalid type' });
  writeOcFileSource(req.params.name, src);
  return res.json({ ok: true });
});

// GET /api/instances/:name/ssh-credentials
app.get('/api/instances/:name/ssh-credentials', (req: Request, res: Response) => {
  const creds = readSshCredentials(req.params.name);
  if (!creds) return res.status(404).json({ error: 'SSH credentials not configured' });
  return res.json(creds);
});

// PUT /api/instances/:name/ssh-credentials
app.put('/api/instances/:name/ssh-credentials', (req: Request, res: Response) => {
  const { name } = req.params;
  const instanceDir = path.join(INSTANCES_DIR, name);
  if (!fs.existsSync(instanceDir)) return res.status(404).json({ error: `Instance "${name}" not found.` });
  const creds = req.body as SshCredentials;
  if (!creds.host || !creds.username || !creds.password) return res.status(400).json({ error: 'host, username and password are required' });
  fs.writeFileSync(path.join(instanceDir, 'ssh-credentials.json'), JSON.stringify({ host: creds.host, port: creds.port || 22, username: creds.username, password: creds.password }, null, 2), 'utf-8');
  return res.json({ ok: true });
});

// GET /api/instances/:name/oc-config/pods?namespace=xxx
app.get('/api/instances/:name/oc-config/pods', async (req: Request, res: Response) => {
  const { name } = req.params;
  const namespace = req.query.namespace as string | undefined;
  const args = ['get', 'pods', '-o', 'json'];
  if (namespace) args.push('-n', namespace);
  ocLog(name, 'info', 'kubectl', `get pods${namespace ? ` -n ${namespace}` : ''}`);
  try {
    const { stdout } = await spawnCollect('kubectl', args);
    const data = JSON.parse(stdout) as { items: Array<{
      metadata: { name: string; namespace: string; labels?: Record<string, string>; ownerReferences?: Array<{ kind: string; name: string }> };
      status: { phase: string; containerStatuses?: Array<{ ready: boolean }> };
      spec: { containers: Array<{ name: string }> };
    }> };
    const pods = data.items.map(p => {
      // Derive deployment name: prefer ownerReference ReplicaSet name stripped of its hash suffix,
      // fall back to the pod's `app` label which our template always sets.
      let deploymentName = p.metadata.labels?.app ?? '';
      const rsRef = p.metadata.ownerReferences?.find(r => r.kind === 'ReplicaSet');
      if (rsRef) {
        // ReplicaSet name is typically <deployment>-<hash>; strip the last dash-separated segment
        const parts = rsRef.name.split('-');
        if (parts.length > 1) deploymentName = parts.slice(0, -1).join('-');
      }
      return {
        name: p.metadata.name,
        namespace: p.metadata.namespace,
        status: p.status.phase,
        ready: p.status.containerStatuses?.every(c => c.ready) ?? false,
        containers: p.spec.containers.map(c => c.name),
        deploymentName,
      };
    });
    ocLog(name, 'info', 'kubectl', `found ${pods.length} pod(s)`, pods.map(p => `${p.name} (${p.status})`));
    return res.json({ pods });
  } catch (err) {
    ocLog(name, 'error', 'kubectl', `get pods failed: ${String(err)}`);
    return res.status(502).json({ error: String(err) });
  }
});

// GET /api/instances/:name/oc-config/local-deployment-name
// Returns the metadata.name from the local deployment.yaml, or empty string if file absent/unparseable
app.get('/api/instances/:name/oc-config/local-deployment-name', (req: Request, res: Response) => {
  const { name } = req.params;
  const filePath = path.join(INSTANCES_DIR, name, 'deployment.yaml');
  if (!fs.existsSync(filePath)) return res.json({ deploymentName: '' });
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const yaml = require('js-yaml') as { load: (s: string) => unknown };
    const doc = yaml.load(fs.readFileSync(filePath, 'utf-8')) as { metadata?: { name?: string } } | null;
    return res.json({ deploymentName: doc?.metadata?.name ?? '' });
  } catch {
    return res.json({ deploymentName: '' });
  }
});

// GET /api/instances/:name/oc-config/file
app.get('/api/instances/:name/oc-config/file', async (req: Request, res: Response) => {
  const { name } = req.params;
  const src = readOcFileSource(name);
  if (src.type === 'local') {
    const localPath = expandHome(src.localPath ?? `${process.env.HOME ?? '~'}/.openclaw/openclaw.json`);
    ocLog(name, 'info', 'config', `read local file: ${localPath}`);
    if (!fs.existsSync(localPath)) {
      ocLog(name, 'error', 'config', `file not found: ${localPath}`);
      return res.status(404).json({ error: `Not found: ${localPath}` });
    }
    try {
      const content = fs.readFileSync(localPath, 'utf-8');
      ocLog(name, 'info', 'config', `loaded ${content.length} bytes from ${localPath}`);
      return res.json({ content, path: localPath });
    } catch (e) {
      ocLog(name, 'error', 'config', `read failed: ${String(e)}`);
      return res.status(502).json({ error: String(e) });
    }
  }
  if (src.type === 'ssh') {
    const creds = readSshCredentials(name);
    if (!creds) return res.status(400).json({ error: 'SSH credentials not configured for this instance' });
    const filePath = src.filePath || '~/.openclaw/openclaw.json';
    ocLog(name, 'info', 'ssh', `read remote file: ${creds.host}:${filePath}`);
    try {
      const content = await sshExec(creds, `cat ${filePath}`);
      ocLog(name, 'info', 'ssh', `read ${content.length} bytes from ${creds.host}:${filePath}`);
      return res.json({ content, path: `${creds.host}:${filePath}` });
    } catch (err) {
      ocLog(name, 'error', 'ssh', `read failed: ${String(err)}`);
      return res.status(502).json({ error: String(err) });
    }
  }
  if (!src.pod) return res.status(400).json({ error: 'No pod selected' });
  // Use sh -c to resolve ~ correctly for any container user (avoids /root permission denied)
  const filePath = src.filePath || '~/.openclaw/openclaw.json';
  const cmd = `sh -c 'cat ${filePath}'`;
  ocLog(name, 'info', 'kubectl', `exec ${src.pod}: ${cmd}`);
  try {
    const args = buildKubectlArgs(src, ['exec', src.pod, '--', 'sh', '-c', `cat ${filePath}`]);
    const { stdout } = await spawnCollect('kubectl', args);
    ocLog(name, 'info', 'kubectl', `read ${stdout.length} bytes from ${src.pod}:${filePath}`);
    return res.json({ content: stdout, path: filePath });
  } catch (err) {
    ocLog(name, 'error', 'kubectl', `exec read failed: ${String(err)}`);
    return res.status(502).json({ error: String(err) });
  }
});

// PUT /api/instances/:name/oc-config/file
app.put('/api/instances/:name/oc-config/file', async (req: Request, res: Response) => {
  const { name } = req.params;
  const { content } = req.body as { content: string };
  if (!content) return res.status(400).json({ error: 'content required' });
  try { JSON.parse(content); } catch (e) { return res.status(400).json({ error: `Invalid JSON: ${String(e)}` }); }

  const src = readOcFileSource(name);
  if (src.type === 'local') {
    const localPath = expandHome(src.localPath ?? `${process.env.HOME ?? '~'}/.openclaw/openclaw.json`);
    ocLog(name, 'info', 'config', `write local file: ${localPath} (${content.length} bytes)`);
    try {
      fs.writeFileSync(localPath, content, 'utf-8');
      ocLog(name, 'info', 'config', `saved successfully: ${localPath}`);
      return res.json({ ok: true });
    } catch (e) {
      ocLog(name, 'error', 'config', `write failed: ${String(e)}`);
      return res.status(502).json({ error: String(e) });
    }
  }
  if (src.type === 'ssh') {
    const creds = readSshCredentials(name);
    if (!creds) return res.status(400).json({ error: 'SSH credentials not configured for this instance' });
    const filePath = src.filePath || '~/.openclaw/openclaw.json';
    ocLog(name, 'info', 'ssh', `write remote file: ${creds.host}:${filePath} (${content.length} bytes)`);
    try {
      // Expand ~ by writing via shell heredoc approach
      await sshExec(creds, `cat > ${filePath} << 'OCEOF'\n${content}\nOCEOF`);
      ocLog(name, 'info', 'ssh', `saved successfully to ${creds.host}:${filePath}`);
      return res.json({ ok: true });
    } catch (err) {
      ocLog(name, 'error', 'ssh', `write failed: ${String(err)}`);
      return res.status(502).json({ error: String(err) });
    }
  }
  if (!src.pod) return res.status(400).json({ error: 'No pod selected' });
  const filePath = src.filePath || '~/.openclaw/openclaw.json';
  const b64 = Buffer.from(content, 'utf-8').toString('base64');
  ocLog(name, 'info', 'kubectl', `exec ${src.pod}: write ${content.length} bytes to ${filePath}`);
  try {
    const args = buildKubectlArgs(src, ['exec', '-i', src.pod, '--', 'sh', '-c', `base64 -d > ${filePath}`]);
    await spawnCollect('kubectl', args, b64);
    ocLog(name, 'info', 'kubectl', `saved successfully to ${src.pod}:${filePath}`);
    return res.json({ ok: true });
  } catch (err) {
    ocLog(name, 'error', 'kubectl', `exec write failed: ${String(err)}`);
    return res.status(502).json({ error: String(err) });
  }
});

// POST /api/instances/:name/sync-from-pod
app.post('/api/instances/:name/sync-from-pod', async (req: Request, res: Response) => {
  const { name } = req.params;
  const src = readOcFileSource(name);

  if (src.type !== 'kubernetes' || !src.pod) {
    return res.status(400).json({ error: 'No kubernetes pod selected in oc-config source' });
  }

  const nsArgs = src.namespace ? ['-n', src.namespace] : [];
  const instanceDir = path.join(INSTANCES_DIR, name);
  const results: Record<string, string> = {};
  const errors: Record<string, string> = {};

  ocLog(name, 'info', 'sync', `syncing YAML from pod ${src.pod}`);

  try {
    // Get pod as JSON for parsing owner refs and volumes
    const { stdout: podJson } = await spawnCollect('kubectl', ['get', 'pod', src.pod, ...nsArgs, '-o', 'json']);
    const pod = JSON.parse(podJson) as {
      metadata: {
        labels?: Record<string, string>;
        ownerReferences?: Array<{ kind: string; name: string }>;
      };
      spec: {
        volumes?: Array<{
          name: string;
          persistentVolumeClaim?: { claimName: string };
          configMap?: { name: string };
        }>;
      };
    };

    // ── 1. Deployment (pod → ReplicaSet → Deployment) ──────────────────────
    let deploymentName: string | null = null;
    const owners = pod.metadata.ownerReferences ?? [];
    const directDeployOwner = owners.find(o => o.kind === 'Deployment');
    const rsOwner = owners.find(o => o.kind === 'ReplicaSet');

    if (directDeployOwner) {
      deploymentName = directDeployOwner.name;
    } else if (rsOwner) {
      try {
        const { stdout: rsJson } = await spawnCollect('kubectl', ['get', 'replicaset', rsOwner.name, ...nsArgs, '-o', 'json']);
        const rs = JSON.parse(rsJson) as { metadata: { ownerReferences?: Array<{ kind: string; name: string }> } };
        const depOwner = rs.metadata.ownerReferences?.find(o => o.kind === 'Deployment');
        if (depOwner) deploymentName = depOwner.name;
      } catch (e) {
        errors.deployment = `ReplicaSet lookup failed: ${String(e)}`;
      }
    }

    if (deploymentName) {
      try {
        const { stdout: yaml } = await spawnCollect('kubectl', ['get', 'deployment', deploymentName, ...nsArgs, '-o', 'yaml']);
        fs.writeFileSync(path.join(instanceDir, 'deployment.yaml'), yaml, 'utf-8');
        results.deployment = deploymentName;
        ocLog(name, 'info', 'sync', `saved deployment.yaml (${deploymentName})`);
      } catch (e) {
        errors.deployment = String(e);
      }
    }

    // ── 2. Service (match by pod labels, skip pod-template-hash) ───────────
    const podLabels = pod.metadata.labels ?? {};
    const labelSelector = Object.entries(podLabels)
      .filter(([k]) => k !== 'pod-template-hash')
      .map(([k, v]) => `${k}=${v}`)
      .join(',');

    if (labelSelector) {
      try {
        const { stdout: svcJson } = await spawnCollect('kubectl', ['get', 'service', '-l', labelSelector, ...nsArgs, '-o', 'json']);
        const svcList = JSON.parse(svcJson) as { items: Array<{ metadata: { name: string } }> };
        if (svcList.items?.length > 0) {
          const svcName = svcList.items[0].metadata.name;
          const { stdout: svcYaml } = await spawnCollect('kubectl', ['get', 'service', svcName, ...nsArgs, '-o', 'yaml']);
          fs.writeFileSync(path.join(instanceDir, 'service.yaml'), svcYaml, 'utf-8');
          results.service = svcName;
          ocLog(name, 'info', 'sync', `saved service.yaml (${svcName})`);
        }
      } catch (e) {
        errors.service = String(e);
      }
    }

    // ── 3. PVC (first PVC volume in pod spec) ──────────────────────────────
    const pvcVolumes = (pod.spec.volumes ?? []).filter(v => v.persistentVolumeClaim);
    if (pvcVolumes.length > 0) {
      const pvcName = pvcVolumes[0].persistentVolumeClaim!.claimName;
      try {
        const { stdout: pvcYaml } = await spawnCollect('kubectl', ['get', 'pvc', pvcName, ...nsArgs, '-o', 'yaml']);
        fs.writeFileSync(path.join(instanceDir, 'pvc.yaml'), pvcYaml, 'utf-8');
        results.pvc = pvcName;
        ocLog(name, 'info', 'sync', `saved pvc.yaml (${pvcName})`);
      } catch (e) {
        errors.pvc = String(e);
      }
    }

    // ── 4. ConfigMap (first non-system configmap volume) ───────────────────
    const cmVolumes = (pod.spec.volumes ?? [])
      .filter(v => v.configMap && v.configMap.name !== 'kube-root-ca.crt');
    if (cmVolumes.length > 0) {
      const cmName = cmVolumes[0].configMap!.name;
      try {
        const { stdout: cmYaml } = await spawnCollect('kubectl', ['get', 'configmap', cmName, ...nsArgs, '-o', 'yaml']);
        fs.writeFileSync(path.join(instanceDir, 'configmap.yaml'), cmYaml, 'utf-8');
        results.configmap = cmName;
        ocLog(name, 'info', 'sync', `saved configmap.yaml (${cmName})`);
      } catch (e) {
        errors.configmap = String(e);
      }
    }

    ocLog(name, 'info', 'sync', `sync complete: ${Object.keys(results).length} file(s) saved`, results);
    return res.json({ ok: true, results, errors });
  } catch (err) {
    ocLog(name, 'error', 'sync', `sync failed: ${String(err)}`);
    return res.status(502).json({ error: String(err) });
  }
});

// Serve static files in production
const clientDist = path.join(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// HTTP server + WebSocket
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/terminal' });

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  // Verify token from query string: /ws/terminal?token=xxx
  const parsed = url.parse(req.url ?? '', true);
  const wsToken = parsed.query['token'];
  if (wsToken !== AUTH_TOKEN) {
    ws.send('\r\n\x1b[31m[Unauthorized: invalid token]\x1b[0m\r\n');
    ws.close(4001, 'Unauthorized');
    return;
  }

  const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';

  let ptyProcess: pty.IPty;
  try {
    ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: INSTANCES_DIR,
      env: process.env as { [key: string]: string },
    });
  } catch (err) {
    ws.send(`\r\n\x1b[31m[Terminal error: ${String(err)}]\x1b[0m\r\n`);
    ws.close();
    return;
  }

  ptyProcess.onData((data: string) => {
    try {
      ws.send(data);
    } catch {
      // ignore send errors if ws is closing
    }
  });

  ptyProcess.onExit(() => {
    try {
      ws.close();
    } catch {
      // ignore
    }
  });

  ws.on('message', (message: Buffer) => {
    try {
      const msg = JSON.parse(message.toString()) as { type: string; data?: string; cols?: number; rows?: number };
      if (msg.type === 'input' && msg.data !== undefined) {
        ptyProcess.write(msg.data);
      } else if (msg.type === 'resize' && msg.cols !== undefined && msg.rows !== undefined) {
        ptyProcess.resize(msg.cols, msg.rows);
      }
    } catch {
      ptyProcess.write(message.toString());
    }
  });

  ws.on('close', () => {
    try {
      ptyProcess.kill();
    } catch {
      // ignore
    }
  });

  ws.on('error', () => {
    try {
      ptyProcess.kill();
    } catch {
      // ignore
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Instances dir: ${INSTANCES_DIR}`);
  console.log(`Templates dir: ${TEMPLATES_DIR}`);
});
