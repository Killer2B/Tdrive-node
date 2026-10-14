import React, { useEffect, useState } from 'react';
import { ExternalLink } from '../../types';
import * as api from '../../api';

interface CreateShareDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (newLink: ExternalLink) => void;
  target?: { fileId?: string; name?: string };
}

export const CreateShareDrawer: React.FC<CreateShareDrawerProps> = ({ isOpen, onClose, onCreated, target }) => {
  const [singleDownload, setSingleDownload] = useState(false);
  const [password, setPassword] = useState('');
  const [ipAllow, setIpAllow] = useState('');
  const [expiry, setExpiry] = useState('7 Days');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableFiles, setAvailableFiles] = useState<api.ApiFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState('');
  const [filesReload, setFilesReload] = useState(0);

  useEffect(() => {
    if (!isOpen || target?.fileId) return;
    let active = true;
    setFilesLoading(true);
    setFilesError(null);
    api.files.list({ view: 'all' })
      .then(({ files }) => {
        if (!active) return;
        const shareableFiles = files.filter((file) => file.type !== 'folder' && file.status === 'ready');
        setAvailableFiles(shareableFiles);
        setSelectedFileId((current) => shareableFiles.some((file) => file.id === current) ? current : shareableFiles[0]?.id ?? '');
      })
      .catch((cause: unknown) => {
        if (active) setFilesError(cause instanceof Error ? cause.message : 'Could not load files.');
      })
      .finally(() => { if (active) setFilesLoading(false); });
    return () => { active = false; };
  }, [isOpen, target?.fileId, filesReload]);

  if (!isOpen) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const fileId = target?.fileId ?? selectedFileId;
    if (!fileId) {
      setError('Choose a file from the file list before creating a share.');
      return;
    }
    setSaving(true);
    try {
      const expiresDays = expiry === 'No expiry' ? undefined : expiry === '24 Hours' ? 1 : expiry === '7 Days' ? 7 : 30;
      const result = await api.shares.create({
        fileId,
        password: password.trim() || undefined,
        expiresDays,
        maxDownloads: singleDownload ? 1 : undefined,
        label: target?.name ?? availableFiles.find((file) => file.id === fileId)?.name,
        ipAllow: ipAllow.trim() || undefined,
      });
      onCreated(result.link);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the share.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-md z-50 flex justify-end animate-in fade-in duration-200">
      <section className="w-full max-w-xl bg-surface-container-low border-l border-white/10 shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-300">
        <div className="p-5 bg-surface-container flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary-container text-on-primary-container flex items-center justify-center shadow-md">
              <span className="material-symbols-outlined text-lg">share</span>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-on-surface">Create secure share</h3>
              <span className="font-mono text-xs text-outline">Configure file access and expiration</span>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="p-1 rounded-lg hover:bg-surface-container-high text-outline hover:text-on-surface transition-colors">
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="space-y-1.5">
            <label className="block font-mono text-xs text-on-surface-variant uppercase tracking-wider">File to share</label>
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-surface-container-lowest border border-white/5">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-primary text-2xl">insert_drive_file</span>
                <div>
                  {target?.fileId ? (
                    <>
                      <span className="text-sm font-medium text-on-surface block">{target.name}</span>
                      <span className="font-mono text-xs text-outline">Ready to share</span>
                    </>
                  ) : (
                    <select value={selectedFileId} onChange={(event) => setSelectedFileId(event.target.value)} disabled={filesLoading || !availableFiles.length} className="max-w-64 bg-transparent text-sm font-medium text-on-surface focus:outline-none">
                      {!availableFiles.length && <option value="">{filesLoading ? 'Loading files…' : 'No files available'}</option>}
                      {availableFiles.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}
                    </select>
                  )}
                </div>
              </div>
              <span className="font-mono text-xs text-secondary-fixed bg-surface-container-high px-2 py-0.5 rounded">{target?.fileId || selectedFileId ? 'Selected' : '—'}</span>
            </div>
            {filesError && <div role="alert" className="flex justify-between gap-3 text-xs text-error"><span>{filesError}</span><button type="button" onClick={() => setFilesReload((value) => value + 1)} className="underline">Retry</button></div>}
            <p className="font-mono text-xs text-outline">The server will generate a unique share URL after creation.</p>
          </div>

          <section className="space-y-3">
            <span className="font-mono text-xs text-outline uppercase tracking-wider">Access controls</span>
            <label className="block p-3.5 rounded-xl bg-surface-container border border-white/5 space-y-2">
              <span className="text-sm font-medium text-on-surface flex items-center gap-1.5">
                <span className="material-symbols-outlined text-primary text-lg">password</span> Optional password
              </span>
              <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} maxLength={256} className="w-full bg-surface-container-lowest text-on-surface font-mono text-sm px-3 py-2 rounded-lg border border-white/5 focus:outline-none focus:border-primary-container" placeholder="Set a password" />
              <span className="block text-xs text-outline">The server stores a password hash, not the plain-text password.</span>
            </label>

            <label className="block p-3.5 rounded-xl bg-surface-container border border-white/5 space-y-2">
              <span className="text-sm font-medium text-on-surface flex items-center gap-1.5">
                <span className="material-symbols-outlined text-outline text-lg">lan</span> IP addresses or CIDR ranges
              </span>
              <input type="text" value={ipAllow} onChange={(event) => setIpAllow(event.target.value)} maxLength={4096} className="w-full bg-surface-container-lowest text-on-surface font-mono text-sm px-3 py-2 rounded-lg border border-white/5 focus:outline-none focus:border-primary-container placeholder:text-outline" placeholder="e.g. 192.168.1.5, 192.168.1.0/24" />
              <span className="block text-xs text-outline">Comma-separated IPs or CIDR ranges. Leave blank to allow any IP.</span>
            </label>

            <label className="flex items-center justify-between p-3.5 rounded-xl bg-surface-container border border-white/5 cursor-pointer">
              <span>
                <span className="block text-sm font-medium text-on-surface">Limit to one download</span>
                <span className="block text-xs text-outline">The download limit is used when a download begins.</span>
              </span>
              <input type="checkbox" checked={singleDownload} onChange={(event) => setSingleDownload(event.target.checked)} className="w-4 h-4 accent-primary-container" />
            </label>
          </section>

          <fieldset className="space-y-2">
            <legend className="font-mono text-xs text-outline uppercase tracking-wider">Link expiration</legend>
            <div className="grid grid-cols-4 gap-2">
              {['24 Hours', '7 Days', '30 Days', 'No expiry'].map((duration) => (
                <button type="button" key={duration} onClick={() => setExpiry(duration)} className={`py-2 rounded font-mono text-xs text-center transition-colors ${expiry === duration ? 'bg-primary-container text-on-primary-container font-semibold shadow-sm' : 'bg-surface-container text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'}`}>
                  {duration}
                </button>
              ))}
            </div>
          </fieldset>

          {error && <div role="alert" className="flex items-center gap-2 text-error text-sm bg-error-container/20 border border-error/20 rounded-lg px-3 py-2"><span className="material-symbols-outlined text-base">error</span><span>{error}</span></div>}

          <div className="p-5 bg-surface-container border-t border-white/5 flex items-center justify-between gap-4 -mx-6 -mb-6 mt-6">
            <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface font-mono text-xs transition-colors">Cancel</button>
            <button type="submit" disabled={saving || (!target?.fileId && (!selectedFileId || filesLoading || !!filesError))} className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-container hover:bg-secondary-container hover:text-on-secondary-fixed-variant text-on-primary-container font-semibold text-sm rounded-lg shadow-lg shadow-primary-container/20 transition-all disabled:opacity-50">
              <span className={`material-symbols-outlined text-base ${saving ? 'animate-spin' : ''}`}>{saving ? 'sync' : 'share'}</span>
              <span>{saving ? 'Creating share…' : 'Create share'}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
