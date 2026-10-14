import React, { useState } from 'react';
import * as api from '../../api';
import { ClientNode } from '../../types';

interface SecurityAuditViewProps {
  clientNodes: ClientNode[];
  stats: api.SecurityStats | null;
  loadError: string | null;
  onRetry: () => void;
  onRevokeNode: (nodeId: string) => void;
  onOpenDeduplication: () => void;
  onEmptyStaleTrash: () => void;
  onRecalculateQuotas: () => Promise<void> | void;
  onOpenZeroOutModal: () => void;
  onExportAuditLog: () => void;
}

const typeColors: Record<string, string> = {
  video: 'bg-primary-container',
  design: 'bg-secondary-fixed-dim',
  code: 'bg-tertiary-fixed',
  doc: 'bg-tertiary',
  archive: 'bg-error',
  bin: 'bg-outline',
};

export const SecurityAuditView: React.FC<SecurityAuditViewProps> = ({
  clientNodes,
  stats,
  loadError,
  onRetry,
  onRevokeNode,
  onOpenDeduplication,
  onEmptyStaleTrash,
  onRecalculateQuotas,
  onOpenZeroOutModal,
  onExportAuditLog,
}) => {
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRecalculateQuotas();
    } finally {
      setRefreshing(false);
    }
  };

  if (loadError && !stats) {
    return <div className="px-8 py-12 text-center space-y-3"><p className="text-error">{loadError}</p><button type="button" onClick={onRetry} className="px-4 py-2 rounded-lg bg-primary-container text-on-primary-container">Retry</button></div>;
  }
  if (!stats) {
    return <div className="px-8 py-12 max-w-[1600px] mx-auto space-y-4" aria-label="Loading security data">
      <div className="h-8 w-72 rounded bg-surface-container-high animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{[0, 1, 2].map((i) => <div key={i} className="h-32 rounded-xl bg-surface-container-low animate-pulse" />)}</div>
    </div>;
  }

  const utilization = stats.quotaBytes ? Math.min(100, (stats.usedBytes / stats.quotaBytes) * 100) : 0;
  const chartValues = stats.growth.map((item) => item.bytes);
  const maxGrowth = Math.max(1, ...chartValues);
  const chartPoints = chartValues.length
    ? chartValues.map((value, index) => `${(index / Math.max(1, chartValues.length - 1)) * 600},${150 - (value / maxGrowth) * 130}`).join(' ')
    : '';

  return (
    <div className="relative w-full px-8 py-6 space-y-8 max-w-[1600px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-primary font-mono text-xs uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary-container" />
            <span>{stats.posture.storageDriver} storage · {stats.posture.contentBackend} content</span>
          </div>
          <h1 className="text-3xl text-on-surface tracking-tight font-semibold">Storage & Security</h1>
          <p className="text-sm text-outline mt-1">Usage, file growth, duplicate content and current server security settings.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={onExportAuditLog} className="px-3.5 py-2 bg-surface-container-high text-on-surface font-mono text-xs rounded-lg">Export Activity</button>
          <button type="button" onClick={() => void refresh()} disabled={refreshing} className="px-4 py-2 bg-primary-container text-on-primary-container font-mono text-xs font-semibold rounded-lg disabled:opacity-50">
            {refreshing ? 'Refreshing…' : 'Refresh Metrics'}
          </button>
        </div>
      </div>

      {loadError && <div role="alert" className="rounded-lg border border-error/30 bg-error-container/20 p-3 text-sm text-error flex justify-between gap-4"><span>{loadError}</span><button type="button" onClick={onRetry} className="underline">Retry</button></div>}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-5 bg-surface-container-low border border-white/5 rounded-xl p-6 space-y-5">
          <div>
            <span className="font-mono text-xs text-outline uppercase tracking-wider">Allocated Volume</span>
            <h2 className="text-xl font-semibold text-on-surface mt-0.5">Storage Quota</h2>
          </div>
          <div className="relative w-48 h-48 mx-auto flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 160 160" role="img" aria-label={`${utilization.toFixed(1)} percent of quota used`}>
              <circle cx="80" cy="80" r="66" fill="transparent" stroke="#272a31" strokeWidth="12" />
              <circle cx="80" cy="80" r="66" fill="transparent" stroke="#2f91ff" strokeWidth="12" strokeDasharray="414" strokeDashoffset={414 * (1 - utilization / 100)} strokeLinecap="round" className="transition-all duration-700" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono text-xs text-outline">USED</span>
              <span className="text-3xl font-bold text-on-surface font-mono">{utilization.toFixed(1)}%</span>
              <span className="font-mono text-xs text-outline">{api.formatSize(stats.usedBytes)} / {api.formatSize(stats.quotaBytes)}</span>
            </div>
          </div>
          <div className="space-y-2">
            {stats.byType.map((row) => (
              <div key={row.type} className="p-2 rounded bg-surface-container-high/60 flex items-center justify-between gap-4 text-xs">
                <span className="flex items-center gap-2 text-on-surface"><span className={`w-2 h-2 rounded-full ${typeColors[row.type] ?? 'bg-outline'}`} />{row.type}</span>
                <span className="font-mono text-on-surface-variant">{api.formatSize(row.bytes)} · {row.count}</span>
              </div>
            ))}
            {!stats.byType.length && <p className="text-sm text-outline">No file usage to report.</p>}
          </div>
          <button type="button" onClick={onRecalculateQuotas} className="text-xs text-primary hover:underline">Update usage</button>
        </section>

        <section className="lg:col-span-7 bg-surface-container-low border border-white/5 rounded-xl p-6 space-y-5">
          <div>
            <span className="font-mono text-xs text-outline uppercase tracking-wider">File Ingest</span>
            <h2 className="text-xl font-semibold text-on-surface mt-0.5">Monthly Growth</h2>
          </div>
          {stats.growth.some((item) => item.bytes > 0) ? (
            <>
              <div className="h-44 w-full">
                <svg className="w-full h-full" viewBox="0 0 600 160" preserveAspectRatio="none" role="img" aria-label="File ingest by month">
                  <line x1="0" x2="600" y1="20" y2="20" stroke="#272a31" strokeDasharray="4 4" />
                  <line x1="0" x2="600" y1="80" y2="80" stroke="#272a31" strokeDasharray="4 4" />
                  <line x1="0" x2="600" y1="150" y2="150" stroke="#272a31" strokeDasharray="4 4" />
                  <polyline points={chartPoints} fill="none" stroke="#2f91ff" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                  {stats.growth.map((item, index) => <circle key={item.month} cx={(index / Math.max(1, stats.growth.length - 1)) * 600} cy={150 - (item.bytes / maxGrowth) * 130} r="4" fill="#00eefc" />)}
                </svg>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-center font-mono text-[11px] text-outline">
                {stats.growth.map((item) => <div key={item.month}><span className="block text-on-surface">{item.label}</span>{api.formatSize(item.bytes)}</div>)}
              </div>
            </>
          ) : <div className="h-44 flex items-center justify-center text-sm text-outline">No file additions in the past six months.</div>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 bg-surface-container rounded-lg"><span className="text-xs text-outline">Average ingest</span><div className="font-mono text-on-surface mt-1">{api.formatSize(stats.ingestPerDayBytes)}/day</div></div>
            <div className="p-3 bg-surface-container rounded-lg"><span className="text-xs text-outline">Quota runway</span><div className="font-mono text-on-surface mt-1">{stats.runwayDays === null ? '—' : `${stats.runwayDays} days`}</div></div>
            <div className="p-3 bg-surface-container rounded-lg"><span className="text-xs text-outline">90% quota mark</span><div className="font-mono text-on-surface mt-1">{api.formatSize(stats.autoExpandBytes)}</div></div>
          </div>
        </section>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-on-surface">Data-Driven Recommendations</h2>
          <span className="font-mono text-xs text-outline">Potential recovery: {api.formatSize(stats.dedup.reclaimableBytes)}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-5 rounded-xl bg-surface-container-low border border-white/5 space-y-3">
            <h3 className="font-semibold text-on-surface">Duplicate files</h3>
            <p className="text-sm text-outline">{stats.dedup.duplicateFiles} duplicate files across {stats.dedup.groups} hashes · {api.formatSize(stats.dedup.reclaimableBytes)} reclaimable.</p>
            <button type="button" onClick={onOpenDeduplication} disabled={!stats.dedup.duplicateFiles} className="w-full py-2 bg-primary-container text-on-primary-container text-xs rounded-lg disabled:opacity-50">Review duplicates</button>
          </div>
          <div className="p-5 rounded-xl bg-surface-container-low border border-white/5 space-y-3">
            <h3 className="font-semibold text-on-surface">Expired trash</h3>
            <p className="text-sm text-outline">{stats.recommendations.find((item) => item.kind === 'stale_trash')?.count ?? 0} items are past the configured retention period.</p>
            <button type="button" onClick={onEmptyStaleTrash} disabled={!stats.recommendations.some((item) => item.kind === 'stale_trash')} className="w-full py-2 bg-surface-container-high text-on-surface text-xs rounded-lg disabled:opacity-50">Purge expired items</button>
          </div>
          <div className="p-5 rounded-xl bg-surface-container-low border border-white/5 space-y-3">
            <h3 className="font-semibold text-on-surface">Largest file</h3>
            {stats.recommendations.find((item) => item.kind === 'large_files') ? (
              <p className="text-sm text-outline truncate" title={stats.recommendations.find((item) => item.kind === 'large_files')?.sample}>{stats.recommendations.find((item) => item.kind === 'large_files')?.sample} · {api.formatSize(stats.recommendations.find((item) => item.kind === 'large_files')?.bytes)}</p>
            ) : <p className="text-sm text-outline">No stored files.</p>}
            <button type="button" onClick={onRecalculateQuotas} className="w-full py-2 bg-surface-container-high text-on-surface text-xs rounded-lg">Refresh recommendation</button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-surface-container-low border border-white/5 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div><h2 className="text-lg font-semibold text-on-surface">Server Security Posture</h2><p className="text-xs text-outline">Values reported by this running server.</p></div>
            <button type="button" onClick={onOpenZeroOutModal} className="px-3 py-2 bg-error-container/50 text-error rounded-lg text-xs">Revoke peers & shares</button>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-xs">
            {[
              ['Password KDF', stats.posture.kdf],
              ['Database driver', stats.posture.dbDriver],
              ['File storage', stats.posture.storageDriver],
              ['Content backend', stats.posture.contentBackend],
              ['SSRF protection', stats.posture.ssrfProtection ? 'Enabled' : 'Disabled'],
              ['HTTPS', stats.posture.https ? 'Enabled' : 'Not detected'],
              ['Secure cookie', stats.posture.cookie.secure ? 'Enabled' : 'Development mode'],
              ['Active sessions', String(stats.posture.sessions)],
            ].map(([label, value]) => <div key={label} className="p-3 rounded-lg bg-surface-container"><dt className="text-outline">{label}</dt><dd className="mt-1 text-on-surface font-mono">{value}</dd></div>)}
          </dl>
        </section>

        <section className="bg-surface-container-low border border-white/5 rounded-xl p-6 space-y-4">
          <div><h2 className="text-lg font-semibold text-on-surface">Active Sessions</h2><p className="text-xs text-outline">Revoke any session to end its access.</p></div>
          {clientNodes.length ? clientNodes.map((node) => (
            <div key={node.id} className="p-3 rounded-lg bg-surface-container flex items-center justify-between gap-3">
              <div className="min-w-0"><p className="text-sm text-on-surface truncate">{node.name}{node.isCurrent ? ' · This device' : ''}</p><p className="font-mono text-xs text-outline">{node.ip || 'IP unavailable'} · {node.activeStatus}</p></div>
              <button type="button" onClick={() => onRevokeNode(node.id)} className="text-xs text-error hover:underline shrink-0">Revoke</button>
            </div>
          )) : <p className="py-6 text-center text-sm text-outline">No active sessions.</p>}
        </section>
      </div>
    </div>
  );
};
