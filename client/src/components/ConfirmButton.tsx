import React, { useState, useEffect, useRef } from 'react';
import { Trash2, Check, X } from 'lucide-react';

interface Props {
  onConfirm: () => void;
  label?: string;           // tooltip / aria-label
  size?: number;            // icon size, default 13
  className?: string;       // extra classes on the idle button
  timeout?: number;         // ms before auto-cancel, default 3000
}

/**
 * Two-step delete button.
 * First click → shows inline ✓ / ✗ confirmation.
 * Clicking ✓ fires onConfirm; ✗ or timeout cancels.
 */
export default function ConfirmButton({
  onConfirm,
  label = 'Delete',
  size = 13,
  className = 'text-gray-500 hover:text-red-400',
  timeout = 3000,
}: Props) {
  const [pending, setPending] = useState(false);
  const timerRef = useRef<NodeJS.Timeout>();

  const start = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPending(true);
    timerRef.current = setTimeout(() => setPending(false), timeout);
  };

  const confirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearTimeout(timerRef.current);
    setPending(false);
    onConfirm();
  };

  const cancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearTimeout(timerRef.current);
    setPending(false);
  };

  useEffect(() => () => clearTimeout(timerRef.current), []);

  if (pending) {
    return (
      <span className="inline-flex items-center gap-0.5">
        <button
          onClick={confirm}
          title="Confirm delete"
          className="p-0.5 rounded text-red-400 hover:text-red-300 hover:bg-red-900/30 transition-colors"
        >
          <Check size={size} />
        </button>
        <button
          onClick={cancel}
          title="Cancel"
          className="p-0.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
        >
          <X size={size} />
        </button>
      </span>
    );
  }

  return (
    <button onClick={start} title={label} className={`transition-colors ${className}`}>
      <Trash2 size={size} />
    </button>
  );
}
