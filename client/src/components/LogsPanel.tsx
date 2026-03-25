import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { authHeaders } from '../utils/auth';

interface LogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error';
  tag: string;
  message: string;
  data?: unknown;
}

interface Props {
  instanceName: string | null;
  isDeploying?: boolean;
}

export default function LogsPanel({ instanceName, isDeploying }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [deployLines, setDeployLines] = useState<string[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // OpenClaw logs
  const loadOcLogs = useCallback(() => {
    if (!instanceName || isDeploying) return;
    fetch(`/api/instances/${instanceName}/openclaw/logs`, { headers: authHeaders() })
      .then(r => r.json())
      .then((d: { logs: LogEntry[] }) => setLogs(d.logs))
      .catch(() => {});
  }, [instanceName, isDeploying]);

  // Deploy logs
  const loadDeployLogs = useCallback(() => {
    if (!instanceName || !isDeploying) return;
    fetch(`/api/instances/${instanceName}/deploy-logs`, { headers: authHeaders() })
      .then(r => r.json())
      .then((d: { lines: string[] }) => setDeployLines(d.lines))
      .catch(() => {});
  }, [instanceName, isDeploying]);

  useEffect(() => {
    setLogs([]);
    setDeployLines([]);
    loadOcLogs();
  }, [instanceName, loadOcLogs]);

  useEffect(() => {
    if (isDeploying) {
      setDeployLines([]);
      loadDeployLogs();
    }
  }, [isDeploying, loadDeployLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(isDeploying ? loadDeployLogs : loadOcLogs, 1500);
    return () => clearInterval(t);
  }, [autoRefresh, isDeploying, loadOcLogs, loadDeployLogs]);

  useEffect(() => {
    if (autoRefresh) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, deployLines, autoRefresh]);

  const levelColor = (level: LogEntry['level']) => {
    if (level === 'error') return 'text-red-400';
    if (level === 'warn') return 'text-yellow-400';
    return 'text-gray-400';
  };

  const tagColor = (tag: string) => {
    if (tag === 'connect') return 'text-green-400';
    if (tag === 'rpc') return 'text-blue-400';
    return 'text-purple-400';
  };

  const fmt = (ts: number) =>
    new Date(ts).toLocaleTimeString('en-US', {
      hour12: false, hour: '2-digit', minute: '2-digit',
      second: '2-digit', fractionalSecondDigits: 3,
    });

  const deployLineColor = (line: string) => {
    if (line.startsWith('✓') || line.includes('configured') || line.includes('created') || line.includes('unchanged')) return 'text-green-400';
    if (line.startsWith('✗') || line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')) return 'text-red-400';
    if (line.startsWith('▶')) return 'text-blue-300 font-semibold';
    return 'text-gray-300';
  };

  if (!instanceName) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-xs">
        Select an instance to view logs
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-3 py-1 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <span className="text-xs text-gray-500 flex items-center gap-1.5">
          {isDeploying && <Loader2 size={11} className="animate-spin text-blue-400" />}
          {isDeploying ? (
            <span className="text-blue-400">Deploy output — {instanceName}</span>
          ) : (
            <span>{instanceName} · {logs.length} entries</span>
          )}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              className="accent-blue-500"
            />
            Auto
          </label>
          <button onClick={isDeploying ? loadDeployLogs : loadOcLogs} className="text-gray-400 hover:text-gray-200">
            <RefreshCw size={12} />
          </button>
          {!isDeploying && (
            <button
              onClick={() => setLogs([])}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto font-mono text-xs p-1">
        {isDeploying ? (
          <>
            {deployLines.length === 0 && (
              <p className="text-gray-600 text-center py-4">Waiting for deploy output...</p>
            )}
            {deployLines.filter(l => l.trim()).map((line, i) => (
              <div key={i} className={`leading-5 px-1 py-0.5 whitespace-pre-wrap ${deployLineColor(line)}`}>
                {line || '\u00A0'}
              </div>
            ))}
          </>
        ) : (
          <>
            {logs.length === 0 && (
              <p className="text-gray-600 text-center py-4">
                No logs yet — connect to OpenClaw to see activity here.
              </p>
            )}
            {logs.map((entry, i) => (
              <div key={i}>
                <div
                  className="flex items-start gap-2 px-1 py-0.5 rounded hover:bg-gray-800/70 cursor-pointer"
                  onClick={() => setExpanded(expanded === i ? null : i)}
                >
                  <span className="text-gray-600 flex-shrink-0 tabular-nums">{fmt(entry.ts)}</span>
                  <span className={`flex-shrink-0 font-bold uppercase text-[10px] w-9 ${levelColor(entry.level)}`}>
                    {entry.level}
                  </span>
                  <span className={`flex-shrink-0 w-14 ${tagColor(entry.tag)}`}>[{entry.tag}]</span>
                  <span className="text-gray-300 flex-1 break-all leading-relaxed">{entry.message}</span>
                  {entry.data !== undefined && (
                    <span className="text-gray-600 flex-shrink-0 text-[10px]">{expanded === i ? '▲' : '▼'}</span>
                  )}
                </div>
                {expanded === i && entry.data !== undefined && (
                  <div className="mx-2 mb-1 p-2 bg-gray-950 rounded border border-gray-700 text-[11px] text-gray-300 overflow-x-auto whitespace-pre leading-relaxed">
                    {JSON.stringify(entry.data, null, 2)}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
