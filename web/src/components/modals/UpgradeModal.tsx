import React from 'react';

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgraded: (newQuotaTB: number) => void;
}

export const UpgradeModal: React.FC<UpgradeModalProps> = ({
  isOpen,
  onClose,
  onUpgraded
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-surface-container-low border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="p-5 bg-surface-container flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary-container text-on-primary-container flex items-center justify-center shadow-md">
              <span className="material-symbols-outlined text-xl">database</span>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-on-surface">Cryptographic Quota Allocation</h3>
              <p className="font-mono text-xs text-outline">Elastic Sharded Storage Scaler</p>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 rounded-xl bg-surface-container border border-primary-container/40 flex flex-col justify-between">
              <div>
                <span className="font-mono text-xs text-primary uppercase tracking-wider">Enterprise Scale</span>
                <h4 className="text-xl font-bold text-on-surface mt-1">10 TB Volume</h4>
                <p className="text-xs text-outline mt-1">Reed-Solomon 8+4 sharded across 3 geo-regions.</p>
              </div>
              <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
                <span className="font-mono text-xs text-secondary-fixed">$490 / mo</span>
                <button
                  onClick={() => {
                    onUpgraded(10);
                    onClose();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-primary-container text-on-primary-container font-mono text-xs hover:bg-secondary-container transition-colors"
                >
                  Allocate
                </button>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-surface-container border border-white/5 flex flex-col justify-between">
              <div>
                <span className="font-mono text-xs text-secondary-fixed uppercase tracking-wider">Sovereign Cluster</span>
                <h4 className="text-xl font-bold text-on-surface mt-1">25 TB Dedicated</h4>
                <p className="text-xs text-outline mt-1">Dedicated HSM hardware enclave with unmetered peering.</p>
              </div>
              <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
                <span className="font-mono text-xs text-secondary-fixed">$1,150 / mo</span>
                <button
                  onClick={() => {
                    onUpgraded(25);
                    onClose();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-primary-container hover:text-on-primary-container text-on-surface font-mono text-xs transition-colors"
                >
                  Allocate
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-surface-container border-t border-white/5 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-mono text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
