import React, { useState } from 'react';

interface DeduplicationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPurged: (freedGB: number) => void;
}

export const DeduplicationModal: React.FC<DeduplicationModalProps> = ({
  isOpen,
  onClose,
  onPurged
}) => {
  const [selectedItems, setSelectedItems] = useState<string[]>(['dup-1', 'dup-2', 'dup-3']);
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen) return null;

  const duplicates = [
    {
      id: 'dup-1',
      file: '/vault/renders/v2_final_4k.mov',
      original: '/campaigns/q3/video/Nike_Cut_v09_Master.mov',
      size: '14.2 GB',
      sizeNum: 14.2,
      codec: 'ProRes 4444 XQ',
      hash: 'a591a6d40bf4...e9ad9f146e',
      reason: 'Byte-identical hash with primary master cut'
    },
    {
      id: 'dup-2',
      file: '/vault/exports/social_proxy_1080p_render_copy.mov',
      original: '/campaigns/q3/video/social_1080p_clean.mov',
      size: '14.2 GB',
      sizeNum: 14.2,
      codec: 'ProRes 422 HQ',
      hash: 'a591a6d40bf4...e9ad9f146e',
      reason: 'Redundant render branch across team folder'
    },
    {
      id: 'dup-3',
      file: '/sandbox/scratch/temp_encode_pass_v2.mov',
      original: '/vault/deliverables/hero_cinematic_grade_4k.prores',
      size: '14.4 GB',
      sizeNum: 14.4,
      codec: 'H.265 Master 10-bit',
      hash: 'e3b0c44298fc...ca495991b7',
      reason: 'Orphaned intermediary transcode pass'
    }
  ];

  const totalFreed = duplicates
    .filter(d => selectedItems.includes(d.id))
    .reduce((acc, curr) => acc + curr.sizeNum, 0);

  const handleToggle = (id: string) => {
    if (selectedItems.includes(id)) {
      setSelectedItems(selectedItems.filter(i => i !== id));
    } else {
      setSelectedItems([...selectedItems, id]);
    }
  };

  const handleExecutePurge = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      onPurged(totalFreed);
      onClose();
    }, 1000);
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-surface-container-low border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="p-5 bg-surface-container flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary-container/20 text-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-xl">movie_filter</span>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-on-surface">Duplicate Video Stream Inspector</h3>
              <p className="font-mono text-xs text-outline">Content-Addressed SHA-256 Byte-Level Deduplication</p>
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
          <div className="p-4 rounded-xl bg-surface-container border border-white/5 flex items-center justify-between">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-outline">Identified Savings</span>
              <div className="text-2xl font-bold text-secondary-fixed">
                {totalFreed.toFixed(1)} GB Reclaimable
              </div>
            </div>
            <span className="font-mono text-xs px-2.5 py-1 rounded bg-surface-container-high text-primary">
              {selectedItems.length} of 3 clones selected
            </span>
          </div>

          <div className="space-y-3">
            <span className="text-xs font-mono text-outline uppercase tracking-wider block">
              Redundant Clones Detected Across Campaigns
            </span>

            {duplicates.map((item) => (
              <div
                key={item.id}
                onClick={() => handleToggle(item.id)}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
                  selectedItems.includes(item.id)
                    ? 'bg-surface-container border-primary-container/60'
                    : 'bg-surface-container-lowest border-white/5 opacity-60 hover:opacity-100'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedItems.includes(item.id)}
                  onChange={() => {}}
                  className="mt-1 w-4 h-4 rounded bg-surface-container-high accent-primary-container cursor-pointer"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-on-surface font-semibold truncate">
                      {item.file}
                    </span>
                    <span className="font-mono text-xs text-error font-medium shrink-0">
                      -{item.size}
                    </span>
                  </div>
                  <p className="text-xs text-outline mt-0.5">{item.reason}</p>
                  <div className="mt-2 flex items-center gap-2 font-mono text-[11px] text-outline">
                    <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-secondary-fixed">
                      {item.codec}
                    </span>
                    <span>Hash: {item.hash}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-surface-container border-t border-white/5 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-mono text-xs transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleExecutePurge}
            disabled={selectedItems.length === 0 || isProcessing}
            className="px-5 py-2.5 rounded-lg bg-primary-container hover:bg-secondary-container hover:text-on-secondary-fixed-variant text-on-primary-container font-semibold text-xs flex items-center gap-2 shadow-lg transition-all"
          >
            {isProcessing ? (
              <>
                <span className="material-symbols-outlined text-sm animate-spin">sync</span>
                <span>Purging Inode References...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-sm">cleaning_services</span>
                <span>Purge Selected & Reclaim {totalFreed.toFixed(1)} GB</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
