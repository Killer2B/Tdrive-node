import React from 'react';
import { FileItem } from '../../types';

interface TrashViewProps {
  trashItems: FileItem[];
  onRestoreItem: (id: string) => void;
  onShredItem: (id: string) => void;
  onEmptyAllTrash: () => void;
  retentionDays: number;
  isLoading: boolean;
  loadError: string | null;
  onRetry: () => void;
}

export const TrashView: React.FC<TrashViewProps> = ({
  trashItems,
  onRestoreItem,
  onShredItem,
  onEmptyAllTrash,
  retentionDays,
  isLoading,
  loadError,
  onRetry,
}) => {
  return (
    <div className="relative w-full px-8 py-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-error font-mono text-xs uppercase tracking-wider mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-error animate-pulse"></span>
            <span>Deleted files</span>
          </div>
          <h1 className="text-3xl text-on-surface tracking-tight font-semibold">
            Recovery / Trash
          </h1>
          <p className="text-sm text-outline mt-1">
            Soft-deleted workspace objects are retained for {retentionDays} days before automatic purge.
          </p>
        </div>

        {loadError && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-error/30 bg-error-container/20 p-3 text-sm text-error"><span>{loadError}</span><button type="button" onClick={onRetry} className="underline">Retry</button></div>}

        {trashItems.length > 0 && (
          <button
            type="button"
            onClick={onEmptyAllTrash}
            className="flex items-center gap-2 px-4 py-2 bg-error-container hover:bg-error hover:text-black text-on-error-container font-mono text-xs font-semibold rounded-lg transition-all cursor-pointer shadow-md"
          >
            <span className="material-symbols-outlined text-base">delete_forever</span>
            <span>Delete All Permanently ({trashItems.length})</span>
          </button>
        )}
      </div>

      {/* Retention notice box */}
      <div className="p-4 rounded-xl bg-surface-container-low border border-white/5 flex items-center justify-between gap-4 text-xs font-mono">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-secondary-fixed text-xl">shield_lock</span>
          <span className="text-on-surface">Auto-purge policy: items are purged after {retentionDays} days, according to the configured retention period.</span>
        </div>
        <span className="text-outline">{retentionDays} day retention</span>
      </div>

      {/* Trash list */}
      <div className="rounded-xl bg-surface-container-low border border-white/5 divide-y divide-white/5 shadow-xl overflow-hidden">
        {isLoading && trashItems.length === 0 ? (
          <div className="p-12 text-center text-outline font-mono text-sm" role="status">Loading trash…</div>
        ) : loadError && trashItems.length === 0 ? null : trashItems.length === 0 ? (
          <div className="p-16 text-center text-outline font-mono text-sm space-y-2">
            <span className="material-symbols-outlined text-4xl text-outline/60 block">delete_outline</span>
            <span>Trash is currently empty.</span>
          </div>
        ) : (
          trashItems.map((item) => (
            <div
              key={item.id}
              className="p-4 hover:bg-surface-container transition-colors flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-surface-container-high flex items-center justify-center text-error shrink-0 shadow-sm">
                  <span className="material-symbols-outlined text-lg">delete</span>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 truncate">
                    <span className="text-sm text-on-surface font-medium truncate line-through opacity-80">
                      {item.name}
                    </span>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-error-container/30 text-error">
                      {item.deletedDaysLeft !== undefined ? `${item.deletedDaysLeft}d until purge` : 'Pending purge'}
                    </span>
                  </div>
                  <div className="font-mono text-xs text-outline mt-0.5">
                    {item.size} · Deleted {item.modified}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onRestoreItem(item.id)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-primary hover:text-secondary-fixed font-mono text-xs transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">restore_from_trash</span>
                  <span>Restore</span>
                </button>
                <button
                  type="button"
                  onClick={() => onShredItem(item.id)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-container hover:bg-error-container hover:text-on-error-container text-error font-mono text-xs transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">delete_forever</span>
                  <span>Delete Permanently</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
