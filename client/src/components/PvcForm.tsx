import React, { useMemo } from 'react';
import * as yaml from 'js-yaml';

interface PvcFormProps {
  value: string;
  onChange: (newYaml: string) => void;
}

interface PvcDoc {
  metadata?: { name?: string; labels?: Record<string, string> };
  spec?: {
    accessModes?: string[];
    storageClassName?: string;
    resources?: { requests?: { storage?: string } };
  };
}

export default function PvcForm({ value, onChange }: PvcFormProps) {
  const doc = useMemo(() => {
    try {
      return (yaml.load(value) as PvcDoc) ?? {};
    } catch {
      return {} as PvcDoc;
    }
  }, [value]);

  const updateDoc = (updater: (d: PvcDoc) => PvcDoc) => {
    try {
      const updated = updater(JSON.parse(JSON.stringify(doc)) as PvcDoc);
      onChange(yaml.dump(updated, { lineWidth: -1 }));
    } catch {
      // ignore
    }
  };

  return (
    <div className="p-4 overflow-y-auto flex-1">
      <div className="grid grid-cols-2 gap-4 max-w-2xl">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-400 mb-1">PVC Name</label>
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
          <label className="block text-xs font-medium text-gray-400 mb-1">Storage Size</label>
          <input
            type="text"
            placeholder="e.g. 10Gi"
            className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            value={doc.spec?.resources?.requests?.storage ?? ''}
            onChange={e => updateDoc(d => {
              if (!d.spec) d.spec = {};
              if (!d.spec.resources) d.spec.resources = {};
              if (!d.spec.resources.requests) d.spec.resources.requests = {};
              d.spec.resources.requests.storage = e.target.value;
              return d;
            })}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Access Mode</label>
          <select
            className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            value={doc.spec?.accessModes?.[0] ?? 'ReadWriteOnce'}
            onChange={e => updateDoc(d => {
              if (!d.spec) d.spec = {};
              d.spec.accessModes = [e.target.value];
              return d;
            })}
          >
            <option value="ReadWriteOnce">ReadWriteOnce</option>
            <option value="ReadWriteMany">ReadWriteMany</option>
            <option value="ReadOnlyMany">ReadOnlyMany</option>
          </select>
        </div>

        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-400 mb-1">
            Storage Class Name <span className="text-gray-500">(optional)</span>
          </label>
          <input
            type="text"
            placeholder="Leave empty for default"
            className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            value={doc.spec?.storageClassName ?? ''}
            onChange={e => updateDoc(d => {
              if (!d.spec) d.spec = {};
              if (e.target.value) {
                d.spec.storageClassName = e.target.value;
              } else {
                delete d.spec.storageClassName;
              }
              return d;
            })}
          />
        </div>
      </div>
    </div>
  );
}
