import React from 'react';
import Editor from '@monaco-editor/react';

interface YamlFileEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export default function YamlFileEditor({ value, onChange }: YamlFileEditorProps) {
  return (
    <div className="h-full w-full overflow-hidden">
      <Editor
        height="100%"
        language="yaml"
        theme="vs-dark"
        value={value}
        onChange={(val) => onChange(val ?? '')}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          automaticLayout: true,
          tabSize: 2,
          insertSpaces: true,
          folding: true,
          renderWhitespace: 'boundary',
          padding: { top: 8, bottom: 8 },
        }}
      />
    </div>
  );
}
