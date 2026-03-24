import React, { useState } from 'react';
import { Plus, Trash2, Server, Loader2, AlertCircle } from 'lucide-react';
import { Instance } from '../types';

interface SidebarProps {
  instances: Instance[];
  selectedInstance: string | null;
  onSelectInstance: (name: string) => void;
  onDeleteInstance: (name: string) => Promise<void>;
  onNewInstance: () => void;
  loading: boolean;
  error: string | null;
}

export default function Sidebar({
  instances,
  selectedInstance,
  onSelectInstance,
  onDeleteInstance,
  onNewInstance,
  loading,
  error,
}: SidebarProps) {
  const [deletingInstance, setDeletingInstance] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    if (!confirm(`Delete instance "${name}"? This cannot be undone.`)) return;

    setDeletingInstance(name);
    setDeleteError(null);
    try {
      await onDeleteInstance(name);
    } catch (err) {
      setDeleteError(String(err));
    } finally {
      setDeletingInstance(null);
    }
  };

  return (
    <div className="flex flex-col w-64 flex-shrink-0 bg-gray-800 border-r border-gray-700">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700">
        <Server size={18} className="text-blue-400" />
        <h1 className="text-sm font-bold text-gray-100">K8s OpenClaw</h1>
      </div>

      {/* New Instance button */}
      <div className="px-3 py-2">
        <button
          onClick={onNewInstance}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
        >
          <Plus size={14} />
          New Instance
        </button>
      </div>

      {/* Instance list */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {loading && (
          <div className="flex items-center justify-center py-8 text-gray-500">
            <Loader2 size={16} className="animate-spin mr-2" />
            <span className="text-xs">Loading...</span>
          </div>
        )}

        {error && !loading && (
          <div className="flex items-start gap-2 px-2 py-3 text-red-400 text-xs">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && instances.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-xs">
            No instances yet.<br />Create one to get started.
          </div>
        )}

        {instances.map(instance => (
          <div
            key={instance.name}
            onClick={() => onSelectInstance(instance.name)}
            className={`group flex items-center justify-between px-3 py-2 rounded-md cursor-pointer mb-1 transition-colors ${
              selectedInstance === instance.name
                ? 'bg-blue-600 text-white'
                : 'text-gray-300 hover:bg-gray-700'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                selectedInstance === instance.name ? 'bg-blue-200' : 'bg-gray-500'
              }`} />
              <span className="text-sm font-medium truncate">{instance.name}</span>
            </div>
            <button
              onClick={(e) => void handleDelete(e, instance.name)}
              disabled={deletingInstance === instance.name}
              className={`flex-shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${
                selectedInstance === instance.name
                  ? 'hover:bg-blue-500 text-blue-100'
                  : 'hover:bg-gray-600 text-gray-400 hover:text-red-400'
              }`}
              title="Delete instance"
            >
              {deletingInstance === instance.name ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Trash2 size={12} />
              )}
            </button>
          </div>
        ))}
      </div>

      {deleteError && (
        <div className="px-3 py-2 text-xs text-red-400 border-t border-gray-700">
          {deleteError}
        </div>
      )}

      {/* Footer */}
      <div className="px-3 py-2 border-t border-gray-700 text-xs text-gray-500">
        {instances.length} instance{instances.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
