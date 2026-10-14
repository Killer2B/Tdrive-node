import React, { useMemo, useState } from 'react';
import * as api from '../../api';
import { ExternalLink } from '../../types';

interface SharedVaultsViewProps {
  vaults: api.ApiVault[];
  links: ExternalLink[];
  activityItems: api.ApiActivity[];
  meta: { activeSessions: number; shares: number };
  onOpenCreateShare: () => void;
  onRevokeLink: (id: string) => void;
  onCopyLink: (endpoint: string) => void;
  onExportAuditCsv: () => void;
  onRetry: () => void;
}

type Tab = 'vaults' | 'links' | 'audit';

const actionLabel: Record<string, string> = {
  login: 'Signed in',
  logout: 'Signed out',
  upload: 'Uploaded file',
  download: 'Downloaded file',
  share_view: 'Viewed shared file',
  share_download: 'Downloaded shared file',
  share_created: 'Created share',
  share_revoked: 'Revoked share',
  file_trashed: 'Moved file to trash',
  file_restored: 'Restored file',
  file_deleted: 'Permanently deleted file',
  trash_emptied: 'Emptied trash',
  trash_purged: 'Purged expired trash',
  session_revoked: 'Revoked session',
  settings_updated: 'Updated settings',
  dedup_purge: 'Removed duplicate files',
  wipe_peers: 'Revoked sessions and shares',
};

export const SharedVaultsView: React.FC<SharedVaultsViewProps> = ({
  vaults,
  links,
  activityItems,
  meta,
  onOpenCreateShare,
  onRevokeLink,
  onCopyLink,
  onExportAuditCsv,
  onRetry,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('vaults');
  const [searchFilter, setSearchFilter] = useState('');
  const filteredLinks = useMemo(() => {
    const needle = searchFilter.trim().toLocaleLowerCase();
    if (!needle) return links;
    return links.filter((link) =>
      [link.targetName, link.vanityEndpoint, link.targetPath].some((value) => value.toLocaleLowerCase().includes(needle)),
    );
  }, [links, searchFilter]);

  return (
    <div className="relative w-full px-8 py-6 space-y-8 max-w-[1600px] mx-auto">
      <div className="relative overflow-hidden rounded-xl bg-surface-container-low border border-white/5 p-6 shadow-xl">
        <div className="relative flex flex-col xl:flex-row xl:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-secondary-fixed font-mono text-xs uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary-fixed-dim" />
              <span>Workspace collaboration</span>
            </div>
            <h1 className="text-3xl text-on-surface tracking-tight font-semibold">Shared Vaults & Access</h1>
            <p className="text-sm text-on-surface-variant">Folders, active share links and recorded workspace activity.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center bg-surface-container border border-white/5 px-4 py-2 rounded-lg gap-4">
              <div><span className="block font-mono text-[10px] text-outline uppercase">Active Sessions</span><span className="text-xl font-bold text-on-surface font-mono">{meta.activeSessions}</span></div>
              <div className="h-8 w-px bg-surface-container-highest" />
              <div><span className="block font-mono text-[10px] text-outline uppercase">Active Shares</span><span className="text-xl font-bold text-on-surface font-mono">{meta.shares}</span></div>
            </div>
            <button type="button" onClick={onOpenCreateShare} className="flex items-center gap-2 px-5 py-2.5 bg-primary-container text-on-primary-container font-semibold text-sm rounded-lg shadow-lg">Create Share</button>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-white/5 flex flex-wrap gap-2">
          {([
            ['vaults', `Folders (${vaults.length})`],
            ['links', `Share links (${links.length})`],
            ['audit', 'Activity log'],
          ] as const).map(([tab, label]) => (
            <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`px-3.5 py-1.5 rounded-lg font-mono text-xs transition-colors ${activeTab === tab ? 'bg-surface-container-high text-primary font-semibold' : 'text-on-surface-variant hover:bg-surface-container'}`}>{label}</button>
          ))}
        </div>
      </div>

      {activeTab === 'vaults' && (
        <section className="space-y-4">
          <div className="flex items-center justify-between"><h2 className="text-lg text-on-surface font-semibold">Folders in this workspace</h2><button type="button" onClick={onRetry} className="text-xs text-primary hover:underline">Refresh</button></div>
          {vaults.length ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {vaults.map((vault) => (
                <article key={vault.id} className="rounded-xl bg-surface-container-low border border-white/5 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="w-10 h-10 rounded-lg bg-surface-container-high flex items-center justify-center text-primary"><span className="material-symbols-outlined text-2xl">folder_shared</span></div>
                    <span className={`font-mono text-[10px] px-2 py-0.5 rounded ${vault.shared ? 'bg-secondary-container/20 text-secondary-fixed' : 'bg-surface-container-high text-outline'}`}>{vault.shared ? 'Shared' : 'Private'}</span>
                  </div>
                  <h3 className="text-sm font-semibold text-on-surface truncate" title={vault.name}>{vault.name}</h3>
                  <div className="flex justify-between text-xs font-mono text-outline"><span>{vault.filesCount} files</span><span>{api.formatSize(vault.bytes)}</span></div>
                  <div className="flex justify-between text-xs text-outline"><span>{vault.sharesCount} shares</span><span>Updated {api.formatRelative(vault.updatedAt)}</span></div>
                  <svg viewBox="0 0 140 28" className="w-full h-7" role="img" aria-label="Files added during the past seven days">
                    {vault.activity.some((value) => value > 0) ? <polyline points={vault.activity.map((value, index) => `${(index / Math.max(1, vault.activity.length - 1)) * 140},${26 - (value / Math.max(1, ...vault.activity)) * 22}`).join(' ')} fill="none" stroke="#2f91ff" strokeWidth="2" /> : <line x1="0" y1="26" x2="140" y2="26" stroke="#45484f" />}
                  </svg>
                </article>
              ))}
            </div>
          ) : <div className="p-12 rounded-xl bg-surface-container-low border border-white/5 text-center text-sm text-outline">No folders have been created in this workspace.</div>}
        </section>
      )}

      {activeTab === 'links' && (
        <section className="rounded-xl bg-surface-container-low border border-white/5 p-6 space-y-4 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div><h2 className="text-lg text-on-surface font-semibold">External Share Links</h2><p className="text-xs text-outline">Search, copy or revoke access links.</p></div>
            <div className="flex items-center gap-3">
              <input type="search" value={searchFilter} onChange={(event) => setSearchFilter(event.target.value)} placeholder="Filter by file or URL" className="bg-surface-container-lowest border border-white/5 text-on-surface font-mono text-xs px-3 py-2 rounded-lg focus:outline-none focus:border-primary-container w-64" />
              <button type="button" onClick={onExportAuditCsv} title="Export activity as CSV" className="p-2 rounded bg-surface-container hover:bg-surface-container-high text-on-surface border border-white/5"><span className="material-symbols-outlined text-lg">download</span></button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="bg-surface-container-lowest text-outline font-mono text-[11px] uppercase border-b border-white/5"><th className="py-2.5 px-4">File</th><th className="py-2.5 px-4">Share URL</th><th className="py-2.5 px-4">Protection</th><th className="py-2.5 px-4">Downloads / Limit</th><th className="py-2.5 px-4">Views</th><th className="py-2.5 px-4">Expiry</th><th className="py-2.5 px-4 text-right">Access</th></tr></thead>
              <tbody className="divide-y divide-white/5">
                {filteredLinks.map((link) => (
                  <tr key={link.id} className="hover:bg-surface-container/60">
                    <td className="py-3 px-4 text-on-surface">{link.targetName}<span className="block font-mono text-[10px] text-outline">{link.targetPath}</span></td>
                    <td className="py-3 px-4 font-mono text-secondary-fixed break-all">{link.vanityEndpoint}{!link.isRevoked && <button type="button" onClick={() => onCopyLink(link.vanityEndpoint)} className="ml-2 text-outline hover:text-on-surface" title="Copy URL"><span className="material-symbols-outlined text-sm align-middle">content_copy</span></button>}</td>
                    <td className="py-3 px-4"><div className="flex flex-wrap gap-1">{link.safeguards.map((item, index) => <span key={`${item.label}-${index}`} className="px-1.5 py-0.5 rounded bg-surface-container-highest text-secondary-fixed text-[10px]">{item.label}</span>)}{link.ipAllow && <span className="px-1.5 py-0.5 rounded bg-surface-container-highest text-secondary-fixed text-[10px]">IP restricted</span>}</div></td>
                    <td className="py-3 px-4 font-mono text-on-surface">{link.quotaUsed} / {link.quotaLimit}</td>
                    <td className="py-3 px-4 font-mono text-on-surface">{link.viewsCount}</td>
                    <td className="py-3 px-4 text-on-surface-variant">{link.expiry}</td>
                    <td className="py-3 px-4 text-right">{link.isRevoked ? <span className="text-outline">Revoked</span> : <button type="button" onClick={() => onRevokeLink(link.id)} className="text-error hover:underline">Revoke</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filteredLinks.length && <p className="p-8 text-center text-sm text-outline">{links.length ? 'No links match this search.' : 'No share links have been created.'}</p>}
          <div className="text-xs text-outline font-mono">Showing {filteredLinks.length} of {links.length} links</div>
        </section>
      )}

      {activeTab === 'audit' && (
        <section className="rounded-xl bg-surface-container-low border border-white/5 p-6 space-y-4">
          <div className="flex items-center justify-between gap-4"><div><h2 className="text-lg font-semibold text-on-surface">Workspace Activity</h2><p className="text-xs text-outline">Recent operations recorded by the server.</p></div><button type="button" onClick={onExportAuditCsv} className="px-3 py-2 rounded bg-surface-container-high text-xs text-on-surface">Export CSV</button></div>
          {activityItems.length ? <div className="divide-y divide-white/5">{activityItems.map((item) => <div key={item.id} className="py-3 flex items-start justify-between gap-4"><div><p className="text-sm text-on-surface">{actionLabel[item.action] ?? item.action}{item.targetName ? ` · ${item.targetName}` : ''}</p><p className="font-mono text-[11px] text-outline">{item.targetType ?? 'system'}{item.ip ? ` · ${item.ip}` : ''}</p></div><time className="font-mono text-xs text-outline whitespace-nowrap">{new Date(item.at).toLocaleString()}</time></div>)}</div> : <p className="p-8 text-center text-sm text-outline">No recorded activity yet.</p>}
        </section>
      )}
    </div>
  );
};
