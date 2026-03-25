"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const http = __importStar(require("http"));
const ws_1 = require("ws");
const pty = __importStar(require("@homebridge/node-pty-prebuilt-multiarch"));
const child_process_1 = require("child_process");
const crypto_1 = require("crypto");
const url = __importStar(require("url"));
const app = (0, express_1.default)();
const PORT = 3001;
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '10mb' }));
const INSTANCES_DIR = path.join(__dirname, '../../instances');
const TEMPLATES_DIR = path.join(__dirname, '../../templates');
const CONFIG_FILE = path.join(__dirname, '../../config.json');
function loadOrCreateConfig() {
    // Env var takes priority
    if (process.env.AUTH_TOKEN) {
        return { authToken: process.env.AUTH_TOKEN };
    }
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
            const cfg = JSON.parse(raw);
            if (cfg.authToken)
                return cfg;
        }
        catch {
            // fall through to generate
        }
    }
    // First run: generate a random token and persist it
    const cfg = { authToken: (0, crypto_1.randomUUID)() };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
    return cfg;
}
const config = loadOrCreateConfig();
const AUTH_TOKEN = config.authToken;
console.log(`\n🔑 Auth token: ${AUTH_TOKEN}\n   (set AUTH_TOKEN env var or edit config.json to change)\n`);
// ── Auth middleware ───────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
    const header = req.headers['authorization'] ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (token === AUTH_TOKEN) {
        next();
        return;
    }
    res.status(401).json({ error: 'Unauthorized' });
}
// Public: verify endpoint (client uses this to test a token before storing)
app.post('/api/auth/verify', (req, res) => {
    const { token } = req.body;
    if (token === AUTH_TOKEN) {
        res.json({ ok: true });
    }
    else {
        res.status(401).json({ ok: false, error: 'Invalid token' });
    }
});
// All other /api routes require auth
app.use('/api', authMiddleware);
// Ensure directories exist
[INSTANCES_DIR, TEMPLATES_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));
const YAML_FILES = ['deployment.yaml', 'service.yaml', 'pvc.yaml', 'configmap.yaml', 'kustomization.yaml'];
function replaceOpenclaw(content, instanceName) {
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
app.get('/api/instances', (_req, res) => {
    try {
        if (!fs.existsSync(INSTANCES_DIR)) {
            return res.json([]);
        }
        const entries = fs.readdirSync(INSTANCES_DIR, { withFileTypes: true });
        const instances = entries
            .filter(e => e.isDirectory())
            .map(e => ({
            name: e.name,
            files: YAML_FILES.filter(f => fs.existsSync(path.join(INSTANCES_DIR, e.name, f))),
        }));
        return res.json(instances);
    }
    catch (err) {
        return res.status(500).json({ error: String(err) });
    }
});
// POST /api/instances
app.post('/api/instances', (req, res) => {
    const { name } = req.body;
    if (!name || !/^[a-z0-9-]+$/.test(name)) {
        return res.status(400).json({ error: 'Invalid instance name. Use lowercase letters, numbers, and dashes only.' });
    }
    const instanceDir = path.join(INSTANCES_DIR, name);
    if (fs.existsSync(instanceDir)) {
        return res.status(409).json({ error: `Instance "${name}" already exists.` });
    }
    try {
        fs.mkdirSync(instanceDir, { recursive: true });
        for (const file of YAML_FILES) {
            const templatePath = path.join(TEMPLATES_DIR, file);
            if (fs.existsSync(templatePath)) {
                let content = fs.readFileSync(templatePath, 'utf-8');
                content = replaceOpenclaw(content, name);
                fs.writeFileSync(path.join(instanceDir, file), content, 'utf-8');
            }
        }
        return res.status(201).json({ name, files: YAML_FILES });
    }
    catch (err) {
        return res.status(500).json({ error: String(err) });
    }
});
// DELETE /api/instances/:name
app.delete('/api/instances/:name', (req, res) => {
    const { name } = req.params;
    const instanceDir = path.join(INSTANCES_DIR, name);
    if (!fs.existsSync(instanceDir)) {
        return res.status(404).json({ error: `Instance "${name}" not found.` });
    }
    try {
        fs.rmSync(instanceDir, { recursive: true, force: true });
        return res.json({ success: true });
    }
    catch (err) {
        return res.status(500).json({ error: String(err) });
    }
});
// GET /api/instances/:name/files/:filename
app.get('/api/instances/:name/files/:filename', (req, res) => {
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
    }
    catch (err) {
        return res.status(500).json({ error: String(err) });
    }
});
// PUT /api/instances/:name/files/:filename
app.put('/api/instances/:name/files/:filename', (req, res) => {
    const { name, filename } = req.params;
    const { content } = req.body;
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
    }
    catch (err) {
        return res.status(500).json({ error: String(err) });
    }
});
// POST /api/instances/:name/deploy
app.post('/api/instances/:name/deploy', (req, res) => {
    const { name } = req.params;
    const instanceDir = path.join(INSTANCES_DIR, name);
    if (!fs.existsSync(instanceDir)) {
        return res.status(404).json({ error: `Instance "${name}" not found.` });
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const child = (0, child_process_1.spawn)('kubectl', ['apply', '-k', instanceDir], {
        cwd: instanceDir,
        env: process.env,
    });
    child.stdout.on('data', (data) => {
        res.write(data.toString());
    });
    child.stderr.on('data', (data) => {
        res.write(data.toString());
    });
    child.on('close', (code) => {
        if (code === 0) {
            res.write('\n✓ Deploy completed successfully.\n');
        }
        else {
            res.write(`\n✗ Deploy failed with exit code ${code}.\n`);
        }
        res.end();
    });
    child.on('error', (err) => {
        res.write(`\nError: ${err.message}\n`);
        res.end();
    });
});
// GET /api/instances/:name/status
app.get('/api/instances/:name/status', (req, res) => {
    const { name } = req.params;
    const child = (0, child_process_1.spawn)('kubectl', ['get', 'all', '-l', `app=${name}`], {
        env: process.env,
    });
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { errorOutput += data.toString(); });
    child.on('close', (code) => {
        if (code === 0) {
            return res.json({ output, error: null });
        }
        else {
            return res.json({ output: output || errorOutput, error: errorOutput });
        }
    });
    child.on('error', (err) => {
        return res.status(500).json({ error: err.message });
    });
});
// Serve static files in production
const clientDist = path.join(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
    app.use(express_1.default.static(clientDist));
    app.get('*', (_req, res) => {
        res.sendFile(path.join(clientDist, 'index.html'));
    });
}
// HTTP server + WebSocket
const server = http.createServer(app);
const wss = new ws_1.WebSocketServer({ server, path: '/ws/terminal' });
wss.on('connection', (ws, req) => {
    // Verify token from query string: /ws/terminal?token=xxx
    const parsed = url.parse(req.url ?? '', true);
    const wsToken = parsed.query['token'];
    if (wsToken !== AUTH_TOKEN) {
        ws.send('\r\n\x1b[31m[Unauthorized: invalid token]\x1b[0m\r\n');
        ws.close(4001, 'Unauthorized');
        return;
    }
    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    let ptyProcess;
    try {
        ptyProcess = pty.spawn(shell, [], {
            name: 'xterm-color',
            cols: 80,
            rows: 24,
            cwd: INSTANCES_DIR,
            env: process.env,
        });
    }
    catch (err) {
        ws.send(`\r\n\x1b[31m[Terminal error: ${String(err)}]\x1b[0m\r\n`);
        ws.close();
        return;
    }
    ptyProcess.onData((data) => {
        try {
            ws.send(data);
        }
        catch {
            // ignore send errors if ws is closing
        }
    });
    ptyProcess.onExit(() => {
        try {
            ws.close();
        }
        catch {
            // ignore
        }
    });
    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message.toString());
            if (msg.type === 'input' && msg.data !== undefined) {
                ptyProcess.write(msg.data);
            }
            else if (msg.type === 'resize' && msg.cols !== undefined && msg.rows !== undefined) {
                ptyProcess.resize(msg.cols, msg.rows);
            }
        }
        catch {
            ptyProcess.write(message.toString());
        }
    });
    ws.on('close', () => {
        try {
            ptyProcess.kill();
        }
        catch {
            // ignore
        }
    });
    ws.on('error', () => {
        try {
            ptyProcess.kill();
        }
        catch {
            // ignore
        }
    });
});
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Instances dir: ${INSTANCES_DIR}`);
    console.log(`Templates dir: ${TEMPLATES_DIR}`);
});
//# sourceMappingURL=index.js.map