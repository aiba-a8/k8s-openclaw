import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  WifiOff, Loader2, AlertCircle, Bot, Radio,
  Settings2, RefreshCw, CheckCircle2, XCircle,
  Power, Unplug, Save, X, Edit3, Cpu,
} from 'lucide-react';
import { authHeaders } from '../utils/auth';

interface Props {
  instanceName: string;
  gatewayToken?: string;
  autoOpenSettings?: boolean;
  onAutoOpenHandled?: () => void;
}

type ConnStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
type SubTab = 'agents' | 'channels' | 'models';

interface AgentIdentity {
  name?: string;
  emoji?: string;
  avatar?: string;
  avatarUrl?: string;
}

interface Agent {
  id: string;
  name?: string;
  identity?: AgentIdentity;
}

interface ChannelAccount {
  accountId: string;
  name?: string;
  enabled?: boolean;
  configured?: boolean;
  running?: boolean;
  connected?: boolean;
  lastError?: string;
  mode?: string;
}

interface Model {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
}

interface PairingInfo {
  deviceId: string;
  requestId?: string;
}

// ── Connection Settings ────────────────────────────────────────────────────────
function ConnectionSettings({
  instanceName, onSaved, initialToken,
}: { instanceName: string; onSaved: () => void; initialToken?: string }) {
  const [ocUrl, setOcUrl] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/instances/${instanceName}/openclaw/settings`, { headers: authHeaders() })
      .then(r => r.json())
      .then((d: { url: string; token: string }) => {
        setOcUrl(d.url || '');
        // Pre-fill token from instance if not already saved
        setToken(d.token || initialToken || '');
      })
      .finally(() => setLoading(false));
  }, [instanceName, initialToken]);

  const handleSave = async () => {
    setSaving(true); setError(null);
    try {
      const r = await fetch(`/api/instances/${instanceName}/openclaw/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ url: ocUrl, token }),
      });
      if (!r.ok) throw new Error((await r.json() as { error: string }).error);
      onSaved();
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center gap-2 text-gray-500 text-xs p-4"><Loader2 size={14} className="animate-spin" />Loading...</div>;

  return (
    <div className="p-4 space-y-3">
      <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Connection Settings</h3>
      <div className="space-y-2">
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Gateway URL</label>
          <input
            value={ocUrl} onChange={e => setOcUrl(e.target.value)}
            placeholder="ws://localhost:18789"
            className="w-full bg-gray-900 border border-gray-600 rounded px-2.5 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
          />
          {ocUrl && !ocUrl.startsWith('ws://') && !ocUrl.startsWith('wss://') && (
            <p className="text-xs text-yellow-400 mt-1">
              ⚠ URL 需以 <code>ws://</code> 或 <code>wss://</code> 开头（保存时将自动补全）
            </p>
          )}
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Gateway Token (OPENCLAW_GATEWAY_TOKEN)</label>
          <input
            type="password" value={token} onChange={e => setToken(e.target.value)}
            placeholder="Enter gateway token..."
            className="w-full bg-gray-900 border border-gray-600 rounded px-2.5 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
          />
        </div>
      </div>
      <p className="text-xs text-gray-600">
        For k8s: run <code className="text-gray-500">kubectl port-forward pod/&lt;pod&gt; 18789:18789</code> then use <code className="text-gray-500">ws://localhost:18789</code>
      </p>
      {error && <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle size={12} />{error}</p>}
      <button
        onClick={() => void handleSave()} disabled={saving || !ocUrl || !token}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-blue-400 text-white text-xs rounded transition-colors"
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
        Save
      </button>
    </div>
  );
}

// ── Error display helper ────────────────────────────────────────────────────────
function ErrorRow({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2 p-4 text-xs text-red-400">
      <AlertCircle size={14} className="flex-shrink-0" />
      <span className="flex-1 break-all">{error}</span>
      <button onClick={onRetry} className="flex-shrink-0 text-gray-400 hover:text-gray-200">
        <RefreshCw size={12} />
      </button>
    </div>
  );
}

// ── Agents Tab ─────────────────────────────────────────────────────────────────
function AgentsView({ instanceName }: { instanceName: string }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [meta, setMeta] = useState<{ defaultId?: string; scope?: string }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    fetch(`/api/instances/${instanceName}/openclaw/agents`, { headers: authHeaders() })
      .then(r => r.json())
      .then((d: unknown) => {
        const data = d as { agents?: Agent[]; defaultId?: string; scope?: string };
        setAgents(data.agents ?? []);
        setMeta({ defaultId: data.defaultId, scope: data.scope });
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [instanceName]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex items-center gap-2 p-4 text-gray-500 text-xs"><Loader2 size={14} className="animate-spin" />Loading agents...</div>;
  if (error) return <ErrorRow error={error} onRetry={load} />;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-300">{agents.length} Agent{agents.length !== 1 ? 's' : ''}</span>
          {meta.scope && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">{meta.scope}</span>}
        </div>
        <button onClick={load} className="text-gray-400 hover:text-gray-200"><RefreshCw size={13} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {agents.length === 0 && <p className="text-xs text-gray-500 text-center py-8">No agents configured</p>}
        {agents.map(agent => {
          const displayName = agent.identity?.name ?? agent.name ?? agent.id;
          const emoji = agent.identity?.emoji;
          const isDefault = agent.id === meta.defaultId;
          return (
            <div key={agent.id}
              className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 transition-colors"
            >
              <div className="w-9 h-9 rounded-full bg-blue-900/50 border border-blue-700/50 flex items-center justify-center flex-shrink-0 text-lg">
                {emoji ?? <Bot size={16} className="text-blue-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-gray-100 truncate">{displayName}</span>
                  {isDefault && <span className="text-xs px-1 py-0.5 rounded bg-blue-900/50 text-blue-400 border border-blue-800 flex-shrink-0">default</span>}
                </div>
                <div className="text-xs text-gray-600 font-mono truncate mt-0.5">{agent.id}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Channels Tab ───────────────────────────────────────────────────────────────
function ChannelsView({ instanceName }: { instanceName: string }) {
  const [channelOrder, setChannelOrder] = useState<string[]>([]);
  const [channelLabels, setChannelLabels] = useState<Record<string, string>>({});
  const [channelAccounts, setChannelAccounts] = useState<Record<string, ChannelAccount[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    fetch(`/api/instances/${instanceName}/openclaw/channels`, { headers: authHeaders() })
      .then(r => r.json())
      .then((d: unknown) => {
        const data = d as {
          channelOrder?: string[];
          channelLabels?: Record<string, string>;
          channelAccounts?: Record<string, ChannelAccount[]>;
        };
        setChannelOrder(data.channelOrder ?? Object.keys(data.channelAccounts ?? {}));
        setChannelLabels(data.channelLabels ?? {});
        setChannelAccounts(data.channelAccounts ?? {});
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [instanceName]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex items-center gap-2 p-4 text-gray-500 text-xs"><Loader2 size={14} className="animate-spin" />Loading channels...</div>;
  if (error) return <ErrorRow error={error} onRetry={load} />;

  const totalAccounts = Object.values(channelAccounts).reduce((s, a) => s + a.length, 0);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <span className="text-xs font-medium text-gray-300">
          {channelOrder.length} Channel{channelOrder.length !== 1 ? 's' : ''} · {totalAccounts} account{totalAccounts !== 1 ? 's' : ''}
        </span>
        <button onClick={load} className="text-gray-400 hover:text-gray-200"><RefreshCw size={13} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {channelOrder.length === 0 && <p className="text-xs text-gray-500 text-center py-8">No channels configured</p>}
        {channelOrder.map(channelId => {
          const accounts = channelAccounts[channelId] ?? [];
          const label = channelLabels[channelId] ?? channelId;
          return (
            <div key={channelId} className="border border-gray-700 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-gray-800 flex items-center gap-2">
                <Radio size={13} className="text-purple-400 flex-shrink-0" />
                <span className="text-xs font-semibold text-gray-200">{label}</span>
                <span className="text-xs text-gray-600 font-mono">{channelId !== label ? channelId : ''}</span>
                <span className="ml-auto text-xs text-gray-500">{accounts.length} account{accounts.length !== 1 ? 's' : ''}</span>
              </div>
              {accounts.length === 0 && (
                <div className="px-3 py-2 bg-gray-900/30 text-xs text-gray-600 italic">No accounts</div>
              )}
              {accounts.map(acc => {
                const statusColor = acc.connected
                  ? 'bg-green-400'
                  : acc.running
                  ? 'bg-yellow-400 animate-pulse'
                  : 'bg-gray-600';
                return (
                  <div key={acc.accountId} className="px-3 py-2 bg-gray-900/50 border-t border-gray-700">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
                      <span className="text-xs text-gray-300 flex-1 font-medium">{acc.name ?? acc.accountId}</span>
                      <div className="flex items-center gap-1">
                        {acc.connected && <span className="text-xs px-1.5 py-0.5 rounded bg-green-900/50 text-green-400 border border-green-800">connected</span>}
                        {!acc.connected && acc.running && <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-400 border border-yellow-800">running</span>}
                        {acc.configured && !acc.connected && !acc.running && <span className="text-xs px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-400 border border-blue-800">configured</span>}
                        {!acc.enabled && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 border border-gray-700">disabled</span>}
                        {acc.mode && <span className="text-xs text-gray-600">{acc.mode}</span>}
                      </div>
                    </div>
                    {acc.lastError && (
                      <p className="text-xs text-red-400 mt-1 ml-4 truncate" title={acc.lastError}>{acc.lastError}</p>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Models Tab ─────────────────────────────────────────────────────────────────
function ModelsView({ instanceName }: { instanceName: string }) {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    fetch(`/api/instances/${instanceName}/openclaw/models`, { headers: authHeaders() })
      .then(r => r.json())
      .then((d: unknown) => {
        const data = d as { models?: Model[] };
        setModels(data.models ?? []);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [instanceName]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex items-center gap-2 p-4 text-gray-500 text-xs"><Loader2 size={14} className="animate-spin" />Loading models...</div>;
  if (error) return <ErrorRow error={error} onRetry={load} />;

  // Group by provider
  const byProvider: Record<string, Model[]> = {};
  for (const m of models) {
    (byProvider[m.provider] ??= []).push(m);
  }
  const providers = Object.keys(byProvider).sort();

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <span className="text-xs font-medium text-gray-300">
          {models.length} Model{models.length !== 1 ? 's' : ''} · {providers.length} Provider{providers.length !== 1 ? 's' : ''}
        </span>
        <button onClick={load} className="text-gray-400 hover:text-gray-200"><RefreshCw size={13} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {providers.length === 0 && <p className="text-xs text-gray-500 text-center py-8">No models available</p>}
        {providers.map(provider => (
          <div key={provider} className="border border-gray-700 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-gray-800 flex items-center gap-2">
              <Cpu size={13} className="text-cyan-400 flex-shrink-0" />
              <span className="text-xs font-semibold text-gray-200 capitalize">{provider}</span>
              <span className="ml-auto text-xs text-gray-500">{byProvider[provider].length} model{byProvider[provider].length !== 1 ? 's' : ''}</span>
            </div>
            {byProvider[provider].map(model => (
              <div key={model.id} className="px-3 py-2 bg-gray-900/50 border-t border-gray-700 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-gray-200 truncate">{model.name}</div>
                  <div className="text-xs text-gray-600 font-mono truncate">{model.id}</div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {model.reasoning && <span className="text-xs px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-400 border border-purple-800">reasoning</span>}
                  {model.contextWindow && (
                    <span className="text-xs text-gray-500">
                      {model.contextWindow >= 1000000
                        ? `${(model.contextWindow / 1000000).toFixed(0)}M`
                        : model.contextWindow >= 1000
                        ? `${(model.contextWindow / 1000).toFixed(0)}k`
                        : model.contextWindow}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Pairing Guidance ───────────────────────────────────────────────────────────
function PairingGuide({ info, onRetry, onDismiss }: { info: PairingInfo; onRetry: () => void; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  const copyText = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="flex items-start gap-3 p-3 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
        <AlertCircle size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-yellow-300 space-y-1">
          <p className="font-semibold">Device Pairing Required</p>
          <p className="text-xs text-yellow-400/80">This device needs to be approved by the OpenClaw admin before it can connect remotely.</p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Device ID</p>
        <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 border border-gray-700">
          <code className="text-xs text-green-400 font-mono flex-1 break-all">{info.deviceId}</code>
          <button onClick={() => copyText(info.deviceId)} className="text-gray-400 hover:text-gray-200 flex-shrink-0">
            {copied ? <CheckCircle2 size={13} className="text-green-400" /> : <Edit3 size={13} />}
          </button>
        </div>
        {info.requestId && (
          <p className="text-xs text-gray-500">Request ID: <code className="text-gray-400">{info.requestId}</code></p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-300 uppercase tracking-wider">How to Approve</p>
        <div className="space-y-2 text-xs text-gray-400">
          <div className="flex items-start gap-2">
            <span className="text-blue-400 font-bold flex-shrink-0">1.</span>
            <span>Log in to the OpenClaw admin control panel and navigate to <strong className="text-gray-300">Devices → Pending</strong> to approve.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-blue-400 font-bold flex-shrink-0">2.</span>
            <span>Or use the terminal to exec into the pod and approve via CLI.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-blue-400 font-bold flex-shrink-0">3.</span>
            <span>After approval, click <strong className="text-gray-300">Retry Connect</strong> below.</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <button onClick={onRetry} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs rounded-lg transition-colors">
          <RefreshCw size={12} />Retry Connect
        </button>
        <button onClick={onDismiss} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg transition-colors">
          <X size={12} />Dismiss
        </button>
      </div>
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────
export default function OpenClawPanel({ instanceName, gatewayToken, autoOpenSettings, onAutoOpenHandled }: Props) {
  const [status, setStatus] = useState<ConnStatus>('disconnected');
  const [connError, setConnError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [subTab, setSubTab] = useState<SubTab>('agents');
  const [pairingInfo, setPairingInfo] = useState<PairingInfo | null>(null);
  const pollRef = useRef<NodeJS.Timeout>();

  // Auto-open settings when deploy succeeds
  useEffect(() => {
    if (autoOpenSettings) {
      setShowSettings(true);
      onAutoOpenHandled?.();
    }
  }, [autoOpenSettings, onAutoOpenHandled]);

  const pollStatus = useCallback(() => {
    fetch(`/api/instances/${instanceName}/openclaw/status`, { headers: authHeaders() })
      .then(r => r.json())
      .then((d: { status: ConnStatus; error: string | null }) => {
        setStatus(d.status);
        setConnError(d.error);
      })
      .catch(() => {});
  }, [instanceName]);

  useEffect(() => {
    pollStatus();
    pollRef.current = setInterval(pollStatus, 5000);
    return () => clearInterval(pollRef.current);
  }, [pollStatus]);

  const handleConnect = async () => {
    setConnecting(true);
    setPairingInfo(null);
    try {
      const r = await fetch(`/api/instances/${instanceName}/openclaw/connect`, {
        method: 'POST', headers: authHeaders(),
      });
      const d = await r.json() as { ok?: boolean; error?: string; pairingRequired?: boolean; deviceId?: string; requestId?: string };
      if (d.pairingRequired) {
        setStatus('error');
        setConnError('pairing required');
        setPairingInfo({ deviceId: d.deviceId ?? '', requestId: d.requestId });
      } else if (!d.ok) {
        throw new Error(d.error ?? 'Connect failed');
      } else {
        setStatus('connected');
      }
    } catch (e) {
      setStatus('error');
      setConnError(String(e));
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await fetch(`/api/instances/${instanceName}/openclaw/disconnect`, {
      method: 'POST', headers: authHeaders(),
    });
    setStatus('disconnected');
    setConnError(null);
    setPairingInfo(null);
  };

  const isConnected = status === 'connected';

  const ALL_TABS: { id: SubTab; label: string; icon: React.ReactNode }[] = [
    { id: 'agents', label: 'Agents', icon: <Bot size={13} /> },
    { id: 'channels', label: 'Channels', icon: <Radio size={13} /> },
    { id: 'models', label: 'Models', icon: <Cpu size={13} /> },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Connection bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
          status === 'connected' ? 'bg-green-400 animate-pulse' :
          status === 'connecting' ? 'bg-yellow-400 animate-pulse' :
          status === 'error' ? 'bg-red-400' : 'bg-gray-600'
        }`} />
        <span className="text-xs text-gray-300 capitalize">{status}</span>
        {connError && !showSettings && !pairingInfo && (
          <span className="text-xs text-red-400 truncate max-w-xs" title={connError}>{connError}</span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setShowSettings(v => !v)}
            className={`p-1 rounded text-gray-400 hover:text-gray-200 transition-colors ${showSettings ? 'bg-gray-700 text-gray-200' : ''}`}
            title="Connection settings"
          >
            <Settings2 size={14} />
          </button>

          {!isConnected ? (
            <button
              onClick={() => void handleConnect()} disabled={connecting}
              className="flex items-center gap-1 px-2.5 py-1 bg-green-600 hover:bg-green-500 disabled:bg-green-800 disabled:text-green-400 text-white text-xs rounded transition-colors"
            >
              {connecting ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
              Connect
            </button>
          ) : (
            <button
              onClick={() => void handleDisconnect()}
              className="flex items-center gap-1 px-2.5 py-1 bg-gray-700 hover:bg-red-600/80 text-gray-300 hover:text-white text-xs rounded transition-colors"
            >
              <Unplug size={12} />
              Disconnect
            </button>
          )}
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="border-b border-gray-700 flex-shrink-0">
          <ConnectionSettings instanceName={instanceName} onSaved={() => setShowSettings(false)} initialToken={gatewayToken} />
        </div>
      )}

      {/* Sub-tabs (Agents / Channels / Models) — require connection */}
      {!showSettings && (
        <>
          {isConnected && (
            <div className="flex border-b border-gray-700 bg-gray-800/50 flex-shrink-0">
              {ALL_TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setSubTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 transition-colors ${
                    subTab === t.id
                      ? 'text-blue-400 border-blue-400'
                      : 'text-gray-400 hover:text-gray-200 border-transparent'
                  }`}
                >
                  {t.icon}{t.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-hidden">
            {!isConnected && !pairingInfo && (
              <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-3">
                {status === 'error' ? <XCircle size={32} className="text-red-500/40" /> : <WifiOff size={32} className="opacity-30" />}
                <div className="text-sm text-center">
                  {status === 'error' ? (
                    <><p className="text-red-400 text-xs mb-1">{connError}</p><p>Configure settings and try again</p></>
                  ) : (
                    <><p>Not connected to OpenClaw gateway</p><p className="text-xs mt-1">Configure the gateway URL and token, then click Connect</p></>
                  )}
                </div>
                <button
                  onClick={() => setShowSettings(true)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-lg transition-colors"
                >
                  <Settings2 size={12} />Configure
                </button>
              </div>
            )}
            {!isConnected && pairingInfo && (
              <PairingGuide
                info={pairingInfo}
                onRetry={() => void handleConnect()}
                onDismiss={() => { setPairingInfo(null); setConnError(null); setStatus('disconnected'); }}
              />
            )}
            {isConnected && subTab === 'agents' && <AgentsView instanceName={instanceName} />}
            {isConnected && subTab === 'channels' && <ChannelsView instanceName={instanceName} />}
            {isConnected && subTab === 'models' && <ModelsView instanceName={instanceName} />}
          </div>
        </>
      )}
    </div>
  );
}
