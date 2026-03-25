import { EventEmitter } from 'events';
export interface OpenClawConnectionConfig {
    url: string;
    token: string;
    deviceId?: string;
    privateKeyPem?: string;
    publicKeyBase64?: string;
}
export type OpenClawStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export declare class OpenClawClient extends EventEmitter {
    private config;
    private ws;
    private pending;
    private status;
    private deviceId;
    private privateKeyPem;
    private publicKeyBase64;
    private lastError;
    private reconnectTimer;
    constructor(config: OpenClawConnectionConfig);
    getStatus(): OpenClawStatus;
    getLastError(): string | null;
    getDeviceKeypair(): {
        deviceId: string;
        privateKeyPem: string;
        publicKeyBase64: string;
    };
    connect(): Promise<void>;
    rpc(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
    disconnect(): void;
    private setStatus;
}
export declare function getOrCreateClient(instanceName: string, config: OpenClawConnectionConfig): OpenClawClient;
export declare function getClient(instanceName: string): OpenClawClient | null;
export declare function removeClient(instanceName: string): void;
//# sourceMappingURL=openclaw-client.d.ts.map