import React, { useEffect, useState } from 'react';
import * as api from '../../api';

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentQuotaTB: number;
  usedBytes: number;
  onUpgraded: (quotaTB: number) => void;
}

export const UpgradeModal: React.FC<UpgradeModalProps> = ({ isOpen, onClose, currentQuotaTB, usedBytes, onUpgraded }) => {
  const [quotaGb, setQuotaGb] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuotaGb(String(Math.round(currentQuotaTB * 1000)));
      setError(null);
    }
  }, [isOpen, currentQuotaTB]);

  if (!isOpen) return null;
  const usedGb = usedBytes / 1_000_000_000;
  const save = async () => {
    const nextGB = Number(quotaGb);
    if (!Number.isSafeInteger(nextGB) || nextGB < Math.ceil(usedGb)) {
      setError(`Quota must be a whole number at least ${Math.ceil(usedGb)} GB.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.settings.save({ quotaBytes: nextGB * 1_000_000_000 });
      onUpgraded(nextGB / 1000);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the storage quota.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface-container-low border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-5 bg-surface-container border-b border-white/5 flex items-center justify-between"><div><h2 className="text-lg font-semibold text-on-surface">Storage quota</h2><p className="text-xs text-outline">Local quota setting · no payment is processed.</p></div><button type="button" onClick={onClose} disabled={saving} className="text-outline hover:text-on-surface"><span className="material-symbols-outlined">close</span></button></div>
        <div className="p-6 space-y-4">
          <div className="p-4 rounded-lg bg-surface-container text-sm text-outline">Current usage: <strong className="text-on-surface">{api.formatSize(usedBytes)}</strong></div>
          <label className="block text-xs font-mono text-outline">New quota (decimal GB)<input type="number" min={Math.ceil(usedGb)} step="1" value={quotaGb} onChange={(event) => setQuotaGb(event.target.value)} className="mt-2 w-full bg-surface-container-lowest border border-white/5 text-on-surface font-mono text-sm p-3 rounded-lg focus:outline-none focus:border-primary-container" /></label>
          {error && <p role="alert" className="text-sm text-error">{error}</p>}
        </div>
        <div className="p-4 bg-surface-container border-t border-white/5 flex justify-end gap-3"><button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg bg-surface-container-high text-on-surface text-xs">Cancel</button><button type="button" onClick={() => void save()} disabled={saving} className="px-5 py-2.5 rounded-lg bg-primary-container text-on-primary-container font-semibold text-xs disabled:opacity-50">{saving ? 'Saving…' : 'Save quota'}</button></div>
      </div>
    </div>
  );
};
