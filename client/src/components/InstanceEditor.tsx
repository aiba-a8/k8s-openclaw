import React, { useState, useEffect, useCallback } from 'react';
import { Save, Rocket, X, Loader2, AlertCircle, CheckCircle, FileCode, Wifi, Info, Eye, EyeOff, Copy, Check, HardDrive } from 'lucide-react';
import { authHeaders } from '../utils/auth';
import YamlFileEditor from './YamlFileEditor';
import DeploymentForm from './DeploymentForm';
import PvcForm from './PvcForm';
import ServiceForm from './ServiceForm';
import ConfigMapForm from './ConfigMapForm';
import OpenClawPanel from './OpenClawPanel';
import OcFileConfigPanel from './OcFileConfigPanel';
import { ViewMode, YamlFileName, YAML_FILES } from '../types';

type MainTab = 'info' | 'openclaw' | 'config' | 'files';

interface InstanceEditorProps {
  instanceName: string;
  deployType?: string;
  gatewayToken?: string;
  createdAt?: string;
  onDeployStart?: () => void;
  onDeployEnd?: () => void;
}

// ── Instance Info Panel ───────────────────────────────────────────────────────
function InstanceInfoPanel({ name, deployType, gatewayToken, createdAt }: {
  name: string;
  deployType?: string;
  gatewayToken?: string;
  createdAt?: string;
}) {
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyToken = () => {
    if (!gatewayToken) return;
    void navigator.clipboard.writeText(gatewayToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const fmtDate = (iso?: string) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
  };

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'Name', value: <span className="font-mono text-gray-100">{name}</span> },
    {
      label: 'Deploy Type',
      value: (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
          deployType === 'local' ? 'bg-green-900/50 text-green-300 border border-green-800' :
          deployType === 'kubernetes' ? 'bg-blue-900/50 text-blue-300 border border-blue-800' :
          'bg-gray-700 text-gray-300 border border-gray-600'
        }`}>{deployType ?? 'kubernetes'}</span>
      ),
    },
    { label: 'Created', value: <span className="text-gray-300">{fmtDate(createdAt)}</span> },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h3 className="text-sm font-semibold text-gray-200 mb-4">Instance Info</h3>
      <div className="space-y-3 max-w-xl">
        {rows.map(r => (
          <div key={r.label} className="flex items-center gap-4 py-2 border-b border-gray-700/50">
            <span className="text-xs text-gray-500 w-24 flex-shrink-0">{r.label}</span>
            <div className="text-sm flex-1">{r.value}</div>
          </div>
        ))}
        {gatewayToken && (
          <div className="flex items-start gap-4 py-2 border-b border-gray-700/50">
            <span className="text-xs text-gray-500 w-24 flex-shrink-0 mt-1">Gateway Token</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5">
                <code className="flex-1 text-xs font-mono text-green-300 break-all">
                  {showToken ? gatewayToken : '•'.repeat(Math.min(gatewayToken.length, 32))}
                </code>
                <button onClick={() => setShowToken(v => !v)} className="text-gray-500 hover:text-gray-300 flex-shrink-0">
                  {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <button onClick={copyToken} className="text-gray-500 hover:text-gray-300 flex-shrink-0">
                  {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                </button>
              </div>
              <p className="text-xs text-gray-600 mt-1">OPENCLAW_GATEWAY_TOKEN — click eye to reveal</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const FILE_LABELS: Record<YamlFileName, string> = {
  'deployment.yaml': 'Deployment',
  'service.yaml': 'Service',
  'pvc.yaml': 'PVC',
  'configmap.yaml': 'ConfigMap',
  'kustomization.yaml': 'Kustomization',
};

// Files that have form support
const FORM_SUPPORTED: YamlFileName[] = ['deployment.yaml', 'service.yaml', 'pvc.yaml', 'configmap.yaml'];

export default function InstanceEditor({ instanceName, deployType, gatewayToken, createdAt, onDeployStart, onDeployEnd }: InstanceEditorProps) {
  const isLocal = deployType === 'local';
  const [mainTab, setMainTab] = useState<MainTab>(isLocal ? 'config' : 'info');
  const [deploySucceeded, setDeploySucceeded] = useState(false);
  const [selectedFile, setSelectedFile] = useState<YamlFileName>('deployment.yaml');
  const [viewMode, setViewMode] = useState<ViewMode>('form');
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [pendingContents, setPendingContents] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [deployOutput, setDeployOutput] = useState<string[]>([]);
  const [deployStatus, setDeployStatus] = useState<'running' | 'success' | 'error'>('running');
  const [podPhase, setPodPhase] = useState<string | null>(null);
  const [podReady, setPodReady] = useState(false);
  const [podName, setPodName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const contents: Record<string, string> = {};
    try {
      await Promise.all(
        YAML_FILES.map(async (file) => {
          const res = await fetch(`/api/instances/${instanceName}/files/${file}`, { headers: authHeaders() });
          if (res.ok) {
            const data = await res.json() as { content: string };
            contents[file] = data.content;
          }
        })
      );
      setFileContents(contents);
      setPendingContents(contents);
    } catch (err) {
      setLoadError(String(err));
    } finally {
      setLoading(false);
    }
  }, [instanceName]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const handleContentChange = (newContent: string) => {
    setPendingContents(prev => ({ ...prev, [selectedFile]: newContent }));
    setSaveSuccess(false);
    setSaveError(null);
  };

  const handleSave = async () => {
    const content = pendingContents[selectedFile];
    if (content === undefined) return;

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const res = await fetch(`/api/instances/${instanceName}/files/${selectedFile}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        const data = await res.json() as { error: string };
        throw new Error(data.error);
      }

      setFileContents(prev => ({ ...prev, [selectedFile]: content }));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDeploy = async () => {
    setDeployOutput([]);
    setDeployStatus('running');
    setPodPhase(null);
    setPodReady(false);
    setPodName(null);
    setDeploySucceeded(false);
    setDeployModalOpen(true);
    setDeploying(true);
    onDeployStart?.();

    try {
      const res = await fetch(`/api/instances/${instanceName}/deploy`, {
        method: 'POST',
        headers: authHeaders(),
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        setDeployOutput([text || 'Deploy failed']);
        setDeployStatus('error');
        setDeploying(false);
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
            const msg = JSON.parse(line) as { type: string; text?: string; phase?: string; ready?: boolean; podName?: string; success?: boolean; message?: string };
            if (msg.type === 'log' && msg.text) {
              setDeployOutput(prev => [...prev, ...msg.text!.split('\n').filter(l => l.length > 0)]);
            } else if (msg.type === 'pod_status') {
              setPodPhase(msg.phase ?? null);
              setPodReady(msg.ready ?? false);
              if (msg.podName) setPodName(msg.podName);
            } else if (msg.type === 'done') {
              const ok = msg.success === true;
              setDeployStatus(ok ? 'success' : 'error');
              if (ok) setDeploySucceeded(true);
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setDeployOutput(prev => [...prev, `Error: ${String(err)}`]);
      setDeployStatus('error');
    } finally {
      setDeploying(false);
      onDeployEnd?.();
    }
  };

  const isDirty = pendingContents[selectedFile] !== fileContents[selectedFile];
  const hasFormSupport = FORM_SUPPORTED.includes(selectedFile);
  const currentContent = pendingContents[selectedFile] ?? '';

  const renderForm = () => {
    switch (selectedFile) {
      case 'deployment.yaml':
        return <DeploymentForm value={currentContent} onChange={handleContentChange} />;
      case 'service.yaml':
        return <ServiceForm value={currentContent} onChange={handleContentChange} />;
      case 'pvc.yaml':
        return <PvcForm value={currentContent} onChange={handleContentChange} />;
      case 'configmap.yaml':
        return <ConfigMapForm value={currentContent} onChange={handleContentChange} />;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1 text-gray-500">
        <Loader2 size={20} className="animate-spin mr-2" />
        <span>Loading files...</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center flex-1">
        <div className="flex items-start gap-2 text-red-400 max-w-md">
          <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Failed to load instance files</div>
            <div className="text-sm text-red-300 mt-1">{loadError}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <FileCode size={16} className="text-blue-400" />
            <span className="text-sm font-semibold text-gray-100">{instanceName}</span>
          </div>
          {/* Main tab switcher */}
          <div className="flex items-center bg-gray-700 rounded-md p-0.5">
            <button
              onClick={() => setMainTab('info')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors ${mainTab === 'info' ? 'bg-gray-900 text-gray-100 shadow' : 'text-gray-400 hover:text-gray-200'}`}
            >
              <Info size={12} />Info
            </button>
            <button
              onClick={() => setMainTab('openclaw')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors ${mainTab === 'openclaw' ? 'bg-gray-900 text-gray-100 shadow' : 'text-gray-400 hover:text-gray-200'}`}
            >
              <Wifi size={12} />Connect
            </button>
            <button
              onClick={() => setMainTab('config')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors ${mainTab === 'config' ? 'bg-gray-900 text-gray-100 shadow' : 'text-gray-400 hover:text-gray-200'}`}
            >
              <FileCode size={12} />Config
            </button>
            <button
              onClick={() => setMainTab('files')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors ${mainTab === 'files' ? 'bg-gray-900 text-gray-100 shadow' : 'text-gray-400 hover:text-gray-200'}`}
            >
              <Rocket size={12} />Deploy
            </button>
          </div>
        </div>
        {!isLocal && (
          <button
            onClick={() => void handleDeploy()}
            disabled={deploying}
            className="flex items-center gap-2 px-4 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-green-800 disabled:text-green-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-md transition-colors"
          >
            {deploying ? (
              <><Loader2 size={14} className="animate-spin" />Deploying...</>
            ) : (
              <><Rocket size={14} />Deploy</>
            )}
          </button>
        )}
      </div>

      {/* Info Panel */}
      {mainTab === 'info' && (
        <InstanceInfoPanel
          name={instanceName}
          deployType={deployType}
          gatewayToken={gatewayToken}
          createdAt={createdAt}
        />
      )}

      {/* Connect Panel */}
      {mainTab === 'openclaw' && (
        <div className="flex-1 overflow-hidden">
          <OpenClawPanel
            instanceName={instanceName}
            gatewayToken={gatewayToken}
            autoOpenSettings={deploySucceeded}
            onAutoOpenHandled={() => setDeploySucceeded(false)}
          />
        </div>
      )}

      {/* Config Panel */}
      {mainTab === 'config' && (
        <div className="flex-1 overflow-hidden">
          <OcFileConfigPanel instanceName={instanceName} deployType={deployType} />
        </div>
      )}

      {/* Deploy tab — local: show info; kubernetes: YAML editor */}
      {mainTab === 'files' && isLocal && (
        <div className="flex flex-col items-center justify-center flex-1 text-gray-500 gap-3">
          <HardDrive size={32} className="opacity-30" />
          <div className="text-sm text-center">
            <p className="text-gray-400 font-medium mb-1">Local deployment</p>
            <p className="text-xs">This instance runs locally via npm. No Kubernetes manifests needed.</p>
          </div>
        </div>
      )}

      {mainTab === 'files' && !isLocal && <>
      <div className="flex items-center gap-0 border-b border-gray-700 bg-gray-850 flex-shrink-0 overflow-x-auto" style={{ background: '#1a1f2e' }}>
        {YAML_FILES.map(file => (
          <button
            key={file}
            onClick={() => setSelectedFile(file)}
            className={`relative px-4 py-2 text-xs font-medium whitespace-nowrap transition-colors border-b-2 ${
              selectedFile === file
                ? 'text-blue-400 border-blue-400 bg-gray-900'
                : 'text-gray-400 hover:text-gray-200 border-transparent hover:bg-gray-800'
            }`}
          >
            {FILE_LABELS[file]}
            {pendingContents[file] !== fileContents[file] && (
              <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
            )}
          </button>
        ))}
      </div>

      {/* View mode toggle + Save button */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-1 bg-gray-700 rounded-md p-0.5">
          {hasFormSupport && (
            <button
              onClick={() => setViewMode('form')}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                viewMode === 'form'
                  ? 'bg-gray-900 text-gray-100 shadow'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Form
            </button>
          )}
          <button
            onClick={() => setViewMode('yaml')}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              viewMode === 'yaml' || !hasFormSupport
                ? 'bg-gray-900 text-gray-100 shadow'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            YAML
          </button>
        </div>

        <div className="flex items-center gap-2">
          {saveError && (
            <span className="flex items-center gap-1 text-xs text-red-400">
              <AlertCircle size={12} />
              {saveError}
            </span>
          )}
          {saveSuccess && (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <CheckCircle size={12} />
              Saved
            </span>
          )}
          <button
            onClick={() => void handleSave()}
            disabled={saving || !isDirty}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md transition-colors ${
              isDirty
                ? 'bg-blue-600 hover:bg-blue-500 text-white'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            {saving ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Save size={12} />
            )}
            Save
          </button>
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-hidden h-full">
        {(viewMode === 'yaml' || !hasFormSupport) ? (
          <YamlFileEditor
            value={currentContent}
            onChange={handleContentChange}
          />
        ) : (
          renderForm()
        )}
      </div>
      </> /* end mainTab === 'files' */}

      {/* Deploy Output Modal */}
      {deployModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg shadow-2xl border border-gray-700 w-full max-w-md mx-4 flex flex-col">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Rocket size={16} className="text-green-400" />
                <h2 className="text-sm font-semibold text-gray-100">
                  Deploying {instanceName}
                </h2>
                {deploying && <Loader2 size={14} className="animate-spin text-gray-400" />}
                {!deploying && deployStatus === 'success' && (
                  <CheckCircle size={14} className="text-green-400" />
                )}
                {!deploying && deployStatus === 'error' && (
                  <AlertCircle size={14} className="text-red-400" />
                )}
              </div>
              <button
                onClick={() => setDeployModalOpen(false)}
                disabled={deploying}
                className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
              >
                <X size={16} />
              </button>
            </div>

            {/* Progress steps */}
            <div className="px-5 py-4 space-y-3">
              {/* Step 1: kubectl apply */}
              <div className="flex items-center gap-3">
                {deployStatus === 'running' && !podPhase ? (
                  <Loader2 size={15} className="animate-spin text-blue-400 flex-shrink-0" />
                ) : deployStatus === 'error' && !podPhase ? (
                  <AlertCircle size={15} className="text-red-400 flex-shrink-0" />
                ) : (
                  <CheckCircle size={15} className="text-green-400 flex-shrink-0" />
                )}
                <span className="text-sm text-gray-300">Apply Kubernetes manifests</span>
              </div>

              {/* Step 2: Pod status */}
              <div className="flex items-center gap-3">
                {!podPhase ? (
                  <div className="w-4 h-4 rounded-full border-2 border-gray-600 flex-shrink-0" />
                ) : podReady ? (
                  <CheckCircle size={15} className="text-green-400 flex-shrink-0" />
                ) : deployStatus === 'error' ? (
                  <AlertCircle size={15} className="text-red-400 flex-shrink-0" />
                ) : (
                  <Loader2 size={15} className="animate-spin text-blue-400 flex-shrink-0" />
                )}
                <div className="flex-1">
                  <span className="text-sm text-gray-300">Wait for pod to be ready</span>
                  {podPhase && (
                    <span className={`ml-2 text-xs ${podReady ? 'text-green-400' : 'text-yellow-400'}`}>
                      {podPhase}{podName ? ` · ${podName}` : ''}
                    </span>
                  )}
                </div>
              </div>

              {/* Error output (only errors, not full log) */}
              {deployStatus === 'error' && deployOutput.filter(l => l.startsWith('✗') || l.toLowerCase().includes('error') || l.toLowerCase().includes('failed')).length > 0 && (
                <div className="mt-2 p-3 bg-red-900/20 border border-red-800/50 rounded-lg">
                  {deployOutput.filter(l => l.startsWith('✗') || l.toLowerCase().includes('error')).map((l, i) => (
                    <p key={i} className="text-xs text-red-400 font-mono">{l}</p>
                  ))}
                </div>
              )}

              <p className="text-xs text-gray-600 pt-1">Full output is visible in the Logs panel below ↓</p>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-700 flex-shrink-0">
              {deployStatus === 'success' && (
                <button
                  onClick={() => { setDeployModalOpen(false); setMainTab('openclaw'); }}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 hover:bg-green-500 text-white rounded-md transition-colors"
                >
                  <Wifi size={14} />Go to Connect
                </button>
              )}
              <button
                onClick={() => setDeployModalOpen(false)}
                disabled={deploying}
                className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200 rounded-md transition-colors"
              >
                {deploying ? 'Running...' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
