import React, { useState, useRef, useEffect } from 'react';
import {
  X, Plus, Loader2, AlertCircle, Server, HardDrive,
  Check, Copy, CheckCircle2, XCircle, Container, RefreshCw, Eye, EyeOff,
  FolderPlus, Rocket, Globe,
} from 'lucide-react';
import type { DeployType } from '../types';
import { authHeaders } from '../utils/auth';

interface SshCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
}

interface Props {
  onClose: () => void;
  onCreate: (name: string, deployType: DeployType, gatewayToken?: string, registerOnly?: boolean, sshCredentials?: SshCredentials, gatewayUrl?: string) => Promise<void>;
}

type ModalTab = 'deploy' | 'register';

function generateToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
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
    id: 'ssh',
    label: 'Remote SSH',
    desc: 'Install & run OpenClaw on a remote server via SSH',
    icon: <Globe size={20} />,
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

// ── Deploy type selector (shared between both tabs) ───────────────────────────
function DeployTypeSelector({ value, onChange }: { value: DeployType | null; onChange: (t: DeployType) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-2">Deploy Type</label>
      <div className="grid grid-cols-2 gap-2">
        {DEPLOY_TYPES.map(t => (
          <button
            key={t.id}
            type="button"
            disabled={!t.available}
            onClick={() => onChange(t.id)}
            className={`relative flex flex-col items-center gap-2 p-3 rounded-lg border text-center transition-colors ${
              !t.available
                ? 'border-gray-700 bg-gray-800/50 text-gray-600 cursor-not-allowed'
                : value === t.id
                ? 'border-blue-500 bg-blue-600/10 text-blue-300'
                : 'border-gray-600 bg-gray-700/50 text-gray-300 hover:border-gray-500 hover:bg-gray-700'
            }`}
          >
            <span className={value === t.id ? 'text-blue-400' : ''}>{t.icon}</span>
            <span className="text-xs font-medium">{t.label}</span>
            <span className="text-[10px] text-gray-500 leading-tight">{t.desc}</span>
            {!t.available && (
              <span className="absolute top-1.5 right-1.5 text-[9px] bg-gray-700 text-gray-500 px-1 py-0.5 rounded">soon</span>
            )}
            {value === t.id && (
              <span className="absolute top-1.5 right-1.5 text-blue-400"><Check size={12} /></span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Name input (shared) ───────────────────────────────────────────────────────
function NameInput({ value, onChange, inputRef }: {
  value: string;
  onChange: (v: string) => void;
  inputRef?: React.RefObject<HTMLInputElement>;
}) {
  const isValid = /^[a-z0-9-]+$/.test(value) && value.length > 0;
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1.5">Instance Name</label>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="e.g. openclaw-prod"
        className={`w-full px-3 py-2 bg-gray-700 border rounded text-sm text-gray-100 focus:outline-none transition-colors ${
          value && !isValid ? 'border-red-500 focus:border-red-400' : 'border-gray-600 focus:border-blue-500'
        }`}
      />
      <p className={`mt-1 text-xs ${value && !isValid ? 'text-red-400' : 'text-gray-500'}`}>
        Lowercase letters, numbers, and dashes only
      </p>
    </div>
  );
}

// ── Install log view ──────────────────────────────────────────────────────────
type InstallStatus = 'running' | 'success' | 'error';

function InstallProgress({
  instanceName,
  installPath = 'local-install',
  onDone,
}: {
  instanceName: string;
  installPath?: string;
  onDone: (status: InstallStatus) => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<InstallStatus>('running');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const run = async () => {
      try {
        const res = await fetch(`/api/instances/${instanceName}/${installPath}`, {
          method: 'POST', headers: authHeaders(), signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          setLines(l => [...l, `Error: HTTP ${res.status}`]);
          setStatus('error'); onDone('error'); return;
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
              if (msg.type === 'log') setLines(l => [...l, msg.text]);
              else if (msg.type === 'done') {
                const s: InstallStatus = msg.text === 'success' ? 'success' : 'error';
                setStatus(s); onDone(s);
              }
            } catch { /* ignore */ }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setLines(l => [...l, `\nConnection error: ${String(err)}\n`]);
          setStatus('error'); onDone('error');
        }
      }
    };
    void run();
    return () => ctrl.abort();
  }, [instanceName, onDone]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {status === 'running' && <><Loader2 size={14} className="animate-spin text-blue-400" /><span className="text-xs text-blue-300">Installing openclaw…</span></>}
        {status === 'success' && <><CheckCircle2 size={14} className="text-green-400" /><span className="text-xs text-green-300">Installation completed</span></>}
        {status === 'error'   && <><XCircle size={14} className="text-red-400" /><span className="text-xs text-red-300">Installation failed</span></>}
      </div>
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
      {status !== 'running' && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-400">Next steps (run manually in terminal):</p>
          {['openclaw onboard --install-daemon', 'openclaw gateway --port 18789 --verbose', 'openclaw doctor'].map(cmd => (
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
  const [modalTab, setModalTab] = useState<ModalTab>('deploy');

  // ── Tab 1: Deploy state ───────────────────────────────────────────────────
  const [deployName, setDeployName] = useState('');
  const [deployType, setDeployType] = useState<DeployType | null>(null);
  const [deployToken, setDeployToken] = useState(() => generateToken());
  const [showDeployToken, setShowDeployToken] = useState(false);
  const [deployLoading, setDeployLoading] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [phase, setPhase] = useState<ModalPhase>('form');
  const [createdName, setCreatedName] = useState('');
  const [installStatus, setInstallStatus] = useState<InstallStatus>('running');

  // ── Gateway URL state ─────────────────────────────────────────────────────
  const [deployGatewayUrl, setDeployGatewayUrl] = useState('');
  const [regGatewayUrl, setRegGatewayUrl] = useState('');

  // ── SSH state ─────────────────────────────────────────────────────────────
  const [sshHost, setSshHost] = useState('');
  const [sshPort, setSshPort] = useState('22');
  const [sshUsername, setSshUsername] = useState('');
  const [sshPassword, setSshPassword] = useState('');
  const [showSshPassword, setShowSshPassword] = useState(false);

  // Auto-derive gateway URL from SSH host
  useEffect(() => {
    if (deployType === 'ssh' && sshHost.trim()) {
      setDeployGatewayUrl(`ws://${sshHost.trim()}:18789`);
    }
  }, [sshHost, deployType]);

  // Reset gateway URL when deploy type changes
  useEffect(() => {
    if (deployType === 'local' || deployType === 'kubernetes') {
      setDeployGatewayUrl('ws://localhost:18789');
    } else if (deployType === 'ssh') {
      setDeployGatewayUrl(sshHost.trim() ? `ws://${sshHost.trim()}:18789` : '');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployType]);

  // ── Tab 2: Register state ─────────────────────────────────────────────────
  const [regName, setRegName] = useState('');
  const [regType, setRegType] = useState<DeployType | null>(null);
  const [regToken, setRegToken] = useState('');
  const [showRegToken, setShowRegToken] = useState(false);
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  // ── Register SSH state ────────────────────────────────────────────────────
  const [regSshHost, setRegSshHost] = useState('');
  const [regSshPort, setRegSshPort] = useState('22');
  const [regSshUsername, setRegSshUsername] = useState('');
  const [regSshPassword, setRegSshPassword] = useState('');
  const [showRegSshPassword, setShowRegSshPassword] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, [modalTab]);

  const deployNameValid = /^[a-z0-9-]+$/.test(deployName) && deployName.length > 0;
  const regNameValid = /^[a-z0-9-]+$/.test(regName) && regName.length > 0;

  // ── Tab 1 submit ──────────────────────────────────────────────────────────
  const handleDeploySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deployNameValid || !deployType || deployLoading) return;
    if (deployType === 'ssh' && (!sshHost.trim() || !sshUsername.trim() || !sshPassword)) return;
    setDeployLoading(true);
    setDeployError(null);
    try {
      const sshCreds = deployType === 'ssh'
        ? { host: sshHost.trim(), port: parseInt(sshPort) || 22, username: sshUsername.trim(), password: sshPassword }
        : undefined;
      await onCreate(deployName, deployType, deployType === 'kubernetes' ? deployToken : undefined, undefined, sshCreds, deployGatewayUrl.trim() || undefined);
      if (deployType === 'local' || deployType === 'ssh') {
        setCreatedName(deployName);
        setPhase('installing');
      } else {
        onClose();
      }
    } catch (err) {
      setDeployError(String(err));
      setDeployLoading(false);
    }
  };

  // ── Tab 2 submit ──────────────────────────────────────────────────────────
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regNameValid || !regType || regLoading) return;
    if (regType === 'ssh' && (!regSshHost.trim() || !regSshUsername.trim() || !regSshPassword)) return;
    setRegLoading(true);
    setRegError(null);
    try {
      const sshCreds = regType === 'ssh'
        ? { host: regSshHost.trim(), port: parseInt(regSshPort) || 22, username: regSshUsername.trim(), password: regSshPassword }
        : undefined;
      await onCreate(regName, regType, regToken.trim() || undefined, true, sshCreds, regGatewayUrl.trim() || undefined);
      onClose();
    } catch (err) {
      setRegError(String(err));
      setRegLoading(false);
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
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 flex-shrink-0">
            <div className="flex items-center gap-2">
              {deployType === 'ssh'
                ? <Globe size={15} className="text-purple-400" />
                : <HardDrive size={15} className="text-blue-400" />}
              <h2 className="text-base font-semibold text-gray-100">
                {deployType === 'ssh' ? 'Remote Install' : 'Installing'} — <span className={deployType === 'ssh' ? 'text-purple-300' : 'text-blue-300'}>{createdName}</span>
              </h2>
            </div>
            {phase === 'done' && (
              <button onClick={onClose} className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200">
                <X size={16} />
              </button>
            )}
          </div>
          <div className="px-5 py-4 overflow-y-auto flex-1">
            <InstallProgress instanceName={createdName} installPath={deployType === 'ssh' ? 'ssh-install' : 'local-install'} onDone={handleInstallDone} />
          </div>
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
          <h2 className="text-base font-semibold text-gray-100">New Instance</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200">
            <X size={16} />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-gray-700 flex-shrink-0">
          <button
            onClick={() => setModalTab('deploy')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              modalTab === 'deploy'
                ? 'text-blue-400 border-blue-400'
                : 'text-gray-400 hover:text-gray-200 border-transparent'
            }`}
          >
            <Rocket size={13} />Deploy New
          </button>
          <button
            onClick={() => setModalTab('register')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              modalTab === 'register'
                ? 'text-blue-400 border-blue-400'
                : 'text-gray-400 hover:text-gray-200 border-transparent'
            }`}
          >
            <FolderPlus size={13} />Register Only
          </button>
        </div>

        {/* ── Tab 1: Deploy New ─────────────────────────────────────────── */}
        {modalTab === 'deploy' && (
          <form onSubmit={(e) => void handleDeploySubmit(e)} className="flex flex-col overflow-hidden">
            <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
              <NameInput value={deployName} onChange={v => { setDeployName(v); setDeployError(null); }} inputRef={inputRef} />

              <DeployTypeSelector value={deployType} onChange={t => { setDeployType(t); setDeployError(null); }} />

              {deployType === 'local' && (
                <div className="text-xs text-gray-400 flex items-start gap-2 bg-gray-900/50 border border-gray-700 rounded-lg p-3">
                  <HardDrive size={13} className="text-blue-400 flex-shrink-0 mt-0.5" />
                  <span>After creating the instance, <strong className="text-gray-300">openclaw</strong> will be installed automatically via <code className="text-green-300">npm install -g openclaw@latest</code>. Installation logs will be shown in real-time.</span>
                </div>
              )}

              {deployType === 'ssh' && (
                <>
                  <div className="text-xs text-gray-400 flex items-start gap-2 bg-gray-900/50 border border-gray-700 rounded-lg p-3">
                    <Globe size={13} className="text-purple-400 flex-shrink-0 mt-0.5" />
                    <span>Connects to a remote server via SSH and installs <strong className="text-gray-300">openclaw</strong> using <code className="text-green-300">npm install -g openclaw@latest</code>. Installation logs will be streamed in real-time.</span>
                  </div>
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Host</label>
                        <input
                          type="text"
                          value={sshHost}
                          onChange={e => { setSshHost(e.target.value); setDeployError(null); }}
                          placeholder="192.168.1.100"
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Port</label>
                        <input
                          type="number"
                          value={sshPort}
                          onChange={e => setSshPort(e.target.value)}
                          placeholder="22"
                          min="1"
                          max="65535"
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500 transition-colors"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Username</label>
                      <input
                        type="text"
                        value={sshUsername}
                        onChange={e => { setSshUsername(e.target.value); setDeployError(null); }}
                        placeholder="root"
                        autoComplete="username"
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Password</label>
                      <div className="relative">
                        <input
                          type={showSshPassword ? 'text' : 'password'}
                          value={sshPassword}
                          onChange={e => { setSshPassword(e.target.value); setDeployError(null); }}
                          placeholder="Enter SSH password"
                          autoComplete="current-password"
                          className="w-full px-3 py-2 pr-8 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500 transition-colors"
                        />
                        <button type="button" onClick={() => setShowSshPassword(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200">
                          {showSshPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {deployType === 'kubernetes' && (
                <>
                  <div className="text-xs text-gray-400 flex items-start gap-2 bg-gray-900/50 border border-gray-700 rounded-lg p-3">
                    <Server size={13} className="text-blue-400 flex-shrink-0 mt-0.5" />
                    <span>Creates a new instance with Kubernetes YAML templates (Deployment, Service, PVC, ConfigMap, Kustomization). Configure and deploy via the editor after creation.</span>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">Gateway Token</label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          type={showDeployToken ? 'text' : 'password'}
                          value={deployToken}
                          onChange={e => setDeployToken(e.target.value)}
                          className="w-full px-3 py-2 pr-8 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 font-mono focus:outline-none focus:border-blue-500 transition-colors"
                          placeholder="64-char hex token"
                        />
                        <button type="button" onClick={() => setShowDeployToken(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200">
                          {showDeployToken ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                      </div>
                      <button type="button" onClick={() => setDeployToken(generateToken())} className="flex items-center gap-1 px-2 py-2 text-xs text-gray-400 hover:text-gray-200 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded transition-colors flex-shrink-0" title="Auto-generate">
                        <RefreshCw size={12} />
                      </button>
                      <CopyBtn text={deployToken} />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">Will be stored in Kubernetes Secret <code className="text-green-300">openclaw-secrets</code></p>
                  </div>
                </>
              )}

              {deployType && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Gateway URL <span className="text-gray-600 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={deployGatewayUrl}
                    onChange={e => setDeployGatewayUrl(e.target.value)}
                    placeholder="ws://host:18789"
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 font-mono focus:outline-none focus:border-blue-500 transition-colors"
                  />
                  <p className="mt-1 text-xs text-gray-500">WebSocket address for connecting to the OpenClaw gateway</p>
                </div>
              )}

              {deployError && (
                <div className="flex items-start gap-2 p-3 bg-red-900/30 border border-red-700/50 rounded text-red-400 text-sm">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" /><span>{deployError}</span>
                </div>
              )}
            </div>
            <div className="flex gap-3 justify-end px-5 py-4 border-t border-gray-700 flex-shrink-0">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-300 hover:text-gray-100 hover:bg-gray-700 rounded-md transition-colors">Cancel</button>
              <button
                type="submit"
                disabled={!deployNameValid || !deployType || deployLoading || (deployType === 'ssh' && (!sshHost.trim() || !sshUsername.trim() || !sshPassword))}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-blue-300 disabled:cursor-not-allowed text-white rounded-md transition-colors"
              >
                {deployLoading ? <><Loader2 size={14} className="animate-spin" />Creating…</> : <><Plus size={14} />Create</>}
              </button>
            </div>
          </form>
        )}

        {/* ── Tab 2: Register Only ──────────────────────────────────────── */}
        {modalTab === 'register' && (
          <form onSubmit={(e) => void handleRegisterSubmit(e)} className="flex flex-col overflow-hidden">
            <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
              <div className="text-xs text-gray-400 flex items-start gap-2 bg-gray-900/50 border border-gray-700 rounded-lg p-3">
                <FolderPlus size={13} className="text-purple-400 flex-shrink-0 mt-0.5" />
                <span>Creates only the instance folder and metadata. No deployment or installation is performed. Use this to register an existing OpenClaw instance.</span>
              </div>

              <NameInput value={regName} onChange={v => { setRegName(v); setRegError(null); }} inputRef={inputRef} />

              <DeployTypeSelector value={regType} onChange={t => { setRegType(t); setRegError(null); }} />

              {regType === 'ssh' && (
                <div className="space-y-3">
                  <div className="text-xs text-gray-400 flex items-start gap-2 bg-gray-900/50 border border-gray-700 rounded-lg p-3">
                    <Globe size={13} className="text-purple-400 flex-shrink-0 mt-0.5" />
                    <span>SSH credentials are used to load and save the remote <code className="text-green-300">openclaw.json</code> config file in the Config tab.</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Host</label>
                      <input
                        type="text"
                        value={regSshHost}
                        onChange={e => { setRegSshHost(e.target.value); setRegError(null); }}
                        placeholder="192.168.1.100"
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Port</label>
                      <input
                        type="number"
                        value={regSshPort}
                        onChange={e => setRegSshPort(e.target.value)}
                        placeholder="22"
                        min="1"
                        max="65535"
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">Username</label>
                    <input
                      type="text"
                      value={regSshUsername}
                      onChange={e => { setRegSshUsername(e.target.value); setRegError(null); }}
                      placeholder="root"
                      autoComplete="username"
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">Password</label>
                    <div className="relative">
                      <input
                        type={showRegSshPassword ? 'text' : 'password'}
                        value={regSshPassword}
                        onChange={e => { setRegSshPassword(e.target.value); setRegError(null); }}
                        placeholder="Enter SSH password"
                        autoComplete="current-password"
                        className="w-full px-3 py-2 pr-8 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500 transition-colors"
                      />
                      <button type="button" onClick={() => setShowRegSshPassword(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200">
                        {showRegSshPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {regType && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Gateway Token <span className="text-gray-600 font-normal">(optional)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showRegToken ? 'text' : 'password'}
                        value={regToken}
                        onChange={e => setRegToken(e.target.value)}
                        className="w-full px-3 py-2 pr-8 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 font-mono focus:outline-none focus:border-blue-500 transition-colors"
                        placeholder="Enter existing gateway token…"
                      />
                      <button type="button" onClick={() => setShowRegToken(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200">
                        {showRegToken ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                    {regToken && <CopyBtn text={regToken} />}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">The OPENCLAW_GATEWAY_TOKEN of the existing instance</p>
                </div>
              )}

              {regType && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Gateway URL <span className="text-gray-600 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={regGatewayUrl}
                    onChange={e => setRegGatewayUrl(e.target.value)}
                    placeholder="ws://host:18789"
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 font-mono focus:outline-none focus:border-blue-500 transition-colors"
                  />
                  <p className="mt-1 text-xs text-gray-500">WebSocket address for connecting to the OpenClaw gateway</p>
                </div>
              )}

              {regError && (
                <div className="flex items-start gap-2 p-3 bg-red-900/30 border border-red-700/50 rounded text-red-400 text-sm">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" /><span>{regError}</span>
                </div>
              )}
            </div>
            <div className="flex gap-3 justify-end px-5 py-4 border-t border-gray-700 flex-shrink-0">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-300 hover:text-gray-100 hover:bg-gray-700 rounded-md transition-colors">Cancel</button>
              <button
                type="submit"
                disabled={!regNameValid || !regType || regLoading || (regType === 'ssh' && (!regSshHost.trim() || !regSshUsername.trim() || !regSshPassword))}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 disabled:bg-purple-900 disabled:text-purple-400 disabled:cursor-not-allowed text-white rounded-md transition-colors"
              >
                {regLoading ? <><Loader2 size={14} className="animate-spin" />Registering…</> : <><FolderPlus size={14} />Register</>}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
