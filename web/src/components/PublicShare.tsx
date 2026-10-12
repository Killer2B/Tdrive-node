import React, { useEffect, useState } from 'react';
import * as api from '../api';
import { VideoPlayer } from './VideoPlayer';

const REASONS: Record<string, string> = {
  notfound: 'الرابط غير صالح أو تمّ إلغاؤه.',
  expired: 'انتهت صلاحية هذا الرابط.',
  exhausted: 'استُنفد الحدّ الأقصى لتنزيلات هذا الرابط.',
};

export const PublicShare: React.FC<{ token: string }> = ({ token }) => {
  const [meta, setMeta] = useState<api.PublicMeta | null>(null);
  const [pw, setPw] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = async (password?: string) => {
    setLoading(true);
    try {
      setMeta(await api.publicShare.meta(token, password));
    } catch {
      setMeta({ ok: false, reason: 'notfound', hasPassword: false });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [token]);

  const submitPw = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    await load(pw);
    setSubmitting(false);
  };

  const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4" dir="rtl">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary-container/10 blur-3xl" />
      </div>
      <div className="relative w-full max-w-2xl bg-surface-container-low border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-5 border-b border-white/5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary-container text-on-primary-container flex items-center justify-center shadow-md">
            <span className="material-symbols-outlined">lock</span>
          </div>
          <div>
            <h1 className="text-base font-semibold text-on-surface">Tdrive</h1>
            <p className="font-mono text-xs text-outline">مشاركة آمنة</p>
          </div>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-10 text-outline">
          <span className="material-symbols-outlined animate-spin text-3xl">progress_activity</span>
        </div>
      </Shell>
    );
  }

  if (!meta) return null;

  if (meta.needsPassword) {
    return (
      <Shell>
        <form onSubmit={submitPw} className="space-y-4">
          <p className="text-on-surface-variant text-sm">هذا الرابط محميّ بكلمة مرور.</p>
          {meta.wrong && (
            <div className="flex items-center gap-2 text-error text-sm">
              <span className="material-symbols-outlined text-base">error</span>
              <span>كلمة المرور غير صحيحة.</span>
            </div>
          )}
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
            placeholder="كلمة المرور"
            className="w-full bg-surface-container-lowest border border-white/10 rounded-lg px-3 py-2.5 text-on-surface outline-none focus:border-primary-container"
          />
          <button
            type="submit"
            disabled={submitting || !pw}
            className="w-full py-2.5 rounded-lg bg-primary-container text-on-primary-container font-medium hover:bg-secondary-container hover:text-on-secondary-fixed-variant transition-all disabled:opacity-50"
          >
            فتح
          </button>
        </form>
      </Shell>
    );
  }

  if (!meta.ok) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
          <span className="material-symbols-outlined text-5xl text-error">link_off</span>
          <p className="text-on-surface">{REASONS[meta.reason ?? 'notfound'] ?? 'تعذّر فتح الرابط.'}</p>
        </div>
      </Shell>
    );
  }

  const streamUrl = api.publicShare.streamUrl(token, meta.hasPassword ? pw : undefined);
  const downloadUrl = api.publicShare.downloadUrl(token, meta.hasPassword ? pw : undefined);

  return (
    <Shell>
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-on-surface break-all">{meta.name}</h2>
          <p className="font-mono text-xs text-outline mt-1">
            {meta.type} · {api.formatSize(meta.sizeBytes)}
          </p>
        </div>

        {meta.isVideo ? (
          <VideoPlayer src={streamUrl} />
        ) : meta.isImage ? (
          <img src={streamUrl} alt={meta.name} className="w-full rounded-xl border border-white/10 bg-black object-contain max-h-[70vh]" />
        ) : (
          <div className="rounded-xl border border-white/10 bg-surface-container flex flex-col items-center justify-center gap-2 py-12 text-outline">
            <span className="material-symbols-outlined text-5xl">draft</span>
            <span className="text-xs">ملف جاهز للتنزيل</span>
          </div>
        )}

        <a
          href={downloadUrl}
          className="w-full py-2.5 rounded-lg bg-primary-container text-on-primary-container font-medium hover:bg-secondary-container hover:text-on-secondary-fixed-variant transition-all flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined">download</span>
          تنزيل
        </a>
      </div>
    </Shell>
  );
};
