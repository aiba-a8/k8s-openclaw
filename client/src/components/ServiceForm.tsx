import React, { useMemo } from 'react';
import * as yaml from 'js-yaml';

interface ServiceFormProps {
  value: string;
  onChange: (newYaml: string) => void;
}

interface ServiceDoc {
  metadata?: { name?: string; labels?: Record<string, string> };
  spec?: {
    type?: string;
    selector?: Record<string, string>;
    ports?: Array<{
      name?: string;
      port?: number;
      targetPort?: number;
      protocol?: string;
    }>;
  };
}

export default function ServiceForm({ value, onChange }: ServiceFormProps) {
  const doc = useMemo(() => {
    try {
      return (yaml.load(value) as ServiceDoc) ?? {};
    } catch {
      return {} as ServiceDoc;
    }
  }, [value]);

  const updateDoc = (updater: (d: ServiceDoc) => ServiceDoc) => {
    try {
      const updated = updater(JSON.parse(JSON.stringify(doc)) as ServiceDoc);
      onChange(yaml.dump(updated, { lineWidth: -1 }));
    } catch {
      // ignore
    }
  };

  const firstPort = doc.spec?.ports?.[0];

  return (
    <div className="p-4 overflow-y-auto flex-1">
      <div className="grid grid-cols-2 gap-4 max-w-2xl">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-400 mb-1">Service Name</label>
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

        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-400 mb-1">Service Type</label>
          <select
            className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            value={doc.spec?.type ?? 'ClusterIP'}
            onChange={e => updateDoc(d => {
              if (!d.spec) d.spec = {};
              d.spec.type = e.target.value;
              return d;
            })}
          >
            <option value="ClusterIP">ClusterIP</option>
            <option value="NodePort">NodePort</option>
            <option value="LoadBalancer">LoadBalancer</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Port</label>
          <input
            type="number"
            min={1}
            max={65535}
            className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            value={firstPort?.port ?? 18789}
            onChange={e => updateDoc(d => {
              if (!d.spec) d.spec = {};
              if (!d.spec.ports) d.spec.ports = [{ port: 18789, targetPort: 18789, protocol: 'TCP' }];
              d.spec.ports[0] = { ...d.spec.ports[0], port: parseInt(e.target.value, 10) };
              return d;
            })}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Target Port</label>
          <input
            type="number"
            min={1}
            max={65535}
            className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            value={firstPort?.targetPort ?? 18789}
            onChange={e => updateDoc(d => {
              if (!d.spec) d.spec = {};
              if (!d.spec.ports) d.spec.ports = [{ port: 18789, targetPort: 18789, protocol: 'TCP' }];
              d.spec.ports[0] = { ...d.spec.ports[0], targetPort: parseInt(e.target.value, 10) };
              return d;
            })}
          />
        </div>
      </div>
    </div>
  );
}
