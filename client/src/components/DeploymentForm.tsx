import React, { useMemo } from 'react';
import * as yaml from 'js-yaml';

interface DeploymentFormProps {
  value: string;
  onChange: (newYaml: string) => void;
}

interface DeploymentDoc {
  metadata?: { name?: string };
  spec?: {
    replicas?: number;
    template?: {
      spec?: {
        containers?: Array<{
          image?: string;
          resources?: {
            requests?: { memory?: string; cpu?: string };
            limits?: { memory?: string; cpu?: string };
          };
        }>;
        initContainers?: Array<{ image?: string }>;
      };
    };
  };
}

function getField(doc: DeploymentDoc, path: string[]): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = doc;
  for (const key of path) {
    if (cur == null) return '';
    cur = cur[key];
  }
  return cur != null ? String(cur) : '';
}

function setField(doc: DeploymentDoc, path: string[], value: unknown): DeploymentDoc {
  const result = JSON.parse(JSON.stringify(doc)) as DeploymentDoc;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = result;
  for (let i = 0; i < path.length - 1; i++) {
    if (cur[path[i]] == null) cur[path[i]] = {};
    cur = cur[path[i]];
  }
  cur[path[path.length - 1]] = value;
  return result;
}

export default function DeploymentForm({ value, onChange }: DeploymentFormProps) {
  const doc = useMemo(() => {
    try {
      return (yaml.load(value) as DeploymentDoc) ?? {};
    } catch {
      return {} as DeploymentDoc;
    }
  }, [value]);

  const handleChange = (path: string[], newValue: unknown) => {
    try {
      const updated = setField(doc, path, newValue);
      onChange(yaml.dump(updated, { lineWidth: -1 }));
    } catch {
      // silently ignore parse errors
    }
  };

  const container = doc.spec?.template?.spec?.containers?.[0] ?? {};
  const initContainer = doc.spec?.template?.spec?.initContainers?.[0] ?? {};

  return (
    <div className="p-4 overflow-y-auto flex-1">
      <div className="grid grid-cols-2 gap-4 max-w-2xl">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-400 mb-1">Instance Name</label>
          <input
            type="text"
            className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            value={getField(doc, ['metadata', 'name'])}
            onChange={e => handleChange(['metadata', 'name'], e.target.value)}
          />
        </div>

        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-400 mb-1">Container Image</label>
          <input
            type="text"
            className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            value={container.image ?? ''}
            onChange={e => handleChange(['spec', 'template', 'spec', 'containers', '0', 'image'], e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Replicas</label>
          <input
            type="number"
            min={0}
            className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            value={doc.spec?.replicas ?? 1}
            onChange={e => handleChange(['spec', 'replicas'], parseInt(e.target.value, 10))}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Init Container Image</label>
          <input
            type="text"
            className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            value={initContainer.image ?? ''}
            onChange={e => handleChange(['spec', 'template', 'spec', 'initContainers', '0', 'image'], e.target.value)}
          />
        </div>

        <div className="col-span-2">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 border-b border-gray-700 pb-1">
            Resources
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Memory Request</label>
          <input
            type="text"
            placeholder="e.g. 4Gi"
            className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            value={container.resources?.requests?.memory ?? ''}
            onChange={e => handleChange(['spec', 'template', 'spec', 'containers', '0', 'resources', 'requests', 'memory'], e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Memory Limit</label>
          <input
            type="text"
            placeholder="e.g. 4Gi"
            className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            value={container.resources?.limits?.memory ?? ''}
            onChange={e => handleChange(['spec', 'template', 'spec', 'containers', '0', 'resources', 'limits', 'memory'], e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">CPU Request</label>
          <input
            type="text"
            placeholder="e.g. 250m"
            className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            value={container.resources?.requests?.cpu ?? ''}
            onChange={e => handleChange(['spec', 'template', 'spec', 'containers', '0', 'resources', 'requests', 'cpu'], e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">CPU Limit</label>
          <input
            type="text"
            placeholder="e.g. 1"
            className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            value={container.resources?.limits?.cpu ?? ''}
            onChange={e => handleChange(['spec', 'template', 'spec', 'containers', '0', 'resources', 'limits', 'cpu'], e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
