import React, { useState } from 'react';
import { SharedVault, ExternalLink } from '../../types';

interface SharedVaultsViewProps {
  vaults: SharedVault[];
  links: ExternalLink[];
  onOpenCreateShare: () => void;
  onRevokeLink: (id: string) => void;
  onCopyLink: (endpoint: string) => void;
  onExportAuditCsv: () => void;
}

export const SharedVaultsView: React.FC<SharedVaultsViewProps> = ({
  vaults,
  links,
  onOpenCreateShare,
  onRevokeLink,
  onCopyLink,
  onExportAuditCsv
}) => {
  const [activeTab, setActiveTab] = useState<'vaults' | 'links' | 'portals' | 'audit'>('vaults');
  const [searchFilter, setSearchFilter] = useState('');

  const filteredLinks = links.filter(l => 
    l.targetName.toLowerCase().includes(searchFilter.toLowerCase()) ||
    l.vanityEndpoint.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className="relative w-full px-8 py-6 space-y-8 max-w-[1600px] mx-auto">
      {/* Top Context & Action Banner */}
      <div className="relative overflow-hidden rounded-xl bg-surface-container-low border border-white/5 p-6 shadow-xl">
        <div className="absolute -right-24 -top-24 w-96 h-96 rounded-full bg-primary-container/10 blur-3xl pointer-events-none"></div>
        <div className="absolute right-32 top-6 w-32 h-32 rounded-full bg-secondary-fixed-dim/5 blur-2xl pointer-events-none"></div>
        
        <div className="relative flex flex-col xl:flex-row xl:items-center justify-between gap-6">
          <div className="space-y-1.5 max-w-3xl">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-container-highest text-secondary-fixed font-mono text-[11px] uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-secondary-fixed-dim animate-ping"></span>
                Cryptographic Enclaves
              </span>
              <span className="font-mono text-xs text-outline">CLUSTER // US-EAST-E2EE</span>
            </div>
            <h1 className="text-3xl text-on-surface tracking-tight font-semibold">
              Shared Vaults & Client Collaboration
            </h1>
            <p className="text-sm text-on-surface-variant max-w-2xl leading-relaxed">
              Secure collaborative spaces — granular zero-knowledge client rooms, dynamic watermarking, and ephemeral external drops with hardware-isolated signing.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center bg-surface-container border border-white/5 px-4 py-2 rounded-lg gap-4">
              <div className="text-left">
                <span className="block font-mono text-[10px] text-outline uppercase">Active Sessions</span>
                <span className="text-xl font-bold text-on-surface font-mono">142</span>
              </div>
              <div className="h-8 w-px bg-surface-container-highest"></div>
              <div className="text-left">
                <span className="block font-mono text-[10px] text-outline uppercase">Audit Sealed</span>
                <span className="font-mono text-xs text-secondary-fixed font-semibold">100% E2EE</span>
              </div>
            </div>

            <button
              type="button"
              onClick={onOpenCreateShare}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary-container hover:bg-secondary-container hover:text-on-secondary-fixed-variant text-on-primary-container font-semibold text-sm rounded-lg shadow-lg shadow-primary-container/20 transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined text-lg">add_moderator</span>
              <span>Create Secure Share</span>
            </button>
          </div>
        </div>

        {/* Navigation Segment Tabs */}
        <div className="mt-6 pt-4 border-t border-white/5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('vaults')}
            className={`px-3.5 py-1.5 rounded-lg font-mono text-xs flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'vaults'
                ? 'bg-surface-container-high text-primary font-semibold shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
            }`}
          >
            <span className="material-symbols-outlined text-base">lock_open_right</span>
            <span>Active Shared Vaults ({vaults.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('links')}
            className={`px-3.5 py-1.5 rounded-lg font-mono text-xs flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'links'
                ? 'bg-surface-container-high text-primary font-semibold shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
            }`}
          >
            <span className="material-symbols-outlined text-base">link</span>
            <span>External Link Shares ({links.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('portals')}
            className={`px-3.5 py-1.5 rounded-lg font-mono text-xs flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'portals'
                ? 'bg-surface-container-high text-primary font-semibold shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
            }`}
          >
            <span className="material-symbols-outlined text-base">move_to_inbox</span>
            <span>File Drop Portals (3)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            className={`px-3.5 py-1.5 rounded-lg font-mono text-xs flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'audit'
                ? 'bg-surface-container-high text-primary font-semibold shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
            }`}
          >
            <span className="material-symbols-outlined text-base">verified_user</span>
            <span>Security Audit Log</span>
          </button>
        </div>
      </div>

      {/* Section 1: Gated Collaboration Spaces (Rendered on 'vaults' or default) */}
      {(activeTab === 'vaults' || activeTab === 'links') && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary-fixed-dim text-xl">folder_shared</span>
              <h2 className="text-lg text-on-surface font-semibold">Gated Collaboration Spaces</h2>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-surface-container-high text-outline">Real-Time Sync</span>
            </div>
            <div className="flex items-center gap-1.5 text-outline font-mono text-xs">
              <span>Sort: Activity (Recent)</span>
              <span className="material-symbols-outlined text-base">sort</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {vaults.map((vault) => (
              <div
                key={vault.id}
                className="group relative rounded-xl bg-surface-container-low border border-white/5 p-4 flex flex-col justify-between transition-all duration-300 hover:bg-surface-container hover:shadow-xl hover:-translate-y-0.5"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 rounded-lg bg-surface-container-high flex items-center justify-center text-primary-fixed">
                      <span className="material-symbols-outlined text-2xl">
                        {vault.id === 'sv-1' ? 'account_balance' :
                         vault.id === 'sv-2' ? 'smart_display' :
                         vault.id === 'sv-3' ? 'fingerprint' : 'code_blocks'}
                      </span>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px] font-semibold uppercase ${vault.badgeColor}`}>
                      <span className="w-1 h-1 rounded-full bg-current"></span>
                      {vault.badge}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors line-clamp-1">
                      {vault.title}
                    </h3>
                    <p className="text-xs text-outline mt-1 line-clamp-2">
                      {vault.description}
                    </p>
                  </div>

                  {/* Metadata Badges */}
                  <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant">
                      <span className="material-symbols-outlined text-xs text-outline">description</span> {vault.filesCount} files
                    </span>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant">
                      <span className="material-symbols-outlined text-xs text-outline">groups</span> {vault.investorsCount} Accessors
                    </span>
                    {vault.watermarkEnabled && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary-container/20 text-primary">
                        <span className="material-symbols-outlined text-xs text-primary">branding_watermark</span> Watermark ON
                      </span>
                    )}
                    {vault.p2pCached && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary-fixed/20 text-secondary-fixed">
                        <span className="material-symbols-outlined text-xs">bolt</span> P2P Cached
                      </span>
                    )}
                  </div>

                  {/* Sparkline or telemetry meter */}
                  <div className="bg-surface-container-lowest border border-white/5 p-2 rounded-lg space-y-1">
                    <div className="flex items-center justify-between text-[11px] font-mono text-outline">
                      <span>{vault.bandwidth ? 'Bandwidth' : 'Engagement Velocity'}</span>
                      <span className="text-secondary-fixed font-semibold">{vault.bandwidth || vault.engagementVelocity}</span>
                    </div>
                    <svg className="w-full h-7 overflow-visible text-primary" fill="none" viewBox="0 0 160 28">
                      <path
                        d="M0 24 L20 18 L40 22 L60 12 L80 15 L100 6 L120 10 L140 3 L160 8"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                      <path
                        d="M0 24 L20 18 L40 22 L60 12 L80 15 L100 6 L120 10 L140 3 L160 8 L160 28 L0 28 Z"
                        fill="currentColor"
                        fillOpacity="0.12"
                      />
                    </svg>
                  </div>
                </div>

                <div className="pt-3 mt-3 border-t border-white/5 flex items-center justify-between">
                  <span className="font-mono text-[11px] text-outline flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs">timer</span> {vault.expires}
                  </span>
                  <div className="flex items-center -space-x-1.5">
                    {vault.collaboratorAvatars.map((collab, cidx) => (
                      collab.src ? (
                        <img
                          key={cidx}
                          src={collab.src}
                          alt="Accessor"
                          referrerPolicy="no-referrer"
                          className="w-6 h-6 rounded-full ring-2 ring-surface-container-low object-cover"
                        />
                      ) : (
                        <span
                          key={cidx}
                          className="w-6 h-6 rounded-full bg-surface-container-highest text-outline font-mono text-[10px] flex items-center justify-center ring-2 ring-surface-container-low font-bold"
                        >
                          {collab.initials}
                        </span>
                      )
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 2: Shared Links Management Matrix & Active Revocation Deck */}
      <div className="rounded-xl bg-surface-container-low border border-white/5 p-6 space-y-4 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-xl">link</span>
              <h2 className="text-lg text-on-surface font-semibold">Active External Links & Ingress Rules</h2>
            </div>
            <p className="text-xs text-on-surface-variant">
              Instant killswitch and forensic telemetry for all outbound authenticated routes.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filter by vanity, hash or recipient..."
                className="bg-surface-container-lowest border border-white/5 text-on-surface font-mono text-xs pl-8 pr-4 py-1.5 rounded-lg focus:outline-none focus:border-primary-container transition-colors w-64 placeholder:text-outline"
              />
              <span className="material-symbols-outlined absolute left-2 top-2 text-outline text-base">
                filter_list
              </span>
            </div>
            <button
              type="button"
              onClick={onExportAuditCsv}
              className="p-1.5 rounded bg-surface-container hover:bg-surface-container-high text-on-surface transition-colors border border-white/5 cursor-pointer"
              title="Export CSV Audit"
            >
              <span className="material-symbols-outlined text-lg">download_for_offline</span>
            </button>
          </div>
        </div>

        {/* Links Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left font-sans text-xs">
            <thead>
              <tr className="bg-surface-container-lowest text-outline font-mono text-[11px] uppercase tracking-wider border-b border-white/5">
                <th className="py-2.5 px-4 rounded-l-lg">Target Asset / Vault</th>
                <th className="py-2.5 px-4">Vanity Endpoint</th>
                <th className="py-2.5 px-4">Enforced Safeguards</th>
                <th className="py-2.5 px-4">Quota / Limit</th>
                <th className="py-2.5 px-4">Views & Telemetry</th>
                <th className="py-2.5 px-4">Expiry</th>
                <th className="py-2.5 px-4 text-right rounded-r-lg">Killswitch</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono text-xs">
              {filteredLinks.map((link) => (
                <tr key={link.id} className="hover:bg-surface-container/60 transition-colors group">
                  <td className="py-3 px-4 font-sans font-medium text-on-surface">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-base">
                        {link.targetType === 'folder' ? 'folder' :
                         link.targetType === 'video' ? 'movie' :
                         link.targetType === 'doc' ? 'receipt_long' : 'deployed_code'}
                      </span>
                      <span>{link.targetName}</span>
                    </div>
                    <span className="font-mono text-[11px] text-outline">{link.targetPath}</span>
                  </td>

                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1.5">
                      <span className={link.isRevoked ? "text-outline line-through" : "text-secondary-fixed"}>
                        {link.vanityEndpoint}
                      </span>
                      {!link.isRevoked && (
                        <button
                          type="button"
                          onClick={() => onCopyLink(`https://${link.vanityEndpoint}`)}
                          className="text-outline hover:text-on-surface cursor-pointer"
                          title="Copy Link"
                        >
                          <span className="material-symbols-outlined text-sm">content_copy</span>
                        </button>
                      )}
                    </div>
                  </td>

                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {link.safeguards.map((sg, sidx) => (
                        <span
                          key={sidx}
                          className={`px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1 ${
                            sg.highlight
                              ? 'bg-error-container/30 text-error'
                              : 'bg-surface-container-highest text-secondary-fixed'
                          }`}
                        >
                          <span className="material-symbols-outlined text-xs">{sg.icon}</span>
                          {sg.label}
                        </span>
                      ))}
                    </div>
                  </td>

                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className={link.isExpired ? "text-error font-medium" : "text-on-surface"}>
                        {link.quotaUsed} / {link.quotaLimit}
                      </span>
                      {typeof link.quotaLimit === 'number' && (
                        <div className="w-12 h-1 bg-surface-container-highest rounded-full overflow-hidden">
                          <div
                            className={`h-full ${link.isExpired ? 'bg-error' : 'bg-primary'}`}
                            style={{ width: `${Math.min(100, (link.quotaUsed / link.quotaLimit) * 100)}%` }}
                          ></div>
                        </div>
                      )}
                    </div>
                  </td>

                  <td className="py-3 px-4">
                    <span className="text-on-surface block">{link.viewsCount} views</span>
                    <span className="text-outline text-[11px] block">{link.telemetryNote}</span>
                  </td>

                  <td className="py-3 px-4">
                    <span className={link.isRevoked ? 'text-error' : 'text-on-surface-variant'}>
                      {link.isRevoked ? 'Purged' : link.expiry}
                    </span>
                  </td>

                  <td className="py-3 px-4 text-right">
                    {link.isRevoked ? (
                      <span className="px-2.5 py-1 rounded bg-surface-container-highest text-outline font-mono text-[11px]">
                        Revoked
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onRevokeLink(link.id)}
                        className="px-2.5 py-1 rounded bg-surface-container hover:bg-error-container hover:text-on-error-container text-error font-mono text-[11px] transition-colors cursor-pointer"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Table Footer Status */}
        <div className="flex items-center justify-between pt-2 text-outline font-mono text-[11px]">
          <span>Showing {filteredLinks.length} of {links.length} cryptographic access nodes</span>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-secondary-fixed-dim"></span>
              Zero-Knowledge Verification Active
            </span>
            <button
              onClick={() => undefined}
              className="text-primary hover:text-secondary-fixed transition-colors cursor-pointer"
            >
              Audit All Outbound Nodes →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
