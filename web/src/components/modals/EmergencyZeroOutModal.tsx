import React, { useState } from 'react';

interface EmergencyZeroOutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onWipeExecuted: () => Promise<void>;
}

export const EmergencyZeroOutModal: React.FC<EmergencyZeroOutModalProps> = ({ isOpen, onClose, onWipeExecuted }) => {
  const [confirmInput, setConfirmInput] = useState('');
  const [isWiping, setIsWiping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;
  const confirmed = confirmInput.trim() === 'WIPE-CONFIRM';
  const wipe = async () => {
    if (!confirmed || isWiping) return;
    setIsWiping(true);
    setError(null);
    try {
      await onWipeExecuted();
      setConfirmInput('');
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر إلغاء الجلسات والمشاركات.');
    } finally {
      setIsWiping(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-surface-container-low border border-error/30 rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-5 bg-error-container/20 border-b border-error/20 flex items-center justify-between">
          <div><h2 className="text-lg font-bold text-error">Revoke All Peer Access</h2><p className="font-mono text-xs text-outline">This action affects other sessions and every active share link.</p></div>
          <button type="button" onClick={onClose} disabled={isWiping} className="p-1 rounded-lg text-outline hover:text-on-surface"><span className="material-symbols-outlined">close</span></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="p-4 rounded-xl bg-surface-container border border-error/20 text-sm text-on-surface-variant space-y-2">
            <p className="text-error font-semibold">The server will immediately:</p>
            <ul className="list-disc pl-5 space-y-1 text-outline"><li>Delete every other active login session for this account.</li><li>Revoke all active public share links.</li><li>Keep this session and leave stored files unchanged.</li></ul>
          </div>
          <label className="block font-mono text-xs text-outline">Type <span className="text-error font-bold">WIPE-CONFIRM</span> to continue:
            <input type="text" value={confirmInput} onChange={(event) => setConfirmInput(event.target.value)} placeholder="WIPE-CONFIRM" className="mt-2 w-full bg-surface-container-lowest text-error font-mono text-sm px-3.5 py-2.5 rounded-lg border border-error/30 focus:outline-none focus:border-error" />
          </label>
          {error && <p role="alert" className="text-sm text-error">{error}</p>}
        </div>
        <div className="p-4 bg-surface-container border-t border-white/5 flex items-center justify-between gap-3">
          <button type="button" onClick={onClose} disabled={isWiping} className="px-4 py-2 rounded-lg bg-surface-container-high text-on-surface text-xs">Cancel</button>
          <button type="button" onClick={() => void wipe()} disabled={!confirmed || isWiping} className="px-5 py-2.5 rounded-lg bg-error text-black font-semibold text-xs disabled:opacity-40">{isWiping ? 'Revoking access…' : 'Revoke sessions and shares'}</button>
        </div>
      </div>
    </div>
  );
};
