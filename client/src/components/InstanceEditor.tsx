import React, { useState, useEffect, useCallback } from 'react';
import { Save, Rocket, X, Loader2, AlertCircle, CheckCircle, FileCode, Wifi } from 'lucide-react';
import { authHeaders } from '../utils/auth';
import YamlFileEditor from './YamlFileEditor';
import DeploymentForm from './DeploymentForm';
import PvcForm from './PvcForm';
import ServiceForm from './ServiceForm';
import ConfigMapForm from './ConfigMapForm';
import OpenClawPanel from './OpenClawPanel';
import { ViewMode, YamlFileName, YAML_FILES } from '../types';

type MainTab = 'files' | 'openclaw';

interface InstanceEditorProps {
  instanceName: string;
  deployType?: string;
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

export default function InstanceEditor({ instanceName, deployType }: InstanceEditorProps) {
  const isLocal = deployType === 'local';
  const [mainTab, setMainTab] = useState<MainTab>(isLocal ? 'openclaw' : 'files');
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
    setDeployModalOpen(true);
    setDeploying(true);

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
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        setDeployOutput(prev => [...prev, ...lines.filter(l => l.length > 0)]);
      }

      if (buffer) {
        setDeployOutput(prev => [...prev, buffer]);
      }

      setDeployStatus('success');
    } catch (err) {
      setDeployOutput(prev => [...prev, `Error: ${String(err)}`]);
      setDeployStatus('error');
    } finally {
      setDeploying(false);
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
            {!isLocal && (
              <button
                onClick={() => setMainTab('files')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors ${mainTab === 'files' ? 'bg-gray-900 text-gray-100 shadow' : 'text-gray-400 hover:text-gray-200'}`}
              >
                <FileCode size={12} />Files
              </button>
            )}
            <button
              onClick={() => setMainTab('openclaw')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors ${mainTab === 'openclaw' ? 'bg-gray-900 text-gray-100 shadow' : 'text-gray-400 hover:text-gray-200'}`}
            >
              <Wifi size={12} />Connect
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

      {/* OpenClaw Connect Panel */}
      {mainTab === 'openclaw' && (
        <div className="flex-1 overflow-hidden">
          <OpenClawPanel instanceName={instanceName} deployType={deployType} />
        </div>
      )}

      {/* File tabs - only shown in files tab */}
      {mainTab === 'files' && <>
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
          <div className="bg-gray-800 rounded-lg shadow-2xl border border-gray-700 w-full max-w-2xl mx-4 flex flex-col max-h-[80vh]">
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

            {/* Output */}
            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs bg-gray-900 rounded-b-lg">
              {deployOutput.length === 0 && deploying && (
                <span className="text-gray-500">Waiting for output...</span>
              )}
              {deployOutput.map((line, i) => (
                <div
                  key={i}
                  className={`leading-5 ${
                    line.includes('Error') || line.includes('error') || line.includes('failed') || line.startsWith('✗')
                      ? 'text-red-400'
                      : line.startsWith('✓') || line.includes('configured') || line.includes('created') || line.includes('unchanged')
                      ? 'text-green-400'
                      : 'text-gray-300'
                  }`}
                >
                  {line || '\u00A0'}
                </div>
              ))}
              {!deploying && (
                <div className={`mt-2 font-semibold ${
                  deployStatus === 'success' ? 'text-green-400' : 'text-red-400'
                }`}>
                  {deployStatus === 'success' ? '--- Deploy complete ---' : '--- Deploy failed ---'}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end px-5 py-3 border-t border-gray-700 flex-shrink-0">
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
