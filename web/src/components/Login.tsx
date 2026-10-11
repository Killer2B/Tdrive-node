import React, { useState } from 'react';
import { auth } from '../api';

interface LoginProps {
  onSuccess: (user: { id: string; username: string; role: string }) => void;
}

export const Login: React.FC<LoginProps> = ({ onSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await auth.login(username.trim(), password);
      onSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4" dir="rtl">
      {/* ambient glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary-container/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md bg-surface-container-low border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-white/5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-container text-on-primary-container flex items-center justify-center shadow-md">
            <span className="material-symbols-outlined">lock</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-on-surface">Tdrive</h1>
            <p className="font-mono text-xs text-outline">سحابتك الشخصية الخاصّة</p>
          </div>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="font-mono text-xs text-outline uppercase tracking-wider">اسم المستخدم</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              className="mt-1.5 w-full bg-surface-container-lowest border border-white/10 rounded-lg px-3 py-2.5 text-on-surface outline-none focus:border-primary-container transition-colors"
            />
          </div>
          <div>
            <label className="font-mono text-xs text-outline uppercase tracking-wider">كلمة المرور</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="mt-1.5 w-full bg-surface-container-lowest border border-white/10 rounded-lg px-3 py-2.5 text-on-surface outline-none focus:border-primary-container transition-colors"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-error text-sm bg-error-container/20 border border-error/20 rounded-lg px-3 py-2">
              <span className="material-symbols-outlined text-base">error</span>
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full py-2.5 rounded-lg bg-primary-container text-on-primary-container font-medium hover:bg-secondary-container hover:text-on-secondary-fixed-variant transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="material-symbols-outlined animate-spin text-xl">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-xl">login</span>
            )}
            <span>دخول</span>
          </button>
        </form>
      </div>
    </div>
  );
};
