import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { getToken } from '../utils/auth';

export default function TerminalPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isConnectedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create terminal
    const term = new Terminal({
      theme: {
        background: '#0f1117',
        foreground: '#d4d4d4',
        cursor: '#aeafad',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5',
      },
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Small delay to ensure container is fully rendered
    setTimeout(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore
      }
    }, 50);

    // WebSocket connection
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = getToken() ?? '';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/terminal?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      isConnectedRef.current = true;
      try {
        fitAddon.fit();
        ws.send(JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows,
        }));
      } catch {
        // ignore
      }
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      term.write(event.data);
    };

    ws.onclose = () => {
      isConnectedRef.current = false;
      term.write('\r\n\x1b[31m[Connection closed]\x1b[0m\r\n');
    };

    ws.onerror = () => {
      term.write('\r\n\x1b[31m[Connection error - is the server running?]\x1b[0m\r\n');
    };

    // Forward terminal input to WebSocket
    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Send resize events
    term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    // ResizeObserver to fit terminal when container size changes
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
  }, []);

  const handleClear = () => {
    terminalRef.current?.clear();
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      <div className="flex items-center justify-end px-3 py-0.5 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <button
          onClick={handleClear}
          className="text-xs text-gray-400 hover:text-gray-200 px-2 py-0.5 rounded hover:bg-gray-700 transition-colors"
        >
          Clear
        </button>
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden p-2"
        style={{ background: '#0f1117' }}
      />
    </div>
  );
}
