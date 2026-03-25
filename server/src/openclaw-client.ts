import WebSocket from 'ws';
import * as crypto from 'crypto';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

export interface OpenClawConnectionConfig {
  url: string;          // e.g. ws://localhost:18789
  token: string;        // OPENCLAW_GATEWAY_TOKEN
  deviceId?: string;
  privateKeyPem?: string;
  publicKeyBase64?: string;
}

interface RpcCallback {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer?: NodeJS.Timeout;
}

export type OpenClawStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// Ed25519 SPKI prefix: 302a300506032b6570032100 (12 bytes)
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getRawPublicKey(publicKey: crypto.KeyObject): Buffer {
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  // SPKI for Ed25519 = 12-byte prefix + 32-byte raw key
  if (spki.length === ED25519_SPKI_PREFIX.length + 32 &&
      spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki.subarray(-32); // fallback
}

function generateDeviceKeypair(): { deviceId: string; privateKeyPem: string; publicKeyBase64: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const rawPub = getRawPublicKey(publicKey);
  // Device ID = full sha256 hex of raw public key (64 chars) - matches openclaw's fingerprintPublicKey
  const deviceId = crypto.createHash('sha256').update(rawPub).digest('hex');
  // Public key must be base64url encoded (not standard base64)
  const publicKeyBase64 = base64UrlEncode(rawPub);
  return { deviceId, privateKeyPem, publicKeyBase64 };
}

function signDevicePayload(params: {
  deviceId: string;
  token: string;
  nonce: string;
  signedAtMs: number;
  privateKeyPem: string;
}): string {
  // v3 payload format from openclaw source: buildDeviceAuthPayloadV3
  const payload = [
    'v3',
    params.deviceId,
    'gateway-client',
    'backend',
    'operator',
    'operator.read,operator.write', // scopes — comma-separated, matches server's array.join(",")
    String(params.signedAtMs),
    params.token,
    params.nonce,
    'linux',
    '',                             // deviceFamily
  ].join('|');

  const privateKey = crypto.createPrivateKey(params.privateKeyPem);
  // Ed25519: sign(null, data, key) — output as base64url
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload), privateKey) as Buffer);
}

export class OpenClawClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private pending = new Map<string, RpcCallback>();
  private status: OpenClawStatus = 'disconnected';
  private deviceId: string;
  private privateKeyPem: string;
  private publicKeyBase64: string;
  private lastError: string | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private config: OpenClawConnectionConfig) {
    super();
    if (config.deviceId && config.privateKeyPem && config.publicKeyBase64) {
      this.deviceId = config.deviceId;
      this.privateKeyPem = config.privateKeyPem;
      this.publicKeyBase64 = config.publicKeyBase64;
    } else {
      const kp = generateDeviceKeypair();
      this.deviceId = kp.deviceId;
      this.privateKeyPem = kp.privateKeyPem;
      this.publicKeyBase64 = kp.publicKeyBase64;
    }
  }

  getStatus(): OpenClawStatus { return this.status; }
  getLastError(): string | null { return this.lastError; }
  getDeviceKeypair() {
    return {
      deviceId: this.deviceId,
      privateKeyPem: this.privateKeyPem,
      publicKeyBase64: this.publicKeyBase64,
    };
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.status === 'connected') { resolve(); return; }
      if (this.status === 'connecting') { reject(new Error('Already connecting')); return; }

      this.setStatus('connecting');
      this.lastError = null;

      const ws = new WebSocket(this.config.url, {
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

      ws.on('message', (data: Buffer | string) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(data.toString()) as Record<string, unknown>;
        } catch {
          return;
        }

        // Handle challenge → send connect
        if (!handshakeDone && msg.type === 'event' && msg.event === 'connect.challenge') {
          const payload = msg.payload as { nonce: string; ts: number };
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
            id: randomUUID(),
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
              scopes: ['operator.read', 'operator.write'],
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
          const res = msg as {
            ok: boolean;
            error?: { message: string; details?: { code?: string; requestId?: string; reason?: string } };
          };
          if (res.ok) {
            this.setStatus('connected');
            this.emit('connected');
            resolve();
          } else {
            const errMsg = res.error?.message ?? 'Connect failed';
            this.setStatus('error');
            this.lastError = errMsg;
            ws.close();
            // Attach pairing details to error for the caller
            const err = new Error(errMsg) as Error & { pairingRequired?: boolean; requestId?: string; deviceId?: string };
            if (res.error?.details?.code === 'PAIRING_REQUIRED' || errMsg === 'pairing required') {
              err.pairingRequired = true;
              err.requestId = res.error?.details?.requestId;
              err.deviceId = this.deviceId;
            }
            reject(err);
          }
          return;
        }

        // Handle RPC responses
        if (msg.type === 'res' && typeof msg.id === 'string') {
          const cb = this.pending.get(msg.id);
          if (cb) {
            this.pending.delete(msg.id);
            if (cb.timer) clearTimeout(cb.timer);
            const res = msg as { ok: boolean; payload?: unknown; error?: { message: string; code?: string } };
            if (res.ok) {
              cb.resolve(res.payload);
            } else {
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
        } else {
          this.setStatus('disconnected');
          // Reject all pending RPCs
          for (const [, cb] of this.pending) {
            if (cb.timer) clearTimeout(cb.timer);
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

  async rpc(method: string, params?: unknown, timeoutMs = 15000): Promise<unknown> {
    if (!this.ws || this.status !== 'connected') {
      throw new Error('Not connected to gateway');
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.setStatus('disconnected');
    for (const [, cb] of this.pending) {
      if (cb.timer) clearTimeout(cb.timer);
      cb.reject(new Error('Disconnected'));
    }
    this.pending.clear();
  }

  private setStatus(s: OpenClawStatus) {
    this.status = s;
    this.emit('status', s);
  }
}

// Pool of clients per instance
const clientPool = new Map<string, OpenClawClient>();

export function getOrCreateClient(instanceName: string, config: OpenClawConnectionConfig): OpenClawClient {
  const existing = clientPool.get(instanceName);
  if (existing) return existing;
  const client = new OpenClawClient(config);
  clientPool.set(instanceName, client);
  return client;
}

export function getClient(instanceName: string): OpenClawClient | null {
  return clientPool.get(instanceName) ?? null;
}

export function removeClient(instanceName: string): void {
  const client = clientPool.get(instanceName);
  if (client) {
    client.disconnect();
    clientPool.delete(instanceName);
  }
}
