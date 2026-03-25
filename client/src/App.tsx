import React, { useState, useEffect, useCallback } from 'react';
import { Terminal, Plus, ScrollText } from 'lucide-react';
import Sidebar from './components/Sidebar';
import InstanceEditor from './components/InstanceEditor';
import TerminalPanel from './components/TerminalPanel';
import LogsPanel from './components/LogsPanel';
import CreateInstanceModal from './components/CreateInstanceModal';
import LoginPage from './components/LoginPage';
import { Instance } from './types';
import { getToken, clearToken, authHeaders, verifyToken } from './utils/auth';

type BottomTab = 'terminal' | 'logs';

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [bottomTab, setBottomTab] = useState<BottomTab>('terminal');
  const [deployingInstance, setDeployingInstance] = useState<string | null>(null);
  const [bottomHeight, setBottomHeight] = useState(288); // px, default h-72
  const isDragging = React.useRef(false);
  const dragStartY = React.useRef(0);
  const dragStartH = React.useRef(0);

  const onDragStart = (e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartY.current = e.clientY;
    dragStartH.current = bottomHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  };

  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = dragStartY.current - e.clientY;
      setBottomHeight(Math.min(Math.max(dragStartH.current + delta, 80), window.innerHeight - 120));
    };
    const onUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check saved token on mount
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setAuthChecking(false);
      return;
    }
    verifyToken(token).then((ok) => {
      setAuthenticated(ok);
      if (!ok) clearToken();
      setAuthChecking(false);
    });
  }, []);

  const fetchInstances = useCallback(async () => {
    try {
      const res = await fetch('/api/instances', { headers: authHeaders() });
      if (res.status === 401) { setAuthenticated(false); clearToken(); return; }
      if (!res.ok) throw new Error('Failed to fetch instances');
      const data = await res.json() as Instance[];
      setInstances(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authenticated) void fetchInstances();
  }, [authenticated, fetchInstances]);

  const handleLogin = () => {
    setAuthenticated(true);
  };

  const handleLogout = () => {
    clearToken();
    setAuthenticated(false);
    setInstances([]);
    setSelectedInstance(null);
  };

  const handleCreateInstance = async (name: string, deployType: string, gatewayToken?: string, registerOnly?: boolean) => {
    const res = await fetch('/api/instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name, deployType, ...(gatewayToken ? { gatewayToken } : {}), ...(registerOnly ? { registerOnly: true } : {}) }),
    });
    if (!res.ok) {
      const data = await res.json() as { error: string };
      throw new Error(data.error);
    }
    await fetchInstances();
    setSelectedInstance(name);
    // Modal closes itself via onClose — do NOT call setCreateModalOpen(false) here
  };

  const handleDeleteInstance = async (name: string) => {
    const res = await fetch(`/api/instances/${name}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!res.ok) {
      const data = await res.json() as { error: string };
      throw new Error(data.error);
    }
    await fetchInstances();
    if (selectedInstance === name) setSelectedInstance(null);
  };

  // Show nothing while checking saved token
  if (authChecking) {
    return <div className="min-h-screen bg-gray-900" />;
  }

  if (!authenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100 overflow-hidden">
      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          instances={instances}
          selectedInstance={selectedInstance}
          onSelectInstance={setSelectedInstance}
          onDeleteInstance={handleDeleteInstance}
          onNewInstance={() => setCreateModalOpen(true)}
          onLogout={handleLogout}
          loading={loading}
          error={error}
        />

        {/* Main editor area */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {selectedInstance ? (
            <InstanceEditor
              key={selectedInstance}
              instanceName={selectedInstance}
              deployType={instances.find(i => i.name === selectedInstance)?.deployType}
              gatewayToken={instances.find(i => i.name === selectedInstance)?.gatewayToken}
              createdAt={instances.find(i => i.name === selectedInstance)?.createdAt}
              onDeployStart={() => { setDeployingInstance(selectedInstance); setBottomTab('logs'); setTerminalOpen(true); }}
              onDeployEnd={() => setDeployingInstance(null)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 text-gray-500">
              <div className="text-6xl mb-4">⚓</div>
              <h2 className="text-xl font-semibold mb-2">No instance selected</h2>
              <p className="text-sm mb-6">Select an instance from the sidebar or create a new one</p>
              <button
                onClick={() => setCreateModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
              >
                <Plus size={16} />
                New Instance
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Panel: Terminal | Logs */}
      <div
        className="flex flex-col border-t border-gray-700 flex-shrink-0"
        style={{ height: terminalOpen ? bottomHeight : 36 }}
      >
        {/* Drag handle */}
        {terminalOpen && (
          <div
            onMouseDown={onDragStart}
            className="h-1 bg-transparent hover:bg-blue-500/40 cursor-ns-resize flex-shrink-0 transition-colors"
            title="Drag to resize"
          />
        )}
        {/* Bottom panel header */}
        <div className="flex items-center bg-gray-800 border-b border-gray-700 flex-shrink-0" style={{ minHeight: '36px' }}>
          {/* Tabs */}
          <button
            onClick={() => { setBottomTab('terminal'); setTerminalOpen(true); }}
            className={`flex items-center gap-1.5 px-3 h-full text-xs border-b-2 transition-colors ${
              bottomTab === 'terminal'
                ? 'text-gray-100 border-blue-400'
                : 'text-gray-400 hover:text-gray-200 border-transparent'
            }`}
          >
            <Terminal size={13} />Terminal
          </button>
          <button
            onClick={() => { setBottomTab('logs'); setTerminalOpen(true); }}
            className={`flex items-center gap-1.5 px-3 h-full text-xs border-b-2 transition-colors ${
              bottomTab === 'logs'
                ? 'text-gray-100 border-blue-400'
                : 'text-gray-400 hover:text-gray-200 border-transparent'
            }`}
          >
            <ScrollText size={13} />Logs
          </button>
          <button
            onClick={() => setTerminalOpen(prev => !prev)}
            className="ml-auto text-xs text-gray-400 hover:text-gray-200 px-3 h-full hover:bg-gray-700 transition-colors"
          >
            {terminalOpen ? 'Hide' : 'Show'}
          </button>
        </div>

        {terminalOpen && (
          <div className="flex-1 overflow-hidden">
            {bottomTab === 'terminal' && <TerminalPanel />}
            {bottomTab === 'logs' && <LogsPanel instanceName={selectedInstance} isDeploying={deployingInstance === selectedInstance} />}
          </div>
        )}
      </div>

      {/* Create Instance Modal */}
      {createModalOpen && (
        <CreateInstanceModal
          onClose={() => setCreateModalOpen(false)}
          onCreate={(name, deployType, gatewayToken, registerOnly) => handleCreateInstance(name, deployType, gatewayToken, registerOnly)}
        />
      )}
    </div>
  );
}
