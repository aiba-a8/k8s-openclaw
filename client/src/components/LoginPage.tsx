import React, { useState } from 'react';
import { KeyRound, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { verifyToken, saveToken } from '../utils/auth';

interface LoginPageProps {
  onLogin: () => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;

    setLoading(true);
    setError(null);

    const ok = await verifyToken(token.trim());
    if (ok) {
      saveToken(token.trim());
      onLogin();
    } else {
      setError('Token 无效，请检查后重试');
    }
    setLoading(false);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-900">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
            <span className="text-3xl">⚓</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-100">K8s OpenClaw</h1>
          <p className="text-sm text-gray-500 mt-1">请输入访问 Token 继续</p>
        </div>

        {/* Form */}
        <form onSubmit={(e) => void handleSubmit(e)} className="bg-gray-800 rounded-xl border border-gray-700 p-6 shadow-2xl">
          <div className="mb-5">
            <label className="block text-xs font-medium text-gray-400 mb-2">
              Access Token
            </label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => { setToken(e.target.value); setError(null); }}
                placeholder="输入 Token..."
                autoFocus
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2.5 pr-10 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors font-mono"
              />
              <button
                type="button"
                onClick={() => setShowToken(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
              >
                {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="text-xs text-gray-600 mt-1.5">
              Token 请与管理员联系获取
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-red-900/30 border border-red-700/50 rounded-lg text-sm text-red-400">
              <AlertCircle size={14} className="flex-shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !token.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-blue-400 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {loading ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                验证中...
              </>
            ) : (
              <>
                <KeyRound size={15} />
                登录
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
