import React, { useState, useRef, useEffect } from 'react';
import { X, Plus, Loader2, AlertCircle } from 'lucide-react';

interface CreateInstanceModalProps {
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}

export default function CreateInstanceModal({ onClose, onCreate }: CreateInstanceModalProps) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const isValid = /^[a-z0-9-]+$/.test(name) && name.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || loading) return;

    setLoading(true);
    setError(null);
    try {
      await onCreate(name);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
    >
      <div className="bg-gray-800 rounded-lg shadow-2xl border border-gray-700 w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h2 className="text-base font-semibold text-gray-100">Create New Instance</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={(e) => void handleSubmit(e)} className="px-5 py-4">
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Instance Name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={e => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="e.g. openclaw-prod"
              className={`w-full px-3 py-2 bg-gray-700 border rounded text-sm text-gray-100 focus:outline-none transition-colors ${
                name && !isValid
                  ? 'border-red-500 focus:border-red-400'
                  : 'border-gray-600 focus:border-blue-500'
              }`}
            />
            <p className={`mt-1.5 text-xs ${name && !isValid ? 'text-red-400' : 'text-gray-500'}`}>
              Lowercase letters, numbers, and dashes only (e.g. my-instance)
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded text-red-400 text-sm">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-300 hover:text-gray-100 hover:bg-gray-700 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isValid || loading}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-blue-300 disabled:cursor-not-allowed text-white rounded-md transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus size={14} />
                  Create Instance
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
