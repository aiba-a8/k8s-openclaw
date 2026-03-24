import React, { useState, useEffect, useCallback } from 'react';
import { Terminal, Plus } from 'lucide-react';
import Sidebar from './components/Sidebar';
import InstanceEditor from './components/InstanceEditor';
import TerminalPanel from './components/TerminalPanel';
import CreateInstanceModal from './components/CreateInstanceModal';
import { Instance } from './types';

export default function App() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInstances = useCallback(async () => {
    try {
      const res = await fetch('/api/instances');
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
    void fetchInstances();
  }, [fetchInstances]);

  const handleCreateInstance = async (name: string) => {
    const res = await fetch('/api/instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const data = await res.json() as { error: string };
      throw new Error(data.error);
    }
    await fetchInstances();
    setSelectedInstance(name);
    setCreateModalOpen(false);
  };

  const handleDeleteInstance = async (name: string) => {
    const res = await fetch(`/api/instances/${name}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json() as { error: string };
      throw new Error(data.error);
    }
    await fetchInstances();
    if (selectedInstance === name) {
      setSelectedInstance(null);
    }
  };

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
          loading={loading}
          error={error}
        />

        {/* Main editor area */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {selectedInstance ? (
            <InstanceEditor
              key={selectedInstance}
              instanceName={selectedInstance}
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

      {/* Terminal Panel */}
      <div className={`flex flex-col border-t border-gray-700 transition-all duration-200 ${terminalOpen ? 'h-72' : 'h-9'}`}>
        {/* Terminal toolbar */}
        <div className="flex items-center justify-between px-3 py-1 bg-gray-800 border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-gray-400" />
            <span className="text-xs font-medium text-gray-300">Terminal</span>
          </div>
          <button
            onClick={() => setTerminalOpen(prev => !prev)}
            className="text-xs text-gray-400 hover:text-gray-200 px-2 py-0.5 rounded hover:bg-gray-700 transition-colors"
          >
            {terminalOpen ? 'Hide' : 'Show'}
          </button>
        </div>
        {terminalOpen && (
          <div className="flex-1 overflow-hidden">
            <TerminalPanel />
          </div>
        )}
      </div>

      {/* Create Instance Modal */}
      {createModalOpen && (
        <CreateInstanceModal
          onClose={() => setCreateModalOpen(false)}
          onCreate={handleCreateInstance}
        />
      )}
    </div>
  );
}
