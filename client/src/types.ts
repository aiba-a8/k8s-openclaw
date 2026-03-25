export type DeployType = 'kubernetes' | 'local' | 'docker';

export interface Instance {
  name: string;
  files: string[];
  deployType?: DeployType;
  gatewayToken?: string;
  createdAt?: string;
}

export interface DeployOutput {
  lines: string[];
  status: 'running' | 'success' | 'error';
}

export type ViewMode = 'form' | 'yaml';

export type YamlFileName =
  | 'deployment.yaml'
  | 'service.yaml'
  | 'pvc.yaml'
  | 'configmap.yaml'
  | 'kustomization.yaml';

export const YAML_FILES: YamlFileName[] = [
  'deployment.yaml',
  'service.yaml',
  'pvc.yaml',
  'configmap.yaml',
  'kustomization.yaml',
];
