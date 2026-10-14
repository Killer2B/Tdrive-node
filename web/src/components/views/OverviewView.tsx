import React from 'react';
import * as api from '../../api';
import { ActiveTransfer, FileItem } from '../../types';

interface OverviewViewProps {
  transfers: ActiveTransfer[];
  stats: api.OverviewStats | null;
  loadError: string | null;
  onRetry: () => void;
  onOpenUpload: () => void;
  onOpenCreateShare: () => void;
  onSelectFile: (file: FileItem) => void;
  onDownloadFile: (file: FileItem) => void;
  onNavigateToAllFiles: () => void;
  onNavigateToTrash: () => void;
  onCancelTransfer: (id: string) => void;
}

const typeColors: Record<string, string> = {
  video: 'bg-primary-container',
  design: 'bg-secondary-fixed-dim',
  code: 'bg-tertiary-fixed',
  doc: 'bg-tertiary',
  archive: 'bg-error',
  bin: 'bg-outline',
};

export const OverviewView: React.FC<OverviewViewProps> = ({
  transfers,
  stats,
  loadError,
  onRetry,
  onOpenUpload,
  onOpenCreateShare,
  onSelectFile,
  onDownloadFile,
  onNavigateToAllFiles,
  onNavigateToTrash,
  onCancelTransfer,
}) => {
  if (loadError && !stats) {
    return (
      <div className="px-8 py-12 max-w-3xl mx-auto text-center space-y-3">
        <p className="text-error">{loadError}</p>
        <button type="button" onClick={onRetry} className="px-4 py-2 rounded-lg bg-primary-container text-on-primary-container">Retry</button>
      </div>
    );
  }
  if (!stats) {
    return (
      <div className="px-8 py-12 max-w-[1600px] mx-auto space-y-4" aria-label="Loading workspace">
        <div className="h-8 w-64 rounded bg-surface-container-high animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-28 rounded-xl bg-surface-container-low animate-pulse" />)}
        </div>
      </div>
    );
  }

  const usedPercent = stats.quotaBytes ? Math.min(100, (stats.usedBytes / stats.quotaBytes) * 100) : 0;
  const pinned = stats.pinned.map((file) => api.toFileItem(file));
  const activeTransfers = transfers.filter((transfer) => transfer.status !== 'complete');

  return (
    <div className="relative w-full px-8 py-6 space-y-8 overflow-hidden max-w-[1600px] mx-auto">
      <div className="pointer-events-none absolute -top-40 right-20 w-96 h-96 rounded-full bg-primary-container/10 blur-[120px]" />

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-outline font-mono text-xs uppercase tracking-wider mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary-fixed-dim" />
            <span>Workspace // {stats.storage.backend} storage</span>
          </div>
          <h1 className="text-3xl text-on-surface tracking-tight font-semibold">Operational Vault</h1>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onOpenCreateShare} className="px-4 py-2 rounded-lg bg-surface-container text-on-surface text-sm hover:bg-surface-container-high">Create Share</button>
          <button type="button" onClick={onOpenUpload} className="px-4 py-2 rounded-lg bg-primary-container text-on-primary-container text-sm font-semibold">Upload Files</button>
        </div>
      </div>

      {loadError && <div role="alert" className="rounded-lg border border-error/30 bg-error-container/20 p-3 text-sm text-error flex justify-between gap-4">
        <span>{loadError}</span><button type="button" onClick={onRetry} className="underline">Retry</button>
      </div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: 'Active Files', value: stats.activeFiles.toLocaleString(), icon: 'inventory_2' },
          { label: 'Share Downloads', value: stats.shares.downloads.toLocaleString(), icon: 'download' },
          { label: 'Active Shares', value: stats.shares.active.toLocaleString(), icon: 'group' },
          { label: 'Files with stored chunks', value: `${stats.storage.chunkedPct}%`, icon: 'inventory_2' },
        ].map((metric) => (
          <div key={metric.label} className="p-5 rounded-xl bg-surface-container-low border border-white/5 shadow-sm">
            <div className="flex items-center justify-between text-on-surface-variant mb-3">
              <span className="font-mono text-xs uppercase tracking-wide">{metric.label}</span>
              <span className="material-symbols-outlined text-primary">{metric.icon}</span>
            </div>
            <span className="text-2xl text-on-surface font-semibold font-mono">{metric.value}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="xl:col-span-2 p-6 rounded-xl bg-surface-container-low border border-white/5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="font-mono text-xs uppercase tracking-wider text-outline">Storage</span>
              <h2 className="text-lg text-on-surface font-semibold">Usage by File Type</h2>
            </div>
            <span className="font-mono text-xs text-on-surface">{api.formatSize(stats.usedBytes)} / {api.formatSize(stats.quotaBytes)}</span>
          </div>
          <div className="h-3 w-full bg-surface-container-highest rounded-full overflow-hidden flex">
            {stats.byType.map((row) => (
              <div key={row.type} className={`${typeColors[row.type] ?? 'bg-outline'} h-full`} style={{ width: `${row.pct}%` }} title={`${row.type}: ${api.formatSize(row.bytes)} (${row.pct}%)`} />
            ))}
          </div>
          {stats.byType.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {stats.byType.map((row) => (
                <div key={row.type} className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-surface-container">
                  <span className="flex items-center gap-2 text-sm text-on-surface"><span className={`w-2.5 h-2.5 rounded-full ${typeColors[row.type] ?? 'bg-outline'}`} />{row.type}</span>
                  <span className="font-mono text-xs text-outline">{api.formatSize(row.bytes)} · {row.count} files</span>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-outline">No files stored yet.</p>}
          <div className="h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
            <div className="h-full bg-primary-container transition-all" style={{ width: `${usedPercent}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs text-outline font-mono">
            <span>{usedPercent.toFixed(1)}% used</span>
            <span>{stats.trash.count} items in trash · {api.formatSize(stats.trash.bytes)}</span>
          </div>
        </section>

        <section className="p-6 rounded-xl bg-surface-container-low border border-white/5 space-y-4">
          <div className="flex items-center justify-between">
            <div><span className="font-mono text-xs uppercase tracking-wider text-outline">Jobs API</span><h2 className="text-lg text-on-surface font-semibold">Active Transfers</h2></div>
            <span className="font-mono text-xs text-outline">{activeTransfers.length}</span>
          </div>
          {activeTransfers.length ? activeTransfers.map((transfer) => (
            <div key={transfer.id} className="p-3 rounded-lg bg-surface-container space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-on-surface truncate">{transfer.name}</span>
                <span className="font-mono text-xs text-primary">{transfer.status === 'queued' ? 'Queued' : `${transfer.progress}%`}</span>
              </div>
              <div className="h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                <div className="h-full bg-primary-container transition-all" style={{ width: `${transfer.progress}%` }} />
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-outline">
                <span>{transfer.currentSize} / {transfer.totalSize} · {transfer.speed}</span>
                <button type="button" onClick={() => onCancelTransfer(transfer.id)} className="text-error hover:underline">Cancel</button>
              </div>
            </div>
          )) : <p className="py-8 text-center text-sm text-outline">No active or queued transfer jobs.</p>}
        </section>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div><span className="font-mono text-xs uppercase tracking-wider text-outline">Pinned Files</span><h2 className="text-lg text-on-surface font-semibold">Quick Access</h2></div>
          <button type="button" onClick={onNavigateToAllFiles} className="text-xs font-mono text-primary hover:underline">Browse all</button>
        </div>
        {pinned.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {pinned.map((file) => (
              <div key={file.id} className="p-4 rounded-xl bg-surface-container-low border border-white/5">
                <button type="button" onClick={() => onSelectFile(file)} className="block text-left text-sm font-medium text-on-surface hover:text-primary truncate w-full">{file.name}</button>
                <p className="text-xs text-outline mt-1">{file.size} · {file.modified}</p>
                <div className="flex gap-2 mt-3">
                  <button type="button" onClick={() => onDownloadFile(file)} className="text-xs text-primary hover:underline">Download</button>
                  <button type="button" onClick={onNavigateToAllFiles} className="text-xs text-outline hover:text-on-surface">Inspect</button>
                </div>
              </div>
            ))}
          </div>
        ) : <div className="p-8 text-center rounded-xl bg-surface-container-low border border-white/5 text-sm text-outline">No pinned files yet. Pin a file from All Files to show it here.</div>}
      </section>

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onNavigateToAllFiles} className="px-4 py-2 rounded-lg bg-surface-container text-sm text-on-surface hover:bg-surface-container-high">All files</button>
        <button type="button" onClick={onNavigateToTrash} className="px-4 py-2 rounded-lg bg-surface-container text-sm text-on-surface hover:bg-surface-container-high">Trash ({stats.trash.count})</button>
      </div>
    </div>
  );
};
