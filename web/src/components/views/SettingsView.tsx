import React, { useEffect, useState } from 'react';
import * as api from '../../api';

interface SettingsViewProps {
  onSaved: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onSaved }) => {
  const [defaultView, setDefaultView] = useState<'grid' | 'list'>('grid');
  const [retentionDays, setRetentionDays] = useState('30');
  const [quotaGb, setQuotaGb] = useState('5000');
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [system, setSystem] = useState<Awaited<ReturnType<typeof api.system>> | null>(null);
  const [apiKeys, setApiKeys] = useState<Awaited<ReturnType<typeof api.account.apiKeys.list>>['keys']>([]);
  const [apiKeyLabel, setApiKeyLabel] = useState('');
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const [createdApiKeyId, setCreatedApiKeyId] = useState<string | null>(null);
  const [apiKeyMessage, setApiKeyMessage] = useState<string | null>(null);
  const [apiKeysBusy, setApiKeysBusy] = useState(false);
  const [apiKeysLoading, setApiKeysLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([api.settings.get(), api.system()])
      .then(([settingsResult, systemResult]) => {
        if (!active) return;
        const settings = settingsResult.settings;
        if (settings.defaultView === 'grid' || settings.defaultView === 'list') setDefaultView(settings.defaultView);
        if (typeof settings.retentionDays === 'number') setRetentionDays(String(settings.retentionDays));
        if (typeof settings.quotaBytes === 'number') setQuotaGb(String(Math.round(settings.quotaBytes / 1_000_000_000)));
        setSystem(systemResult);
        setLoadError(null);
      })
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : 'تعذّر تحميل الإعدادات.'))
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    api.account.apiKeys.list()
      .then(({ keys }) => {
        if (active) setApiKeys(keys);
      })
      .catch((error: unknown) => {
        if (active) setApiKeyMessage(error instanceof Error ? error.message : 'Unable to load API keys.');
      })
      .finally(() => { if (active) setApiKeysLoading(false); });
    return () => { active = false; };
  }, []);

  const createApiKey = async (event: React.FormEvent) => {
    event.preventDefault();
    if (apiKeysBusy || !apiKeyLabel.trim() || createdApiKey) return;
    setApiKeysBusy(true);
    setApiKeyMessage(null);
    try {
      const result = await api.account.apiKeys.create(apiKeyLabel.trim());
      setCreatedApiKey(result.key);
      setCreatedApiKeyId(result.metadata.id);
      setApiKeyLabel('');
      setApiKeys((keys) => [result.metadata, ...keys]);
    } catch (error) {
      setApiKeyMessage(error instanceof Error ? error.message : 'Unable to create API key.');
    } finally {
      setApiKeysBusy(false);
    }
  };

  const revokeApiKey = async (id: string) => {
    setApiKeysBusy(true);
    setApiKeyMessage(null);
    try {
      await api.account.apiKeys.revoke(id);
      setApiKeys((keys) => keys.map((key) => key.id === id ? { ...key, revokedAt: Date.now() } : key));
      if (id === createdApiKeyId) {
        setCreatedApiKey(null);
        setCreatedApiKeyId(null);
      }
    } catch (error) {
      setApiKeyMessage(error instanceof Error ? error.message : 'Unable to revoke API key.');
    } finally {
      setApiKeysBusy(false);
    }
  };

  const [cookiesPresent, setCookiesPresent] = useState(false);
  const [cookiesText, setCookiesText] = useState('');
  const [cookiesBusy, setCookiesBusy] = useState(false);
  const [cookiesMsg, setCookiesMsg] = useState<string | null>(null);

  useEffect(() => {
    api.ytCookies.status().then((result) => setCookiesPresent(result.present)).catch((error: unknown) => {
      setCookiesMsg(error instanceof Error ? error.message : 'تعذّر فحص حالة الكوكيز.');
    });
  }, []);

  const saveCookies = async () => {
    setCookiesBusy(true);
    setCookiesMsg(null);
    try {
      const result = await api.ytCookies.save(cookiesText);
      setCookiesPresent(result.present);
      setCookiesText('');
      setCookiesMsg('تم حفظ الكوكيز.');
      onSaved();
    } catch (error) {
      setCookiesMsg(error instanceof Error ? error.message : 'تعذّر حفظ الكوكيز.');
    } finally {
      setCookiesBusy(false);
    }
  };

  const clearCookies = async () => {
    setCookiesBusy(true);
    setCookiesMsg(null);
    try {
      const result = await api.ytCookies.clear();
      setCookiesPresent(result.present);
      setCookiesMsg('حُذفت الكوكيز.');
    } catch (error) {
      setCookiesMsg(error instanceof Error ? error.message : 'تعذّر حذف الكوكيز.');
    } finally {
      setCookiesBusy(false);
    }
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const quotaBytes = Number(quotaGb) * 1_000_000_000;
      const days = Number(retentionDays);
      if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 1_000_000) throw new Error('أدخل حصة تخزين صالحة بالـ GB.');
      if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('فترة الاحتفاظ يجب أن تكون بين يوم و3650 يومًا.');
      await api.settings.save({ defaultView, retentionDays: days, quotaBytes });
      if (currentPassword || nextPassword) {
        if (!currentPassword || nextPassword.length < 8) throw new Error('أدخل كلمة المرور الحالية وكلمة مرور جديدة (8 محارف على الأقل).');
        await api.account.changePassword(currentPassword, nextPassword);
        setCurrentPassword('');
        setNextPassword('');
      }
      setMessage('حُفظت الإعدادات.');
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذّر حفظ الإعدادات.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative w-full px-8 py-6 space-y-8 max-w-[1200px] mx-auto">
      <div>
        <div className="flex items-center gap-1.5 text-outline font-mono text-xs uppercase tracking-wider mb-1"><span className="w-1.5 h-1.5 rounded-full bg-secondary-fixed-dim" /><span>Workspace configuration</span></div>
        <h1 className="text-3xl text-on-surface tracking-tight font-semibold">Workspace Settings</h1>
        <p className="text-sm text-outline mt-1">These settings are saved for this account and applied by the server.</p>
      </div>

      {loadError && <div role="alert" className="p-3 rounded-lg border border-error/30 bg-error-container/20 text-error text-sm flex justify-between gap-3"><span>{loadError}</span><button type="button" onClick={() => window.location.reload()} className="underline">Retry</button></div>}

      <div className="space-y-6">
        <section className="p-6 rounded-xl bg-surface-container-low border border-white/5 space-y-4 shadow-xl">
          <div><h2 className="text-base font-semibold text-on-surface">Storage & Display</h2><p className="text-xs text-outline mt-0.5">Quota is an application limit label; there is no external billing provider configured.</p></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1.5"><span className="block font-mono text-xs text-outline uppercase">Storage quota (decimal GB)</span><input form="workspace-settings" type="number" min="1" step="1" value={quotaGb} onChange={(event) => setQuotaGb(event.target.value)} className="w-full bg-surface-container-lowest border border-white/5 text-on-surface font-mono text-sm p-3 rounded-lg focus:outline-none focus:border-primary-container" /></label>
            <label className="space-y-1.5"><span className="block font-mono text-xs text-outline uppercase">Trash retention (days)</span><input form="workspace-settings" type="number" min="1" max="3650" step="1" value={retentionDays} onChange={(event) => setRetentionDays(event.target.value)} className="w-full bg-surface-container-lowest border border-white/5 text-on-surface font-mono text-sm p-3 rounded-lg focus:outline-none focus:border-primary-container" /></label>
          </div>
          <fieldset className="space-y-2"><legend className="font-mono text-xs text-outline uppercase">Default file layout</legend><div className="flex gap-3">
            {(['grid', 'list'] as const).map((view) => <label key={view} className={`px-4 py-2 rounded-lg border cursor-pointer ${defaultView === view ? 'border-primary-container bg-surface-container text-primary' : 'border-white/5 text-on-surface-variant'}`}><input form="workspace-settings" className="sr-only" type="radio" name="defaultView" value={view} checked={defaultView === view} onChange={() => setDefaultView(view)} />{view === 'grid' ? 'Grid' : 'List'}</label>)}
          </div></fieldset>
        </section>

        <section className="p-6 rounded-xl bg-surface-container-low border border-white/5 space-y-4 shadow-xl">
          <div><h2 className="text-base font-semibold text-on-surface">Change Password</h2><p className="text-xs text-outline mt-0.5">Changing the password revokes other active sessions.</p></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1.5"><span className="block font-mono text-xs text-outline">Current password</span><input form="workspace-settings" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="w-full bg-surface-container-lowest border border-white/5 text-on-surface p-3 rounded-lg focus:outline-none focus:border-primary-container" /></label>
            <label className="space-y-1.5"><span className="block font-mono text-xs text-outline">New password</span><input form="workspace-settings" type="password" autoComplete="new-password" minLength={8} value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} className="w-full bg-surface-container-lowest border border-white/5 text-on-surface p-3 rounded-lg focus:outline-none focus:border-primary-container" /></label>
          </div>
        </section>

        <section className="p-6 rounded-xl bg-surface-container-low border border-white/5 space-y-4 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="text-base font-semibold text-on-surface">Developer API keys</h2><p className="text-xs text-outline mt-0.5">Keys grant access to your files. The full value is shown only once.</p></div>
            <a href="/developers" target="_blank" rel="noreferrer" className="text-xs text-primary underline">API documentation</a>
          </div>
          <form aria-label="Create API key" onSubmit={(event) => void createApiKey(event)} className="space-y-2">
            <label htmlFor="api-key-label" className="block font-mono text-xs text-outline">API key label</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input id="api-key-label" required maxLength={100} disabled={apiKeysBusy} value={apiKeyLabel} onChange={(event) => setApiKeyLabel(event.target.value)} placeholder="Key label (e.g. backup script)" className="min-w-0 flex-1 bg-surface-container-lowest border border-white/5 text-on-surface p-3 rounded-lg focus:outline-none focus:border-primary-container" />
              <button type="submit" disabled={apiKeysLoading || apiKeysBusy || !!createdApiKey || !apiKeyLabel.trim()} className="min-h-11 px-4 py-2 rounded-lg bg-primary-container text-on-primary-container font-mono text-xs font-semibold disabled:opacity-50">{apiKeysBusy ? 'Working...' : 'Generate key'}</button>
            </div>
          </form>
          {createdApiKey && <div role="alert" className="space-y-2 rounded-lg border border-error/40 bg-error-container/10 p-3">
            <p className="text-xs text-error">Copy this key now. It cannot be displayed again.</p>
            <input aria-label="New API key" readOnly value={createdApiKey} onFocus={(event) => event.currentTarget.select()} className="w-full bg-surface-container-lowest border border-white/5 text-on-surface font-mono text-xs p-3 rounded-lg" />
            <button type="button" onClick={() => setCreatedApiKey(null)} className="text-xs text-outline underline">Hide key</button>
            <p className="text-xs text-outline">Hide this key after copying it to generate another.</p>
          </div>}
          <ul className="divide-y divide-white/5">
            {apiKeys.map((key) => <li key={key.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-on-surface">{key.label} <code className="ml-2 font-mono text-xs text-outline">{key.prefix}…</code></p>
                <p className="text-xs text-outline">{key.revokedAt ? 'Revoked' : key.lastUsedAt ? `Last used ${new Date(key.lastUsedAt).toLocaleString()}` : 'Not used yet'}</p>
              </div>
              {!key.revokedAt && <button type="button" disabled={apiKeysBusy} onClick={() => void revokeApiKey(key.id)} className="shrink-0 text-xs text-error underline disabled:opacity-50">Revoke</button>}
            </li>)}
            {apiKeysLoading && <li role="status" className="py-3 text-xs text-outline">Loading API keys...</li>}
            {!apiKeysLoading && !apiKeyMessage && apiKeys.length === 0 && <li className="py-3 text-xs text-outline">No API keys have been created.</li>}
          </ul>
          {apiKeyMessage && <p role="alert" className="text-sm text-error">{apiKeyMessage}</p>}
        </section>

        <section className="p-6 rounded-xl bg-surface-container-low border border-white/5 space-y-4 shadow-xl">
          <div><h2 className="text-base font-semibold text-on-surface">Runtime Configuration</h2><p className="text-xs text-outline mt-0.5">Read-only values reported by the backend.</p></div>
          {system ? <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            {[
              ['Content backend', system.contentBackend],
              ['Storage driver', system.storageDriver],
              ['FFmpeg', system.ffmpeg.installed ? 'Available' : 'Unavailable'],
              ['yt-dlp', system.ytdlp.installed ? system.ytdlp.version ?? 'Installed' : 'Unavailable'],
              ['Upload chunk size', `${system.chunkSizeMB} MB`],
              ['Maximum file size', system.maxFileSizeGB ? `${system.maxFileSizeGB} GB` : 'No configured cap'],
            ].map(([label, value]) => <div key={label} className="p-3 rounded-lg bg-surface-container"><span className="text-outline">{label}</span><span className="block mt-1 text-on-surface font-mono">{value}</span></div>)}
          </div> : <p className="text-sm text-outline">Loading server information…</p>}
        </section>

        <section className="p-6 rounded-xl bg-surface-container-low border border-white/5 space-y-4 shadow-xl">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-on-surface">YouTube cookies</h2><p className="text-xs text-outline mt-0.5">Optional integration setting for yt-dlp.</p></div><span className="font-mono text-xs text-secondary-fixed">{cookiesPresent ? 'Configured' : 'Not configured'}</span></div>
          <textarea value={cookiesText} onChange={(event) => setCookiesText(event.target.value)} dir="ltr" rows={4} placeholder="# Netscape HTTP Cookie File" className="w-full bg-surface-container-lowest border border-white/5 text-on-surface font-mono text-[11px] p-3 rounded-lg focus:outline-none focus:border-primary-container" />
          {cookiesMsg && <p role="status" className="text-xs text-outline">{cookiesMsg}</p>}
          <div className="flex items-center gap-3"><button type="button" onClick={() => void saveCookies()} disabled={cookiesBusy || cookiesText.trim().length < 10} className="px-4 py-2 rounded-lg bg-primary-container text-on-primary-container font-mono text-xs font-semibold disabled:opacity-50">{cookiesBusy ? 'Saving…' : 'Save cookies'}</button>{cookiesPresent && <button type="button" onClick={() => void clearCookies()} disabled={cookiesBusy} className="px-4 py-2 rounded-lg bg-surface-container-high text-on-surface-variant text-xs disabled:opacity-50">Remove cookies</button>}</div>
        </section>

        {message && <p role="status" className={`text-sm ${message.startsWith('حُفظ') ? 'text-secondary-fixed' : 'text-error'}`}>{message}</p>}
        <form id="workspace-settings" onSubmit={handleSave} className="flex items-center justify-end pt-2"><button type="submit" disabled={saving || !!loadError} className="px-6 py-2.5 bg-primary-container text-on-primary-container font-mono text-xs font-semibold rounded-lg shadow-lg disabled:opacity-50">{saving ? 'Saving…' : 'Save settings'}</button></form>
      </div>
    </div>
  );
};
