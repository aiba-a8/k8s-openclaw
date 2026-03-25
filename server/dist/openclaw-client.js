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
exports.OpenClawClient = void 0;
exports.getOrCreateClient = getOrCreateClient;
exports.getClient = getClient;
exports.removeClient = removeClient;
const ws_1 = __importDefault(require("ws"));
const crypto = __importStar(require("crypto"));
const crypto_1 = require("crypto");
const events_1 = require("events");
// Ed25519 SPKI prefix: 302a300506032b6570032100 (12 bytes)
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
function base64UrlEncode(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function getRawPublicKey(publicKey) {
    const spki = publicKey.export({ type: 'spki', format: 'der' });
    // SPKI for Ed25519 = 12-byte prefix + 32-byte raw key
    if (spki.length === ED25519_SPKI_PREFIX.length + 32 &&
        spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
        return spki.subarray(ED25519_SPKI_PREFIX.length);
    }
    return spki.subarray(-32); // fallback
}
function generateDeviceKeypair() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const rawPub = getRawPublicKey(publicKey);
    // Device ID = full sha256 hex of raw public key (64 chars) - matches openclaw's fingerprintPublicKey
    const deviceId = crypto.createHash('sha256').update(rawPub).digest('hex');
    // Public key must be base64url encoded (not standard base64)
    const publicKeyBase64 = base64UrlEncode(rawPub);
    return { deviceId, privateKeyPem, publicKeyBase64 };
}
function signDevicePayload(params) {
    // v3 payload format from openclaw source: buildDeviceAuthPayloadV3
    const payload = [
        'v3',
        params.deviceId,
        'gateway-client',
        'backend',
        'operator',
        '', // scopes
        String(params.signedAtMs),
        params.token,
        params.nonce,
        'linux',
        '', // deviceFamily
    ].join('|');
    const privateKey = crypto.createPrivateKey(params.privateKeyPem);
    // Ed25519: sign(null, data, key) — output as base64url
    return base64UrlEncode(crypto.sign(null, Buffer.from(payload), privateKey));
}
class OpenClawClient extends events_1.EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.ws = null;
        this.pending = new Map();
        this.status = 'disconnected';
        this.lastError = null;
        this.reconnectTimer = null;
        if (config.deviceId && config.privateKeyPem && config.publicKeyBase64) {
            this.deviceId = config.deviceId;
            this.privateKeyPem = config.privateKeyPem;
            this.publicKeyBase64 = config.publicKeyBase64;
        }
        else {
            const kp = generateDeviceKeypair();
            this.deviceId = kp.deviceId;
            this.privateKeyPem = kp.privateKeyPem;
            this.publicKeyBase64 = kp.publicKeyBase64;
        }
    }
    getStatus() { return this.status; }
    getLastError() { return this.lastError; }
    getDeviceKeypair() {
        return {
            deviceId: this.deviceId,
            privateKeyPem: this.privateKeyPem,
            publicKeyBase64: this.publicKeyBase64,
        };
    }
    connect() {
        return new Promise((resolve, reject) => {
            if (this.status === 'connected') {
                resolve();
                return;
            }
            if (this.status === 'connecting') {
                reject(new Error('Already connecting'));
                return;
            }
            this.setStatus('connecting');
            this.lastError = null;
            const ws = new ws_1.default(this.config.url, {
                headers: { 'User-Agent': 'k8s-openclaw-manager/1.0' },
            });
            this.ws = ws;
            let handshakeDone = false;
            const timeout = setTimeout(() => {
                if (!handshakeDone) {
                    ws.terminate();
                    reject(new Error('Connection timeout (10s)'));
                }
            }, 10000);
            ws.on('open', () => {
                // Wait for the challenge event
            });
            ws.on('message', (data) => {
                let msg;
                try {
                    msg = JSON.parse(data.toString());
                }
                catch {
                    return;
                }
                // Handle challenge → send connect
                if (!handshakeDone && msg.type === 'event' && msg.event === 'connect.challenge') {
                    const payload = msg.payload;
                    const signedAtMs = Date.now();
                    const signature = signDevicePayload({
                        deviceId: this.deviceId,
                        token: this.config.token,
                        nonce: payload.nonce,
                        signedAtMs,
                        privateKeyPem: this.privateKeyPem,
                    });
                    const connectMsg = {
                        type: 'req',
                        id: (0, crypto_1.randomUUID)(),
                        method: 'connect',
                        params: {
                            minProtocol: 1,
                            maxProtocol: 3,
                            client: {
                                id: 'gateway-client',
                                displayName: 'K8s Manager',
                                version: '1.0.0',
                                platform: 'linux',
                                mode: 'backend',
                            },
                            auth: { token: this.config.token },
                            device: {
                                id: this.deviceId,
                                publicKey: this.publicKeyBase64,
                                signature,
                                signedAt: signedAtMs,
                                nonce: payload.nonce,
                            },
                            caps: [],
                            commands: [],
                        },
                    };
                    ws.send(JSON.stringify(connectMsg));
                    return;
                }
                // Handle hello-ok (connect response)
                if (!handshakeDone && msg.type === 'res') {
                    clearTimeout(timeout);
                    handshakeDone = true;
                    const res = msg;
                    if (res.ok) {
                        this.setStatus('connected');
                        this.emit('connected');
                        resolve();
                    }
                    else {
                        const errMsg = res.error?.message ?? 'Connect failed';
                        this.setStatus('error');
                        this.lastError = errMsg;
                        ws.close();
                        reject(new Error(errMsg));
                    }
                    return;
                }
                // Handle RPC responses
                if (msg.type === 'res' && typeof msg.id === 'string') {
                    const cb = this.pending.get(msg.id);
                    if (cb) {
                        this.pending.delete(msg.id);
                        if (cb.timer)
                            clearTimeout(cb.timer);
                        const res = msg;
                        if (res.ok) {
                            cb.resolve(res.payload);
                        }
                        else {
                            cb.reject(new Error(res.error?.message ?? 'RPC failed'));
                        }
                    }
                    return;
                }
                // Forward events to listeners
                if (msg.type === 'event' && typeof msg.event === 'string') {
                    this.emit('gateway-event', msg.event, msg.payload);
                    this.emit(`event:${msg.event}`, msg.payload);
                }
            });
            ws.on('close', (code, reason) => {
                this.ws = null;
                if (!handshakeDone) {
                    clearTimeout(timeout);
                    const errMsg = `WebSocket closed before handshake (code=${code})`;
                    this.setStatus('error');
                    this.lastError = reason?.toString() || errMsg;
                    reject(new Error(errMsg));
                }
                else {
                    this.setStatus('disconnected');
                    // Reject all pending RPCs
                    for (const [, cb] of this.pending) {
                        if (cb.timer)
                            clearTimeout(cb.timer);
                        cb.reject(new Error('WebSocket disconnected'));
                    }
                    this.pending.clear();
                    this.emit('disconnected');
                }
            });
            ws.on('error', (err) => {
                this.lastError = err.message;
                if (!handshakeDone) {
                    clearTimeout(timeout);
                    handshakeDone = true;
                    this.setStatus('error');
                    reject(err);
                }
            });
        });
    }
    async rpc(method, params, timeoutMs = 15000) {
        if (!this.ws || this.status !== 'connected') {
            throw new Error('Not connected to gateway');
        }
        const id = (0, crypto_1.randomUUID)();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`RPC timeout: ${method}`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            this.ws.send(JSON.stringify({ type: 'req', id, method, params }));
        });
    }
    disconnect() {
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        if (this.ws) {
            this.ws.close(1000, 'Client disconnect');
            this.ws = null;
        }
        this.setStatus('disconnected');
        for (const [, cb] of this.pending) {
            if (cb.timer)
                clearTimeout(cb.timer);
            cb.reject(new Error('Disconnected'));
        }
        this.pending.clear();
    }
    setStatus(s) {
        this.status = s;
        this.emit('status', s);
    }
}
exports.OpenClawClient = OpenClawClient;
// Pool of clients per instance
const clientPool = new Map();
function getOrCreateClient(instanceName, config) {
    const existing = clientPool.get(instanceName);
    if (existing)
        return existing;
    const client = new OpenClawClient(config);
    clientPool.set(instanceName, client);
    return client;
}
function getClient(instanceName) {
    return clientPool.get(instanceName) ?? null;
}
function removeClient(instanceName) {
    const client = clientPool.get(instanceName);
    if (client) {
        client.disconnect();
        clientPool.delete(instanceName);
    }
}
//# sourceMappingURL=openclaw-client.js.map