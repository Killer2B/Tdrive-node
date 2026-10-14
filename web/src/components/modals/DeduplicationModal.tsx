import React, { useEffect, useMemo, useState } from 'react';
import * as api from '../../api';

interface DeduplicationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPurged: (freedBytes: number) => void;
}

type DedupResponse = Awaited<ReturnType<typeof api.stats.dedup>>;

export const DeduplicationModal: React.FC<DeduplicationModalProps> = ({ isOpen, onClose, onPurged }) => {
  const [result, setResult] = useState<DedupResponse | null>(null);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedBytes = useMemo(
    () => result?.groups.flatMap((group) => group.duplicates).filter((file) => selectedItems.includes(file.id)).reduce((sum, file) => sum + file.sizeBytes, 0) ?? 0,
    [result, selectedItems],
  );

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.stats.dedup();
      setResult(response);
      setSelectedItems(response.groups.flatMap((group) => group.duplicates.map((file) => file.id)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر تحميل بيانات التكرار.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen]);

  if (!isOpen) return null;

  const toggle = (id: string) => setSelectedItems((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const purge = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      const response = await api.stats.purgeDuplicates(selectedItems);
      onPurged(response.freedBytes);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر حذف النسخ المحددة.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[90vh] bg-surface-container-low border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="p-5 bg-surface-container flex items-center justify-between border-b border-white/5">
          <div><h2 className="text-lg font-semibold text-on-surface">Duplicate File Review</h2><p className="font-mono text-xs text-outline">Matching SHA-256 hashes from stored file records.</p></div>
          <button type="button" onClick={onClose} disabled={isProcessing} className="p-1 rounded-lg text-outline hover:text-on-surface"><span className="material-symbols-outlined">close</span></button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="p-4 rounded-xl bg-surface-container border border-white/5 flex items-center justify-between gap-3">
            <div><span className="text-xs font-mono uppercase tracking-wider text-outline">Selected reclaimable space</span><div className="text-2xl font-bold text-secondary-fixed">{api.formatSize(selectedBytes)}</div></div>
            <span className="font-mono text-xs text-outline">{selectedItems.length} selected</span>
          </div>
          {error && <div role="alert" className="p-3 rounded-lg border border-error/30 text-error text-sm flex justify-between gap-3"><span>{error}</span><button type="button" onClick={() => void load()} className="underline">Retry</button></div>}
          {isLoading ? <div className="py-8 text-center text-sm text-outline">Loading duplicate groups…</div> : result?.groups.length ? result.groups.map((group) => (
            <div key={group.sha256} className="space-y-2">
              <div className="p-3 rounded-lg bg-surface-container text-xs">
                <span className="text-outline">Keep original</span><span className="block text-on-surface font-mono mt-1">{group.keep.name} · {api.formatSize(group.keep.sizeBytes)}</span>
              </div>
              {group.duplicates.map((file) => (
                <label key={file.id} className="p-3 rounded-xl bg-surface-container-lowest border border-white/5 flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={selectedItems.includes(file.id)} onChange={() => toggle(file.id)} className="mt-1 accent-primary-container" />
                  <span className="min-w-0 flex-1"><span className="block text-sm text-on-surface truncate">{file.name}</span><span className="block font-mono text-xs text-outline">{file.type} · {api.formatSize(file.sizeBytes)} · SHA-256 {group.sha256.slice(0, 16)}…</span></span>
                </label>
              ))}
            </div>
          )) : !isLoading && !error ? <div className="py-12 text-center text-sm text-outline">No duplicate file hashes were found.</div> : null}
        </div>
        <div className="p-4 bg-surface-container border-t border-white/5 flex items-center justify-between gap-3">
          <button type="button" onClick={onClose} disabled={isProcessing} className="px-4 py-2 rounded-lg bg-surface-container-high text-on-surface text-xs">Close</button>
          <button type="button" onClick={() => void purge()} disabled={!selectedItems.length || isProcessing || isLoading} className="px-5 py-2.5 rounded-lg bg-primary-container text-on-primary-container font-semibold text-xs disabled:opacity-40">
            {isProcessing ? 'Removing selected files…' : `Delete selected · ${api.formatSize(selectedBytes)}`}
          </button>
        </div>
      </div>
    </div>
  );
};
