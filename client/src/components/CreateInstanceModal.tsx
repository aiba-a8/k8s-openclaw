import React, { useState, useRef, useEffect } from 'react';
import {
  X, Plus, Loader2, AlertCircle, Server, HardDrive,
  Check, Copy, CheckCircle2, XCircle, Container,
} from 'lucide-react';
import type { DeployType } from '../types';
import { authHeaders } from '../utils/auth';

interface Props {
  onClose: () => void;
  onCreate: (name: string, deployType: DeployType) => Promise<void>;
}

// ── Deploy type cards ─────────────────────────────────────────────────────────
const DEPLOY_TYPES: Array<{
  id: DeployType;
  label: string;
  desc: string;
  icon: React.ReactNode;
  available: boolean;
}> = [
  {
    id: 'local',
    label: 'Local',
    desc: 'Install & run OpenClaw directly on this machine via npm',
    icon: <HardDrive size={20} />,
    available: true,
  },
  {
    id: 'kubernetes',
    label: 'Kubernetes',
    desc: 'Deploy OpenClaw to a Kubernetes cluster using kubectl',
    icon: <Server size={20} />,
    available: true,
  },
  {
    id: 'docker',
    label: 'Docker',
    desc: 'Run OpenClaw in a Docker container',
    icon: <Container size={20} />,
    available: false,
  },
];

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors flex-shrink-0"
      title="Copy"
    >
      {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
    </button>
  );
}

// ── Kubernetes info ───────────────────────────────────────────────────────────
function K8sInfo() {
  return (
    <div className="text-xs text-gray-400 flex items-start gap-2 bg-gray-900/50 border border-gray-700 rounded-lg p-3">
      <Server size={13} className="text-blue-400 flex-shrink-0 mt-0.5" />
      <span>Creates a new instance with Kubernetes YAML templates (Deployment, Service, PVC, ConfigMap, Kustomization). Configure and deploy via the editor after creation.</span>
    </div>
  );
}

// ── Install log view ──────────────────────────────────────────────────────────
type InstallStatus = 'running' | 'success' | 'error';

function InstallProgress({
  instanceName,
  onDone,
}: {
  instanceName: string;
  onDone: (status: InstallStatus) => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<InstallStatus>('running');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();

    const run = async () => {
      try {
        const res = await fetch(`/api/instances/${instanceName}/local-install`, {
          method: 'POST',
          headers: authHeaders(),
          signal: ctrl.signal,
        });

        if (!res.ok || !res.body) {
          setLines(l => [...l, `Error: HTTP ${res.status}`]);
          setStatus('error');
          onDone('error');
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';
          for (const part of parts) {
            const line = part.startsWith('data: ') ? part.slice(6) : part;
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line) as { type: string; text: string };
              if (msg.type === 'log') {
                setLines(l => [...l, msg.text]);
              } else if (msg.type === 'done') {
                const s: InstallStatus = msg.text === 'success' ? 'success' : 'error';
                setStatus(s);
                onDone(s);
              }
            } catch { /* ignore */ }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setLines(l => [...l, `\nConnection error: ${String(err)}\n`]);
          setStatus('error');
          onDone('error');
        }
      }
    };

    void run();
    return () => ctrl.abort();
  }, [instanceName, onDone]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  return (
    <div className="flex flex-col gap-3">
      {/* Status bar */}
      <div className="flex items-center gap-2">
        {status === 'running' && <><Loader2 size={14} className="animate-spin text-blue-400" /><span className="text-xs text-blue-300">Installing openclaw…</span></>}
        {status === 'success' && <><CheckCircle2 size={14} className="text-green-400" /><span className="text-xs text-green-300">Installation completed</span></>}
        {status === 'error'   && <><XCircle size={14} className="text-red-400" /><span className="text-xs text-red-300">Installation failed</span></>}
      </div>

      {/* Log output */}
      <div className="bg-gray-950 border border-gray-700 rounded-lg overflow-y-auto font-mono text-xs text-gray-300" style={{ height: 320 }}>
        <div className="p-3 space-y-0 whitespace-pre-wrap">
          {lines.map((line, i) => (
            <span key={i} className={
              line.startsWith('✓') ? 'text-green-400' :
              line.startsWith('✗') ? 'text-red-400' :
              line.startsWith('▶') ? 'text-blue-300 font-semibold' :
              line.startsWith('Error') ? 'text-red-400' :
              'text-gray-300'
            }>{line}</span>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Manual next steps (shown after install) */}
      {status !== 'running' && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-400">Next steps (run manually in terminal):</p>
          {[
            'openclaw onboard --install-daemon',
            'openclaw gateway --port 18789 --verbose',
            'openclaw doctor',
          ].map(cmd => (
            <div key={cmd} className="flex items-center gap-2 bg-gray-900 border border-gray-700 rounded px-3 py-1.5">
              <code className="flex-1 text-xs text-green-300 font-mono">{cmd}</code>
              <CopyBtn text={cmd} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
type ModalPhase = 'form' | 'installing' | 'done';

export default function CreateInstanceModal({ onClose, onCreate }: Props) {
  const [name, setName] = useState('');
  const [deployType, setDeployType] = useState<DeployType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<ModalPhase>('form');
  const [createdName, setCreatedName] = useState('');
  const [installStatus, setInstallStatus] = useState<InstallStatus>('running');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const isValid = /^[a-z0-9-]+$/.test(name) && name.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || !deployType || loading) return;
    setLoading(true);
    setError(null);
    try {
      await onCreate(name, deployType);
      if (deployType === 'local') {
        setCreatedName(name);
        setPhase('installing');
      } else {
        onClose();
      }
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  };

  const handleInstallDone = (status: InstallStatus) => {
    setInstallStatus(status);
    setPhase('done');
  };

  // ── Install progress phase ────────────────────────────────────────────────
  if (phase === 'installing' || phase === 'done') {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-gray-800 rounded-lg shadow-2xl border border-gray-700 w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 flex-shrink-0">
            <div className="flex items-center gap-2">
              <HardDrive size={15} className="text-blue-400" />
              <h2 className="text-base font-semibold text-gray-100">
                Installing — <span className="text-blue-300">{createdName}</span>
              </h2>
            </div>
            {phase === 'done' && (
              <button onClick={onClose} className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200">
                <X size={16} />
              </button>
            )}
          </div>

          {/* Body */}
          <div className="px-5 py-4 overflow-y-auto flex-1">
            <InstallProgress instanceName={createdName} onDone={handleInstallDone} />
          </div>

          {/* Footer */}
          {phase === 'done' && (
            <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-700 flex-shrink-0">
              <button
                onClick={onClose}
                className={`flex items-center gap-2 px-4 py-2 text-sm rounded-md text-white transition-colors ${
                  installStatus === 'success' ? 'bg-green-600 hover:bg-green-500' : 'bg-blue-600 hover:bg-blue-500'
                }`}
              >
                {installStatus === 'success' ? <><CheckCircle2 size={14} />Open Instance</> : <>Close</>}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Form phase ────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-gray-800 rounded-lg shadow-2xl border border-gray-700 w-full max-w-lg mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-100">Create New Instance</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col overflow-hidden">
          <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Instance Name</label>
              <input
                ref={inputRef}
                type="text"
                value={name}
                onChange={e => { setName(e.target.value); setError(null); }}
                placeholder="e.g. openclaw-prod"
                className={`w-full px-3 py-2 bg-gray-700 border rounded text-sm text-gray-100 focus:outline-none transition-colors ${
                  name && !isValid ? 'border-red-500 focus:border-red-400' : 'border-gray-600 focus:border-blue-500'
                }`}
              />
              <p className={`mt-1 text-xs ${name && !isValid ? 'text-red-400' : 'text-gray-500'}`}>
                Lowercase letters, numbers, and dashes only
              </p>
            </div>

            {/* Deploy type cards */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2">Deploy Type</label>
              <div className="grid grid-cols-3 gap-2">
                {DEPLOY_TYPES.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={!t.available}
                    onClick={() => setDeployType(t.id)}
                    className={`relative flex flex-col items-center gap-2 p-3 rounded-lg border text-center transition-colors ${
                      !t.available
                        ? 'border-gray-700 bg-gray-800/50 text-gray-600 cursor-not-allowed'
                        : deployType === t.id
                        ? 'border-blue-500 bg-blue-600/10 text-blue-300'
                        : 'border-gray-600 bg-gray-700/50 text-gray-300 hover:border-gray-500 hover:bg-gray-700'
                    }`}
                  >
                    <span className={deployType === t.id ? 'text-blue-400' : ''}>{t.icon}</span>
                    <span className="text-xs font-medium">{t.label}</span>
                    <span className="text-[10px] text-gray-500 leading-tight">{t.desc}</span>
                    {!t.available && (
                      <span className="absolute top-1.5 right-1.5 text-[9px] bg-gray-700 text-gray-500 px-1 py-0.5 rounded">soon</span>
                    )}
                    {deployType === t.id && (
                      <span className="absolute top-1.5 right-1.5 text-blue-400"><Check size={12} /></span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Local info */}
            {deployType === 'local' && (
              <div className="text-xs text-gray-400 flex items-start gap-2 bg-gray-900/50 border border-gray-700 rounded-lg p-3">
                <HardDrive size={13} className="text-blue-400 flex-shrink-0 mt-0.5" />
                <span>After creating the instance, <strong className="text-gray-300">openclaw</strong> will be installed automatically via <code className="text-green-300">npm install -g openclaw@latest</code>. Installation logs will be shown in real-time.</span>
              </div>
            )}

            {/* Kubernetes info */}
            {deployType === 'kubernetes' && <K8sInfo />}

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-900/30 border border-red-700/50 rounded text-red-400 text-sm">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex gap-3 justify-end px-5 py-4 border-t border-gray-700 flex-shrink-0">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-300 hover:text-gray-100 hover:bg-gray-700 rounded-md transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isValid || !deployType || loading}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-blue-300 disabled:cursor-not-allowed text-white rounded-md transition-colors"
            >
              {loading ? <><Loader2 size={14} className="animate-spin" />Creating…</> : <><Plus size={14} />Create Instance</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
