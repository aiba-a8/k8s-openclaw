import React, { useMemo } from 'react';
import * as yaml from 'js-yaml';

interface ConfigMapFormProps {
  value: string;
  onChange: (newYaml: string) => void;
}

interface ConfigMapDoc {
  metadata?: { name?: string; labels?: Record<string, string> };
  data?: {
    'openclaw.json'?: string;
    'AGENTS.md'?: string;
  };
}

export default function ConfigMapForm({ value, onChange }: ConfigMapFormProps) {
  const doc = useMemo(() => {
    try {
      return (yaml.load(value) as ConfigMapDoc) ?? {};
    } catch {
      return {} as ConfigMapDoc;
    }
  }, [value]);

  const updateDoc = (updater: (d: ConfigMapDoc) => ConfigMapDoc) => {
    try {
      const updated = updater(JSON.parse(JSON.stringify(doc)) as ConfigMapDoc);
      onChange(yaml.dump(updated, { lineWidth: -1 }));
    } catch {
      // ignore
    }
  };

  return (
    <div className="p-4 overflow-y-auto flex-1">
      <div className="flex flex-col gap-4 max-w-3xl">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">ConfigMap Name</label>
          <input
            type="text"
            className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            value={doc.metadata?.name ?? ''}
            onChange={e => updateDoc(d => {
              if (!d.metadata) d.metadata = {};
              d.metadata.name = e.target.value;
              return d;
            })}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            openclaw.json
            <span className="ml-2 text-gray-500 font-normal">(JSON configuration)</span>
          </label>
          <textarea
            rows={12}
            spellCheck={false}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 font-mono focus:outline-none focus:border-blue-500 resize-y"
            value={doc.data?.['openclaw.json'] ?? ''}
            onChange={e => updateDoc(d => {
              if (!d.data) d.data = {};
              d.data['openclaw.json'] = e.target.value;
              return d;
            })}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            AGENTS.md
            <span className="ml-2 text-gray-500 font-normal">(Agent instructions)</span>
          </label>
          <textarea
            rows={8}
            spellCheck={false}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 font-mono focus:outline-none focus:border-blue-500 resize-y"
            value={doc.data?.['AGENTS.md'] ?? ''}
            onChange={e => updateDoc(d => {
              if (!d.data) d.data = {};
              d.data['AGENTS.md'] = e.target.value;
              return d;
            })}
          />
        </div>
      </div>
    </div>
  );
}
