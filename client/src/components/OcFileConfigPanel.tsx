import React, { useState, useEffect, useCallback } from 'react';
import {
  Loader2, AlertCircle, Save, RefreshCw, Server, HardDrive,
  ChevronDown, Plus, CheckCircle2, Bot, Link, Cpu, Radio,
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import { authHeaders } from '../utils/auth';
import ConfirmButton from './ConfirmButton';

interface Props { instanceName: string; deployType?: string }

type SourceType = 'kubernetes' | 'local';
type ViewMode = 'form' | 'raw';
type FormTab = 'agents' | 'bindings' | 'providers' | 'channels';

interface OcFileSource {
  type: SourceType;
  namespace?: string;
  pod?: string;
  container?: string;
  filePath?: string;
  localPath?: string;
}

interface Pod {
  name: string;
  namespace: string;
  status: string;
  ready: boolean;
  containers: string[];
}

// ── typed slices of openclaw.json ─────────────────────────────────────────────
interface AgentEntry { id: string; name?: string; workspace?: string; model?: string }
interface BindingEntry { agentId: string; match: { channel: string; accountId?: string }; comment?: string }
interface ModelEntry {
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
}
interface ProviderEntry {
  key: string;
  baseUrl?: string;
  apiKey?: string;
  models?: ModelEntry[];
}

function patchJson(raw: string, fn: (cfg: Record<string, unknown>) => void): string {
  const cfg = JSON.parse(raw) as Record<string, unknown>;
  fn(cfg);
  return JSON.stringify(cfg, null, 2);
}

// ── Source selector ───────────────────────────────────────────────────────────
function SourcePanel({
  instanceName, onLoad,
}: { instanceName: string; onLoad: (content: string, path: string) => void }) {
  const [src, setSrc] = useState<OcFileSource>({ type: 'local' });
  const [pods, setPods] = useState<Pod[]>([]);
  const [loadingPods, setLoadingPods] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [podsError, setPodsError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/instances/${instanceName}/oc-config/source`, { headers: authHeaders() })
      .then(r => r.json())
      .then((d: OcFileSource) => setSrc(d))
      .finally(() => setLoading(false));
  }, [instanceName]);

  const loadPods = async () => {
    setLoadingPods(true); setPodsError(null); setPods([]);
    try {
      const r = await fetch(`/api/instances/${instanceName}/oc-config/pods${src.namespace ? `?namespace=${encodeURIComponent(src.namespace)}` : ''}`, { headers: authHeaders() });
      const d = await r.json() as { pods?: Pod[]; error?: string };
      if (!r.ok) throw new Error(d.error ?? 'Failed');
      setPods(d.pods ?? []);
    } catch (e) { setPodsError(String(e)); }
    finally { setLoadingPods(false); }
  };

  const saveSource = async () => {
    setSaving(true); setError(null);
    try {
      const r = await fetch(`/api/instances/${instanceName}/oc-config/source`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(src),
      });
      if (!r.ok) throw new Error((await r.json() as { error: string }).error);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  };

  const fetchFile = async () => {
    setFetching(true); setError(null);
    await saveSource();
    try {
      const r = await fetch(`/api/instances/${instanceName}/oc-config/file`, { headers: authHeaders() });
      const d = await r.json() as { content?: string; path?: string; error?: string };
      if (!r.ok) throw new Error(d.error ?? 'Failed');
      onLoad(d.content ?? '{}', d.path ?? '');
    } catch (e) { setError(String(e)); }
    finally { setFetching(false); }
  };

  const selectedPod = pods.find(p => p.name === src.pod);

  if (loading) return <div className="flex items-center gap-2 p-4 text-gray-500 text-xs"><Loader2 size={14} className="animate-spin" />Loading...</div>;

  return (
    <div className="p-4 space-y-4 max-w-lg">
      <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Config File Source</h3>

      {/* Type selector */}
      <div className="flex gap-2">
        {(['kubernetes', 'local'] as SourceType[]).map(t => (
          <button
            key={t}
            onClick={() => setSrc(s => ({ ...s, type: t }))}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              src.type === t
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-500'
            }`}
          >
            {t === 'kubernetes' ? <Server size={13} /> : <HardDrive size={13} />}
            {t === 'kubernetes' ? 'Kubernetes' : 'Local'}
          </button>
        ))}
      </div>

      {src.type === 'kubernetes' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-gray-400 mb-1 block">Namespace (optional)</label>
              <input
                value={src.namespace ?? ''}
                onChange={e => setSrc(s => ({ ...s, namespace: e.target.value || undefined }))}
                placeholder="default"
                className="w-full bg-gray-900 border border-gray-600 rounded px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={() => void loadPods()}
                disabled={loadingPods}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
              >
                {loadingPods ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Load Pods
              </button>
            </div>
          </div>

          {podsError && <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle size={12} />{podsError}</p>}

          {pods.length > 0 && (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Pod</label>
              <div className="relative">
                <select
                  value={src.pod ?? ''}
                  onChange={e => {
                    const pod = pods.find(p => p.name === e.target.value);
                    setSrc(s => ({ ...s, pod: e.target.value, container: pod?.containers[0] }));
                  }}
                  className="w-full appearance-none bg-gray-900 border border-gray-600 rounded px-2.5 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-blue-500 pr-7"
                >
                  <option value="">Select pod...</option>
                  {pods.map(p => (
                    <option key={p.name} value={p.name}>
                      {p.name} ({p.status}{p.ready ? ' ✓' : ''})
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
              </div>
            </div>
          )}

          {selectedPod && selectedPod.containers.length > 1 && (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Container</label>
              <div className="relative">
                <select
                  value={src.container ?? selectedPod.containers[0]}
                  onChange={e => setSrc(s => ({ ...s, container: e.target.value }))}
                  className="w-full appearance-none bg-gray-900 border border-gray-600 rounded px-2.5 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-blue-500 pr-7"
                >
                  {selectedPod.containers.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-gray-400 mb-1 block">File Path in Container</label>
            <input
              value={src.filePath ?? ''}
              onChange={e => setSrc(s => ({ ...s, filePath: e.target.value || undefined }))}
              placeholder="/root/.openclaw/openclaw.json"
              className="w-full bg-gray-900 border border-gray-600 rounded px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
            />
          </div>
        </div>
      )}

      {src.type === 'local' && (
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Local File Path</label>
          <input
            value={src.localPath ?? ''}
            onChange={e => setSrc(s => ({ ...s, localPath: e.target.value }))}
            placeholder={`${typeof window !== 'undefined' ? '~' : '~'}/.openclaw/openclaw.json`}
            className="w-full bg-gray-900 border border-gray-600 rounded px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
          />
        </div>
      )}

      {error && <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle size={12} />{error}</p>}

      <button
        onClick={() => void fetchFile()}
        disabled={fetching || (src.type === 'kubernetes' && !src.pod)}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-blue-400 text-white text-xs rounded transition-colors"
      >
        {fetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        Load Config
      </button>
    </div>
  );
}

// ── Agents form ───────────────────────────────────────────────────────────────
function AgentsForm({ raw, onChange }: { raw: string; onChange: (r: string) => void }) {
  const cfg = JSON.parse(raw) as { agents?: { list?: AgentEntry[] } };
  const agents: AgentEntry[] = cfg.agents?.list ?? [];

  const update = (newAgents: AgentEntry[]) => {
    onChange(patchJson(raw, c => {
      if (!c.agents) c.agents = {};
      (c.agents as Record<string, unknown>).list = newAgents;
    }));
  };

  const set = (i: number, field: keyof AgentEntry, val: string) => {
    const next = agents.map((a, idx) => idx === i ? { ...a, [field]: val || undefined } : a);
    update(next);
  };

  return (
    <div className="space-y-2">
      {agents.length === 0 && <p className="text-xs text-gray-500 text-center py-4">No agents configured</p>}
      {agents.map((agent, i) => (
        <div key={i} className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-300 flex items-center gap-1.5"><Bot size={12} className="text-blue-400" />Agent {i + 1}</span>
            <ConfirmButton onConfirm={() => update(agents.filter((_, idx) => idx !== i))} label="Delete agent" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {([['id', 'ID *'], ['name', 'Name'], ['workspace', 'Workspace'], ['model', 'Model']] as [keyof AgentEntry, string][]).map(([f, label]) => (
              <div key={f}>
                <label className="text-[10px] text-gray-500 mb-0.5 block">{label}</label>
                <input
                  value={agent[f] ?? ''}
                  onChange={e => set(i, f, e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      <button
        onClick={() => update([...agents, { id: `agent-${agents.length + 1}` }])}
        className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-1"
      >
        <Plus size={12} />Add Agent
      </button>
    </div>
  );
}

// ── Bindings form ─────────────────────────────────────────────────────────────
function BindingsForm({ raw, onChange }: { raw: string; onChange: (r: string) => void }) {
  const cfg = JSON.parse(raw) as { bindings?: BindingEntry[]; agents?: { list?: AgentEntry[] } };
  const bindings: BindingEntry[] = cfg.bindings ?? [];
  const agentIds = cfg.agents?.list?.map(a => a.id) ?? [];
  const CHANNELS = [
    'discord', 'slack', 'telegram', 'whatsapp', 'signal', 'imessage',
    'msteams', 'googlechat', 'irc', 'matrix', 'mattermost', 'line',
    'feishu', 'bluebubbles', 'synology-chat', 'nextcloud-talk',
    'twitch', 'tlon', 'nostr', 'zalo', 'zalouser',
  ];

  const update = (next: BindingEntry[]) => onChange(patchJson(raw, c => { c.bindings = next; }));

  const set = (i: number, path: string, val: string) => {
    const next = bindings.map((b, idx) => {
      if (idx !== i) return b;
      if (path === 'agentId') return { ...b, agentId: val };
      if (path === 'channel') return { ...b, match: { ...b.match, channel: val } };
      if (path === 'accountId') return { ...b, match: { ...b.match, accountId: val || undefined } };
      if (path === 'comment') return { ...b, comment: val || undefined };
      return b;
    });
    update(next);
  };

  return (
    <div className="space-y-2">
      {bindings.length === 0 && <p className="text-xs text-gray-500 text-center py-4">No bindings configured</p>}
      {bindings.map((b, i) => (
        <div key={i} className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-300 flex items-center gap-1.5"><Link size={12} className="text-purple-400" />Binding {i + 1}</span>
            <ConfirmButton onConfirm={() => update(bindings.filter((_, idx) => idx !== i))} label="Delete binding" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-gray-500 mb-0.5 block">Agent</label>
              <div className="relative">
                <select
                  value={b.agentId}
                  onChange={e => set(i, 'agentId', e.target.value)}
                  className="w-full appearance-none bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-blue-500 pr-5"
                >
                  {agentIds.length === 0 && <option value={b.agentId}>{b.agentId}</option>}
                  {agentIds.map(id => <option key={id} value={id}>{id}</option>)}
                </select>
                <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 mb-0.5 block">Channel</label>
              <div className="relative">
                <select
                  value={b.match.channel}
                  onChange={e => set(i, 'channel', e.target.value)}
                  className="w-full appearance-none bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-blue-500 pr-5"
                >
                  {!CHANNELS.includes(b.match.channel) && <option value={b.match.channel}>{b.match.channel}</option>}
                  {CHANNELS.map(ch => <option key={ch} value={ch}>{ch}</option>)}
                </select>
                <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 mb-0.5 block">Account ID</label>
              <input
                value={b.match.accountId ?? ''}
                onChange={e => set(i, 'accountId', e.target.value)}
                placeholder="default"
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 mb-0.5 block">Comment</label>
              <input
                value={b.comment ?? ''}
                onChange={e => set(i, 'comment', e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>
      ))}
      <button
        onClick={() => update([...bindings, { agentId: agentIds[0] ?? '', match: { channel: 'discord' } }])}
        className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-1"
      >
        <Plus size={12} />Add Binding
      </button>
    </div>
  );
}

// ── Providers form ────────────────────────────────────────────────────────────
function ProvidersForm({ raw, onChange }: { raw: string; onChange: (r: string) => void }) {
  const [expandedProvider, setExpandedProvider] = useState<number | null>(null);

  type RawProvider = { baseUrl?: string; apiKey?: string; models?: ModelEntry[] };
  const cfg = JSON.parse(raw) as { models?: { providers?: Record<string, RawProvider> } };

  const providers: ProviderEntry[] = Object.entries(cfg.models?.providers ?? {}).map(([key, v]) => ({
    key,
    baseUrl: v.baseUrl ?? '',
    apiKey: typeof v.apiKey === 'string' ? v.apiKey : '',
    models: Array.isArray(v.models) ? v.models : [],
  }));

  const writeProviders = (next: ProviderEntry[]) => onChange(patchJson(raw, c => {
    if (!c.models) c.models = {};
    const m = c.models as Record<string, unknown>;
    const existing = (m.providers ?? {}) as Record<string, RawProvider>;
    const result: Record<string, unknown> = {};
    for (const p of next) {
      result[p.key] = {
        ...(existing[p.key] ?? {}),
        ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
        ...(p.apiKey ? { apiKey: p.apiKey } : {}),
        models: p.models ?? [],
      };
    }
    m.providers = result;
  }));

  const setProviderField = (i: number, field: 'key' | 'baseUrl' | 'apiKey', val: string) =>
    writeProviders(providers.map((p, idx) => idx === i ? { ...p, [field]: val } : p));

  const setModels = (i: number, models: ModelEntry[]) =>
    writeProviders(providers.map((p, idx) => idx === i ? { ...p, models } : p));

  const setModelField = (pi: number, mi: number, field: keyof ModelEntry, val: string | boolean | number) => {
    const models = (providers[pi].models ?? []).map((m, idx) =>
      idx === mi ? { ...m, [field]: val } : m
    );
    setModels(pi, models);
  };

  const INPUT = 'w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-blue-500 font-mono';

  return (
    <div className="space-y-2">
      {providers.length === 0 && <p className="text-xs text-gray-500 text-center py-4">No providers configured</p>}
      {providers.map((p, pi) => {
        const isOpen = expandedProvider === pi;
        const models = p.models ?? [];
        return (
          <div key={pi} className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
            {/* Provider header */}
            <div className="flex items-center gap-2 px-3 py-2">
              <Cpu size={12} className="text-cyan-400 flex-shrink-0" />
              <span className="text-xs font-semibold text-gray-200 flex-1">{p.key || `Provider ${pi + 1}`}</span>
              <span className="text-xs text-gray-500">{models.length} model{models.length !== 1 ? 's' : ''}</span>
              <button
                onClick={() => setExpandedProvider(isOpen ? null : pi)}
                className="text-gray-400 hover:text-gray-200 transition-colors ml-1"
              >
                <ChevronDown size={13} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              <ConfirmButton onConfirm={() => writeProviders(providers.filter((_, idx) => idx !== pi))} label="Delete provider" className="text-gray-600 hover:text-red-400" />
            </div>

            {isOpen && (
              <div className="border-t border-gray-700 p-3 space-y-3">
                {/* Provider fields */}
                <div className="grid grid-cols-1 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-500 mb-0.5 block">Provider Key</label>
                    <input value={p.key} onChange={e => setProviderField(pi, 'key', e.target.value)} className={INPUT} />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 mb-0.5 block">Base URL</label>
                    <input value={p.baseUrl ?? ''} onChange={e => setProviderField(pi, 'baseUrl', e.target.value)} className={INPUT} />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 mb-0.5 block">API Key</label>
                    <input type="password" value={p.apiKey ?? ''} onChange={e => setProviderField(pi, 'apiKey', e.target.value)}
                      placeholder="sk-..." className={INPUT} />
                  </div>
                </div>

                {/* Models */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Models</span>
                    <button
                      onClick={() => setModels(pi, [...models, { id: '', name: '', contextWindow: 128000, maxTokens: 8096, reasoning: false }])}
                      className="flex items-center gap-0.5 text-[10px] text-blue-400 hover:text-blue-300"
                    >
                      <Plus size={10} />Add Model
                    </button>
                  </div>

                  {models.length === 0 && (
                    <p className="text-[10px] text-gray-600 text-center py-2">No models — click Add Model</p>
                  )}

                  {models.map((m, mi) => (
                    <div key={mi} className="bg-gray-900 border border-gray-700 rounded p-2 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-400 font-mono">{m.id || `model ${mi + 1}`}</span>
                        <ConfirmButton onConfirm={() => setModels(pi, models.filter((_, idx) => idx !== mi))} label="Delete model" size={11} className="text-gray-600 hover:text-red-400" />
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <div>
                          <label className="text-[10px] text-gray-600 mb-0.5 block">ID *</label>
                          <input value={m.id} onChange={e => setModelField(pi, mi, 'id', e.target.value)}
                            placeholder="gpt-4o" className={INPUT} />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-600 mb-0.5 block">Name *</label>
                          <input value={m.name} onChange={e => setModelField(pi, mi, 'name', e.target.value)}
                            placeholder="GPT-4o" className={INPUT} />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-600 mb-0.5 block">Context Window</label>
                          <input type="number" value={m.contextWindow ?? ''} onChange={e => setModelField(pi, mi, 'contextWindow', Number(e.target.value))}
                            placeholder="128000" className={INPUT} />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-600 mb-0.5 block">Max Tokens</label>
                          <input type="number" value={m.maxTokens ?? ''} onChange={e => setModelField(pi, mi, 'maxTokens', Number(e.target.value))}
                            placeholder="8096" className={INPUT} />
                        </div>
                      </div>
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input type="checkbox" checked={m.reasoning ?? false}
                          onChange={e => setModelField(pi, mi, 'reasoning', e.target.checked)}
                          className="accent-purple-500" />
                        <span className="text-[10px] text-gray-400">Reasoning model</span>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
      <button
        onClick={() => { writeProviders([...providers, { key: 'anthropic', baseUrl: '', apiKey: '', models: [] }]); setExpandedProvider(providers.length); }}
        className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-1"
      >
        <Plus size={12} />Add Provider
      </button>
    </div>
  );
}

// ── Channel config field metadata ─────────────────────────────────────────────
const KNOWN_CHANNELS = [
  'discord', 'slack', 'telegram', 'whatsapp', 'signal', 'imessage',
  'msteams', 'googlechat', 'irc', 'matrix', 'mattermost', 'line',
  'feishu', 'bluebubbles', 'synology-chat', 'nextcloud-talk',
  'twitch', 'tlon', 'nostr', 'zalo', 'zalouser',
];

type FieldMeta =
  | { type: 'boolean'; label: string }
  | { type: 'password'; label: string }
  | { type: 'string'; label: string }
  | { type: 'select'; label: string; options: string[] }
  | { type: 'array'; label: string };

const POLICY_OPTIONS = ['open', 'allowlist', 'deny'];
const STREAMING_OPTIONS = ['none', 'partial', 'full'];

const CHANNEL_FIELD_META: Record<string, FieldMeta> = {
  enabled:      { type: 'boolean', label: 'Enabled' },
  dmPolicy:     { type: 'select',  label: 'DM Policy',    options: POLICY_OPTIONS },
  groupPolicy:  { type: 'select',  label: 'Group Policy', options: POLICY_OPTIONS },
  streaming:    { type: 'select',  label: 'Streaming',    options: STREAMING_OPTIONS },
  botToken:     { type: 'password', label: 'Bot Token' },
  apiKey:       { type: 'password', label: 'API Key' },
  token:        { type: 'password', label: 'Token' },
  secret:       { type: 'password', label: 'Secret' },
  clientSecret: { type: 'password', label: 'Client Secret' },
  webhookSecret:{ type: 'password', label: 'Webhook Secret' },
  allowFrom:    { type: 'array',   label: 'Allow From' },
  denyFrom:     { type: 'array',   label: 'Deny From' },
  allowGroups:  { type: 'array',   label: 'Allow Groups' },
};

// Input class shared across field editors
const INPUT_CLS = 'w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-blue-500 font-mono';

function ChannelFieldEditor({
  fieldKey, value, onChange,
}: {
  fieldKey: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [showPw, setShowPw] = useState(false);
  const [newItem, setNewItem] = useState('');

  const meta: FieldMeta = CHANNEL_FIELD_META[fieldKey] ?? (
    typeof value === 'boolean' ? { type: 'boolean', label: fieldKey } :
    Array.isArray(value)       ? { type: 'array',   label: fieldKey } :
                                 { type: 'string',  label: fieldKey }
  );
  const label = meta.label !== fieldKey ? meta.label : fieldKey;

  if (meta.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input type="checkbox" checked={Boolean(value)} onChange={e => onChange(e.target.checked)} className="accent-purple-500" />
        <span className="text-xs text-gray-300">{label}</span>
      </label>
    );
  }

  if (meta.type === 'select') {
    return (
      <div>
        <label className="text-[10px] text-gray-500 mb-0.5 block">{label}</label>
        <div className="relative">
          <select
            value={String(value ?? '')}
            onChange={e => onChange(e.target.value)}
            className="w-full appearance-none bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-blue-500 pr-5"
          >
            {meta.options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
        </div>
      </div>
    );
  }

  if (meta.type === 'password') {
    return (
      <div>
        <label className="text-[10px] text-gray-500 mb-0.5 block">{label}</label>
        <div className="relative">
          <input
            type={showPw ? 'text' : 'password'}
            value={String(value ?? '')}
            onChange={e => onChange(e.target.value)}
            className={`${INPUT_CLS} pr-12`}
          />
          <button
            type="button"
            onClick={() => setShowPw(p => !p)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 hover:text-gray-300"
          >{showPw ? 'hide' : 'show'}</button>
        </div>
      </div>
    );
  }

  if (meta.type === 'array') {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    const addItem = () => {
      const v = newItem.trim();
      if (!v) return;
      onChange([...arr, v]);
      setNewItem('');
    };
    return (
      <div>
        <label className="text-[10px] text-gray-500 mb-1 block">{label}</label>
        <div className="space-y-1">
          {arr.map((item, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                value={item}
                onChange={e => { const next = [...arr]; next[i] = e.target.value; onChange(next); }}
                className={`${INPUT_CLS} flex-1`}
              />
              <button onClick={() => onChange(arr.filter((_, idx) => idx !== i))} className="text-gray-600 hover:text-red-400 flex-shrink-0">
                <Plus size={11} className="rotate-45" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <input
              value={newItem}
              onChange={e => setNewItem(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addItem()}
              placeholder="add item…"
              className={`${INPUT_CLS} flex-1 placeholder-gray-600`}
            />
            <button onClick={addItem} className="text-blue-400 hover:text-blue-300 flex-shrink-0"><Plus size={11} /></button>
          </div>
        </div>
      </div>
    );
  }

  // string / fallback
  return (
    <div>
      <label className="text-[10px] text-gray-500 mb-0.5 block">{label}</label>
      <input value={String(value ?? '')} onChange={e => onChange(e.target.value)} className={INPUT_CLS} />
    </div>
  );
}

// ── Per-channel card ───────────────────────────────────────────────────────────
function ChannelCard({
  channelKey, value, onUpdate, onRename, onDelete,
}: {
  channelKey: string;
  value: Record<string, unknown>;
  onUpdate: (v: Record<string, unknown>) => void;
  onRename: (oldKey: string, newKey: string) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [renameVal, setRenameVal] = useState<string | null>(null);
  const [newFieldKey, setNewFieldKey] = useState('');

  const setField = (k: string, v: unknown) => onUpdate({ ...value, [k]: v });
  const removeField = (k: string) => { const n = { ...value }; delete n[k]; onUpdate(n); };

  const commitRename = () => {
    const nk = (renameVal ?? '').trim();
    if (nk && nk !== channelKey) onRename(channelKey, nk);
    setRenameVal(null);
  };

  const addField = () => {
    const k = newFieldKey.trim();
    if (!k || k in value) return;
    onUpdate({ ...value, [k]: '' });
    setNewFieldKey('');
  };

  const fieldKeys = Object.keys(value);
  // Booleans first, then rest
  const boolKeys = fieldKeys.filter(k => typeof value[k] === 'boolean');
  const otherKeys = fieldKeys.filter(k => typeof value[k] !== 'boolean');

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <Radio size={12} className="text-purple-400 flex-shrink-0" />
        {renameVal !== null ? (
          <input
            autoFocus
            value={renameVal}
            onChange={e => setRenameVal(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenameVal(null); }}
            className="flex-1 bg-gray-900 border border-blue-500 rounded px-2 py-0.5 text-xs text-gray-100 font-mono focus:outline-none"
          />
        ) : (
          <button
            onClick={() => setRenameVal(channelKey)}
            className="flex-1 text-left text-xs text-gray-200 font-mono capitalize hover:text-blue-300"
            title="Click to rename"
          >
            {channelKey}
          </button>
        )}
        <span className="text-[10px] text-gray-600">{fieldKeys.length} field{fieldKeys.length !== 1 ? 's' : ''}</span>
        <button onClick={() => setOpen(o => !o)} className="text-gray-400 hover:text-gray-200">
          <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <ConfirmButton onConfirm={onDelete} label={`Delete ${channelKey} channel`} />
      </div>

      {open && (
        <div className="border-t border-gray-700 p-3 space-y-3">
          {/* Boolean fields inline row */}
          {boolKeys.length > 0 && (
            <div className="flex flex-wrap gap-4">
              {boolKeys.map(k => (
                <div key={k} className="flex items-center gap-1">
                  <ChannelFieldEditor fieldKey={k} value={value[k]} onChange={v => setField(k, v)} />
                  <button onClick={() => removeField(k)} className="text-gray-700 hover:text-red-400 ml-1"><Plus size={10} className="rotate-45" /></button>
                </div>
              ))}
            </div>
          )}

          {/* Other fields grid */}
          <div className="grid grid-cols-2 gap-2">
            {otherKeys.map(k => (
              <div key={k} className="flex items-start gap-1">
                <div className="flex-1 min-w-0">
                  <ChannelFieldEditor fieldKey={k} value={value[k]} onChange={v => setField(k, v)} />
                </div>
                <button onClick={() => removeField(k)} className="text-gray-700 hover:text-red-400 mt-4 flex-shrink-0"><Plus size={10} className="rotate-45" /></button>
              </div>
            ))}
          </div>

          {/* Add field */}
          <div className="flex items-center gap-1 border-t border-gray-700 pt-2">
            <input
              value={newFieldKey}
              onChange={e => setNewFieldKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addField()}
              placeholder="add field…"
              className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
            />
            <button onClick={addField} disabled={!newFieldKey.trim()} className="flex items-center gap-0.5 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40 whitespace-nowrap">
              <Plus size={11} />Add field
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Channels form ─────────────────────────────────────────────────────────────
function ChannelsForm({ raw, onChange }: { raw: string; onChange: (r: string) => void }) {
  const [newName, setNewName] = useState('');
  const [customNew, setCustomNew] = useState(false);

  const cfg = JSON.parse(raw) as { channels?: Record<string, unknown> };
  const channels = cfg.channels ?? {};
  const keys = Object.keys(channels);

  const writeChannels = (next: Record<string, unknown>) =>
    onChange(patchJson(raw, c => { c.channels = next; }));

  const addChannel = () => {
    const name = newName.trim();
    if (!name || keys.includes(name)) return;
    writeChannels({ ...channels, [name]: { enabled: true } });
    setNewName('');
    setCustomNew(false);
  };

  const deleteChannel = (key: string) => {
    const next = { ...channels };
    delete next[key];
    writeChannels(next);
  };

  const updateChannel = (key: string, val: Record<string, unknown>) =>
    writeChannels({ ...channels, [key]: val });

  const renameChannel = (oldKey: string, newKey: string) => {
    if (!newKey || newKey === oldKey || keys.includes(newKey)) return;
    const next: Record<string, unknown> = {};
    for (const k of keys) next[k === oldKey ? newKey : k] = channels[k];
    writeChannels(next);
  };

  const unusedKnown = KNOWN_CHANNELS.filter(c => !keys.includes(c));

  return (
    <div className="space-y-2">
      {keys.length === 0 && <p className="text-xs text-gray-500 text-center py-4">No channels configured</p>}

      {keys.map(key => (
        <ChannelCard
          key={key}
          channelKey={key}
          value={(channels[key] as Record<string, unknown>) ?? {}}
          onUpdate={val => updateChannel(key, val)}
          onRename={renameChannel}
          onDelete={() => deleteChannel(key)}
        />
      ))}

      {/* Add channel */}
      <div className="flex items-center gap-2 mt-2">
        {!customNew && unusedKnown.length > 0 ? (
          <>
            <div className="relative flex-1">
              <select
                value={newName}
                onChange={e => setNewName(e.target.value)}
                className="w-full appearance-none bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-blue-500 pr-5"
              >
                <option value="">Select channel…</option>
                {unusedKnown.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            </div>
            <button onClick={() => setCustomNew(true)} className="text-[10px] text-gray-500 hover:text-gray-300 whitespace-nowrap">custom</button>
          </>
        ) : (
          <input
            autoFocus={customNew}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addChannel()}
            placeholder="channel name"
            className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
          />
        )}
        <button
          onClick={addChannel}
          disabled={!newName.trim() || keys.includes(newName.trim())}
          className="flex items-center gap-0.5 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        >
          <Plus size={12} />Add
        </button>
      </div>
    </div>
  );
}

// ── Main Config Panel ─────────────────────────────────────────────────────────
export default function OcFileConfigPanel({ instanceName, deployType }: Props) {
  const isLocalDeploy = deployType === 'local';
  const [raw, setRaw] = useState<string | null>(null);
  const [filePath, setFilePath] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('form');
  const [formTab, setFormTab] = useState<FormTab>('agents');
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);

  const handleLoad = useCallback((content: string, path: string) => {
    setRaw(content);
    setFilePath(path);
    setShowSource(false);
    setSaveError(null);
    setParseError(null);
    try { JSON.parse(content); setParseError(null); } catch (e) { setParseError(String(e)); }
  }, []);

  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const loadLocalFile = useCallback(async () => {
    const localPath = '~/.openclaw/openclaw.json';
    setLocalLoading(true);
    setLocalError(null);
    try {
      await fetch(`/api/instances/${instanceName}/oc-config/source`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ type: 'local', localPath }),
      });
      const r = await fetch(`/api/instances/${instanceName}/oc-config/file`, { headers: authHeaders() });
      const d = await r.json() as { content?: string; path?: string; error?: string };
      if (!r.ok) throw new Error(d.error ?? 'Failed to load');
      if (d.content) handleLoad(d.content, d.path ?? localPath);
    } catch (e) {
      setLocalError(String(e));
    } finally {
      setLocalLoading(false);
    }
  }, [instanceName, handleLoad]);

  // Auto-load on mount for local deploy
  useEffect(() => {
    if (isLocalDeploy) void loadLocalFile();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceName, isLocalDeploy]);

  const handleRawChange = (val: string) => {
    setRaw(val);
    setSaveOk(false);
    setSaveError(null);
    try { JSON.parse(val); setParseError(null); } catch (e) { setParseError(String(e)); }
  };

  const handleSave = async () => {
    if (!raw) return;
    setSaving(true); setSaveError(null); setSaveOk(false);
    try {
      const r = await fetch(`/api/instances/${instanceName}/oc-config/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ content: raw }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (!d.ok) throw new Error(d.error ?? 'Save failed');
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2000);
    } catch (e) { setSaveError(String(e)); }
    finally { setSaving(false); }
  };

  const FORM_TABS: { id: FormTab; label: string; icon: React.ReactNode }[] = [
    { id: 'agents', label: 'Agents', icon: <Bot size={12} /> },
    { id: 'bindings', label: 'Bindings', icon: <Link size={12} /> },
    { id: 'providers', label: 'Providers', icon: <Cpu size={12} /> },
    { id: 'channels', label: 'Channels', icon: <Radio size={12} /> },
  ];

  // Local deploy: loading/error state instead of SourcePanel
  if (isLocalDeploy && !raw) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-sm text-gray-500">
        {localLoading ? (
          <><Loader2 size={20} className="animate-spin text-blue-400" /><span className="text-xs">Loading ~/.openclaw/openclaw.json…</span></>
        ) : localError ? (
          <>
            <AlertCircle size={20} className="text-red-400" />
            <span className="text-xs text-red-400 text-center max-w-xs">{localError}</span>
            <button
              onClick={() => void loadLocalFile()}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-lg"
            >
              <RefreshCw size={12} />Retry
            </button>
          </>
        ) : null}
      </div>
    );
  }

  // Kubernetes (or no file loaded yet): show SourcePanel
  if (!raw || showSource) {
    return (
      <div className="flex flex-col h-full overflow-y-auto">
        <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700 flex-shrink-0">
          <span className="text-xs font-medium text-gray-300">Config File Source</span>
          {raw && (
            <button onClick={() => setShowSource(false)} className="text-xs text-gray-400 hover:text-gray-200">← Back</button>
          )}
        </div>
        <SourcePanel instanceName={instanceName} onLoad={handleLoad} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        {isLocalDeploy ? (
          <span className="text-xs text-gray-500 font-mono truncate max-w-xs flex items-center gap-1">
            <HardDrive size={11} className="text-blue-400" />{filePath || '~/.openclaw/openclaw.json'}
          </span>
        ) : (
          <button onClick={() => setShowSource(true)} className="text-xs text-gray-400 hover:text-gray-200 font-mono truncate max-w-xs" title={filePath}>
            {filePath || 'openclaw.json'}
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center bg-gray-700 rounded p-0.5">
            {(['form', 'raw'] as ViewMode[]).map(m => (
              <button key={m} onClick={() => setViewMode(m)}
                className={`px-2.5 py-0.5 text-xs rounded transition-colors ${viewMode === m ? 'bg-gray-900 text-gray-100' : 'text-gray-400 hover:text-gray-200'}`}
              >{m === 'form' ? 'Form' : 'Raw'}</button>
            ))}
          </div>
          {parseError && <span className="text-xs text-red-400 flex items-center gap-1"><AlertCircle size={11} />Invalid JSON</span>}
          {saveError && <span className="text-xs text-red-400 truncate max-w-xs" title={saveError}>{saveError}</span>}
          {saveOk && <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle2 size={11} />Saved</span>}
          <button
            onClick={() => void handleSave()}
            disabled={saving || !!parseError}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors ${
              parseError ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
            Save
          </button>
        </div>
      </div>

      {viewMode === 'raw' ? (
        <div className="flex-1 overflow-hidden">
          <Editor
            height="100%"
            language="json"
            theme="vs-dark"
            value={raw}
            onChange={v => handleRawChange(v ?? '')}
            options={{ minimap: { enabled: false }, fontSize: 12, tabSize: 2, scrollBeyondLastLine: false, automaticLayout: true }}
          />
        </div>
      ) : (
        <>
          {/* Form sub-tabs */}
          <div className="flex border-b border-gray-700 bg-gray-800/50 flex-shrink-0">
            {FORM_TABS.map(t => (
              <button key={t.id} onClick={() => setFormTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 transition-colors ${
                  formTab === t.id ? 'text-blue-400 border-blue-400' : 'text-gray-400 hover:text-gray-200 border-transparent'
                }`}
              >
                {t.icon}{t.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {parseError ? (
              <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-700/50 rounded-lg text-xs text-red-400">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <div><p className="font-semibold">JSON parse error</p><p className="mt-1 font-mono">{parseError}</p><p className="mt-1">Switch to Raw mode to fix.</p></div>
              </div>
            ) : (
              <>
                {formTab === 'agents' && <AgentsForm raw={raw} onChange={setRaw} />}
                {formTab === 'bindings' && <BindingsForm raw={raw} onChange={setRaw} />}
                {formTab === 'providers' && <ProvidersForm raw={raw} onChange={setRaw} />}
                {formTab === 'channels' && <ChannelsForm raw={raw} onChange={setRaw} />}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
