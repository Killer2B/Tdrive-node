import React, { useState } from 'react';

interface EmergencyZeroOutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onWipeExecuted: () => void;
}

export const EmergencyZeroOutModal: React.FC<EmergencyZeroOutModalProps> = ({
  isOpen,
  onClose,
  onWipeExecuted
}) => {
  const [confirmInput, setConfirmInput] = useState('');
  const [isWiping, setIsWiping] = useState(false);

  if (!isOpen) return null;

  const handleWipe = () => {
    if (confirmInput.trim().toUpperCase() !== 'WIPE-CONFIRM') return;
    setIsWiping(true);
    setTimeout(() => {
      setIsWiping(false);
      onWipeExecuted();
      onClose();
    }, 1500);
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-surface-container-low border border-error/30 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="p-5 bg-error-container/20 border-b border-error/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-error-container text-on-error-container flex items-center justify-center shadow-lg">
              <span className="material-symbols-outlined text-2xl">gavel</span>
            </div>
            <div>
              <h3 className="text-lg font-bold text-error">Emergency Cryptographic Zero-Out</h3>
              <p className="font-mono text-xs text-outline">Post-Quantum Lattice Ephemeral Key Shredding</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-surface-container-high text-outline hover:text-on-surface transition-colors"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4">
          <div className="p-4 rounded-xl bg-surface-container border border-error/20 text-xs text-on-surface-variant leading-relaxed space-y-2">
            <p className="text-error font-semibold flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base">warning</span>
              Irreversible Cryptographic Action:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-outline">
              <li>All active client node session keys (Berlin, Tokyo, San Francisco) will be immediately scrubbed from volatile HSM enclaves.</li>
              <li>Every outbound external share link will be marked permanently expired.</li>
              <li>Master AES-256 session keys will require physical YubiKey Slot 2 hardware touch to re-authenticate.</li>
            </ul>
          </div>

          <div className="space-y-2 pt-1">
            <label className="block font-mono text-xs text-outline uppercase tracking-wider">
              Type <span className="text-error font-bold">WIPE-CONFIRM</span> to authenticate command:
            </label>
            <input
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder="WIPE-CONFIRM"
              className="w-full bg-surface-container-lowest text-error font-mono text-sm px-3.5 py-2.5 rounded-lg border border-error/30 focus:outline-none focus:border-error transition-colors placeholder:text-outline/40"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-surface-container border-t border-white/5 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            disabled={isWiping}
            className="px-4 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-mono text-xs transition-colors"
          >
            Abort Action
          </button>
          <button
            onClick={handleWipe}
            disabled={confirmInput.trim().toUpperCase() !== 'WIPE-CONFIRM' || isWiping}
            className="px-5 py-2.5 rounded-lg bg-error hover:bg-error-container hover:text-on-error-container text-black font-semibold text-xs flex items-center gap-2 shadow-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isWiping ? (
              <>
                <span className="material-symbols-outlined text-sm animate-spin">sync</span>
                <span>Zeroing Cryptographic Peer Enclaves...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-sm">lock_reset</span>
                <span>Wipe All Peers Now</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
