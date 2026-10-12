import React, { useState, useEffect } from 'react';
import { FileItem, ActiveTransfer } from '../../types';
import { VAULT_REPLICA_IMAGE } from '../../data/mockData';

interface OverviewViewProps {
  files: FileItem[];
  transfers: ActiveTransfer[];
  onOpenUpload: () => void;
  onOpenCreateShare: () => void;
  onSelectFile: (file: FileItem) => void;
  onDownloadFile: (file: FileItem) => void;
  onCopyFileLink: (file: FileItem) => void;
  onNavigateToAllFiles: () => void;
  onNavigateToTrash: () => void;
  storageUsedTB: number;
  storageTotalTB: number;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  files,
  transfers,
  onOpenUpload,
  onOpenCreateShare,
  onSelectFile,
  onDownloadFile,
  onCopyFileLink,
  onNavigateToAllFiles,
  onNavigateToTrash,
  storageUsedTB,
  storageTotalTB
}) => {
  // Live dynamic transfer simulation
  const [activeProgress, setActiveProgress] = useState(78);
  const [isPaused, setIsPaused] = useState(false);
  const [transfersList, setTransfersList] = useState<ActiveTransfer[]>(transfers);

  useEffect(() => {
    setTransfersList(transfers);
  }, [transfers]);

  useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => {
      setActiveProgress((prev) => {
        if (prev < 99) return prev + 1;
        return prev;
      });
    }, 1400);
    return () => clearInterval(interval);
  }, [isPaused]);

  const handleTogglePause = () => {
    setIsPaused(!isPaused);
  };

  const handleAbort = () => {
    setTransfersList(prev => prev.filter(t => t.id !== 't-2'));
  };

  const pinnedVaults = [
    {
      id: 'pv-1',
      title: 'Q4 Brand Guidelines 2025',
      subtitle: 'Tokens, vector systems, type specs',
      badge: 'Production',
      badgeColor: 'bg-primary-container/20 text-primary',
      icon: 'palette',
      iconColor: 'text-primary',
      collabs: ['JL', 'MK'],
      time: '18m ago'
    },
    {
      id: 'pv-2',
      title: 'Production Motion Assets',
      subtitle: '3D renders, cinematic color grades',
      badge: 'Prores 4444',
      badgeColor: 'bg-secondary-fixed-dim/20 text-secondary-fixed-dim',
      icon: 'movie',
      iconColor: 'text-secondary-fixed-dim',
      collabs: ['VR', 'EW', '+4'],
      time: '1h ago'
    },
    {
      id: 'pv-3',
      title: 'Seed Round Data Room',
      subtitle: 'Cap table, safe notes, investor audit',
      badge: 'Confidential',
      badgeColor: 'bg-error-container text-on-error-container',
      icon: 'enhanced_encryption',
      iconColor: 'text-error',
      collabs: ['AR'],
      time: '3h ago'
    },
    {
      id: 'pv-4',
      title: 'AI Model Weights & Checkpoints',
      subtitle: 'Diffusion fine-tunes & embeddings',
      badge: 'PyTorch // FP16',
      badgeColor: 'bg-surface-container text-outline',
      icon: 'memory',
      iconColor: 'text-tertiary',
      collabs: ['TC', 'DL'],
      time: 'Yesterday'
    }
  ];

  return (
    <div className="relative w-full px-8 py-6 space-y-8 overflow-hidden max-w-[1600px] mx-auto">
      {/* Subtle Ambient Glow */}
      <div className="pointer-events-none absolute -top-40 right-20 w-96 h-96 rounded-full bg-primary-container/10 blur-[120px]"></div>
      <div className="pointer-events-none absolute top-1/3 -left-32 w-80 h-80 rounded-full bg-secondary-container/5 blur-[100px]"></div>

      {/* Header & Fast Action Array */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-outline font-mono text-xs uppercase tracking-wider mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary-fixed-dim"></span>
              <span>Cryptographic Cluster // US-EAST-VAULT-04</span>
            </div>
            <h2 className="text-3xl text-on-surface tracking-tight font-semibold flex items-center gap-3">
              Operational Vault
              <span className="font-mono text-xs px-2.5 py-0.5 rounded bg-surface-container-high text-secondary-fixed-dim font-normal">
                AES-256-GCM
              </span>
            </h2>
          </div>

          {/* Action Array */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={onOpenCreateShare}
              type="button"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-sm transition-all shadow-sm cursor-pointer"
            >
              <span className="material-symbols-outlined text-lg text-tertiary">add_to_photos</span>
              <span>Create Shared Vault</span>
            </button>
            <button
                onClick={() => undefined}
              type="button"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-sm transition-all shadow-sm cursor-pointer"
            >
              <span className="material-symbols-outlined text-lg text-tertiary">move_to_inbox</span>
              <span>Request Files</span>
            </button>
            <button
              onClick={onOpenUpload}
              type="button"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-container text-on-primary-container text-sm font-semibold hover:bg-secondary-container hover:text-on-secondary-fixed-variant transition-all shadow-md cursor-pointer"
            >
              <span className="material-symbols-outlined text-lg">cloud_upload</span>
              <span>Upload Files</span>
            </button>
          </div>
        </div>

        {/* Quick Metrics Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {/* Active Files */}
          <div className="relative p-5 rounded-xl bg-surface-container-low border border-white/5 shadow-sm flex flex-col justify-between overflow-hidden group hover:bg-surface-container transition-colors">
            <div className="flex items-center justify-between text-on-surface-variant mb-3">
              <span className="font-mono text-xs uppercase tracking-wide">Active Files</span>
              <span className="material-symbols-outlined text-lg text-primary">inventory_2</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl text-on-surface font-semibold tracking-tight font-mono">14,289</span>
              <span className="font-mono text-xs text-secondary-fixed-dim flex items-center gap-0.5">
                <span className="material-symbols-outlined text-sm">trending_up</span>+412 w/w
              </span>
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
          </div>

          {/* Encrypted Bandwidth */}
          <div className="relative p-5 rounded-xl bg-surface-container-low border border-white/5 shadow-sm flex flex-col justify-between overflow-hidden group hover:bg-surface-container transition-colors">
            <div className="flex items-center justify-between text-on-surface-variant mb-3">
              <span className="font-mono text-xs uppercase tracking-wide">Encrypted Bandwidth</span>
              <span className="material-symbols-outlined text-lg text-secondary-fixed">speed</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl text-on-surface font-semibold tracking-tight font-mono">
                482 GB<span className="text-sm text-outline font-normal">/mo</span>
              </span>
              <span className="font-mono text-xs text-tertiary">Limit: 2 TB</span>
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-secondary-fixed to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
          </div>

          {/* Collaborators */}
          <div className="relative p-5 rounded-xl bg-surface-container-low border border-white/5 shadow-sm flex flex-col justify-between overflow-hidden group hover:bg-surface-container transition-colors">
            <div className="flex items-center justify-between text-on-surface-variant mb-3">
              <span className="font-mono text-xs uppercase tracking-wide">Collaborators</span>
              <span className="material-symbols-outlined text-lg text-tertiary">groups</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl text-on-surface font-semibold tracking-tight font-mono">38</span>
              <div className="flex -space-x-1.5">
                <span className="inline-block w-6 h-6 rounded-full bg-surface-container-highest ring-1 ring-background text-[10px] font-mono flex items-center justify-center text-primary font-medium">9+</span>
                <span className="inline-block w-6 h-6 rounded-full bg-primary-container text-on-primary-container text-[10px] font-mono flex items-center justify-center font-bold">AR</span>
                <span className="inline-block w-6 h-6 rounded-full bg-tertiary-container text-on-tertiary-container text-[10px] font-mono flex items-center justify-center font-bold">SK</span>
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-tertiary to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
          </div>

          {/* Zero-Knowledge State */}
          <div className="relative p-5 rounded-xl bg-surface-container-low border border-white/5 shadow-sm flex flex-col justify-between overflow-hidden group hover:bg-surface-container transition-colors">
            <div className="flex items-center justify-between text-on-surface-variant mb-3">
              <span className="font-mono text-xs uppercase tracking-wide">Zero-Knowledge State</span>
              <span className="material-symbols-outlined text-lg text-secondary-fixed-dim">verified_user</span>
            </div>
            <div className="flex items-baseline justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-2xl text-secondary-fixed font-semibold tracking-tight font-mono">100%</span>
                <span className="text-xs text-on-surface-variant">Verified</span>
              </div>
              <span className="font-mono text-xs text-outline">0 Key Leaks</span>
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-secondary-fixed-dim to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
          </div>
        </div>
      </div>

      {/* Storage Breakdown Architecture Bar */}
      <div className="p-6 rounded-xl bg-surface-container-low border border-white/5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <div>
            <span className="font-mono text-xs uppercase tracking-wider text-outline">Telemetry Allocation</span>
            <h3 className="text-lg text-on-surface font-semibold">Storage Breakdown by Asset Pipeline</h3>
          </div>
          <div className="flex items-center gap-3 font-mono text-xs">
            <span className="text-on-surface font-medium">{storageUsedTB.toFixed(1)} TB In Use</span>
            <span className="text-outline">/</span>
            <span className="text-on-surface-variant">{storageTotalTB.toFixed(1)} TB Provisioned (68%)</span>
          </div>
        </div>

        {/* Segmented Bar */}
        <div className="h-3 w-full bg-surface-container-highest rounded-full overflow-hidden flex gap-0.5 p-0.5">
          <div className="h-full bg-primary-container rounded-sm transition-all duration-500 hover:brightness-110" style={{ width: '61.7%' }} title="Video: 2.1 TB"></div>
          <div className="h-full bg-secondary-fixed-dim rounded-sm transition-all duration-500 hover:brightness-110" style={{ width: '18.8%' }} title="Design Files: 640 GB"></div>
          <div className="h-full bg-tertiary-fixed rounded-sm transition-all duration-500 hover:brightness-110" style={{ width: '9.4%' }} title="Code & Docs: 340 GB"></div>
          <div className="h-full bg-tertiary rounded-sm transition-all duration-500 hover:brightness-110" style={{ width: '9.4%' }} title="Raw Audio: 320 GB"></div>
        </div>

        {/* Legend Matrix */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 pt-1 font-mono text-xs">
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-surface-container border border-white/5">
            <span className="w-2.5 h-2.5 rounded-full bg-primary-container"></span>
            <div className="flex flex-col">
              <span className="text-on-surface font-medium">Video Assets</span>
              <span className="text-outline">2.1 TB (61.7%)</span>
            </div>
          </div>
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-surface-container border border-white/5">
            <span className="w-2.5 h-2.5 rounded-full bg-secondary-fixed-dim"></span>
            <div className="flex flex-col">
              <span className="text-on-surface font-medium">Design & 3D</span>
              <span className="text-outline">640 GB (18.8%)</span>
            </div>
          </div>
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-surface-container border border-white/5">
            <span className="w-2.5 h-2.5 rounded-full bg-tertiary-fixed"></span>
            <div className="flex flex-col">
              <span className="text-on-surface font-medium">Code & Docs</span>
              <span className="text-outline">340 GB (9.4%)</span>
            </div>
          </div>
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-surface-container border border-white/5">
            <span className="w-2.5 h-2.5 rounded-full bg-tertiary"></span>
            <div className="flex flex-col">
              <span className="text-on-surface font-medium">Raw Audio</span>
              <span className="text-outline">320 GB (9.4%)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Pinned & Quick Access Vaults */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl">folder_special</span>
            <h3 className="text-lg text-on-surface font-semibold tracking-tight">Pinned Vaults</h3>
            <span className="font-mono text-xs text-outline px-2 py-0.5 rounded bg-surface-container">4 Secured</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onNavigateToAllFiles()}
              className="px-2.5 py-1 text-xs font-mono text-outline hover:text-on-surface rounded hover:bg-surface-container transition-colors"
            >
              Browse All
            </button>
          </div>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {pinnedVaults.map((vault) => (
            <div
              key={vault.id}
              onClick={() => onNavigateToAllFiles()}
              className="p-5 rounded-xl bg-surface-container-low border border-white/5 hover:bg-surface-container transition-all shadow-sm group flex flex-col justify-between cursor-pointer relative overflow-hidden"
            >
              <div className="flex items-start justify-between mb-4">
                <div className={`w-10 h-10 rounded-lg bg-surface-container-high flex items-center justify-center ${vault.iconColor} group-hover:scale-105 transition-transform`}>
                  <span className="material-symbols-outlined text-2xl">{vault.icon}</span>
                </div>
                <span className={`font-mono text-[11px] px-2 py-0.5 rounded uppercase font-semibold ${vault.badgeColor}`}>
                  {vault.badge}
                </span>
              </div>
              <div>
                <h4 className="text-base font-semibold text-on-surface group-hover:text-primary transition-colors line-clamp-1">
                  {vault.title}
                </h4>
                <p className="text-xs text-on-surface-variant mt-1 line-clamp-2">
                  {vault.subtitle}
                </p>
              </div>
              <div className="mt-5 pt-3 border-t border-white/5 flex items-center justify-between">
                <div className="flex -space-x-1.5">
                  {vault.collabs.map((c, i) => (
                    <div
                      key={i}
                      className="w-6 h-6 rounded-full bg-surface-container-highest text-[10px] font-mono flex items-center justify-center text-on-surface ring-1 ring-background"
                    >
                      {c}
                    </div>
                  ))}
                </div>
                <span className="font-mono text-xs text-outline">{vault.time}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Dual Layout: Recent Activity & Live Synchronization HUD */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column (2 Cols): Activity Log */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-mono text-xs uppercase tracking-wider text-outline">Stream Log</span>
              <h3 className="text-lg text-on-surface font-semibold">Recent Activity & Suggestions</h3>
            </div>
            <button
              onClick={() => onNavigateToAllFiles()}
              className="font-mono text-xs text-primary hover:text-secondary-fixed transition-colors flex items-center gap-1 cursor-pointer"
            >
              <span>View All Files</span>
              <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </button>
          </div>

          <div className="rounded-xl bg-surface-container-low border border-white/5 shadow-sm divide-y divide-white/5 overflow-hidden">
            {files.slice(0, 4).map((file) => (
              <div
                key={file.id}
                onClick={() => onSelectFile(file)}
                className="p-4 hover:bg-surface-container transition-colors flex items-center justify-between gap-4 group cursor-pointer"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-surface-container-high flex items-center justify-center text-primary shrink-0 shadow-sm">
                    <span className="material-symbols-outlined text-lg">
                      {file.type === 'video' ? 'videocam' :
                       file.type === 'doc' ? 'picture_as_pdf' :
                       file.type === 'archive' ? 'folder_zip' :
                       file.type === 'code' ? 'data_object' : 'folder'}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 truncate">
                      <span className="text-sm text-on-surface font-medium truncate group-hover:text-primary transition-colors">
                        {file.name}
                      </span>
                      {file.tags[0] && (
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface-container text-secondary shrink-0">
                          {file.tags[0].label}
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-xs text-outline mt-0.5">
                      Updated {file.modified} by {file.collaborators[0]?.name || 'System'} · {file.size}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); onCopyFileLink(file); }}
                    className="p-1.5 rounded hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors"
                    title="Copy link"
                  >
                    <span className="material-symbols-outlined text-lg">link</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onSelectFile(file); onNavigateToAllFiles(); }}
                    className="p-1.5 rounded hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors"
                    title="Inspect & Preview"
                  >
                    <span className="material-symbols-outlined text-lg">visibility</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDownloadFile(file); }}
                    className="p-1.5 rounded hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors"
                    title="Download"
                  >
                    <span className="material-symbols-outlined text-lg">download</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Inline Media Vault Preview Banner */}
          <div className="p-6 rounded-xl bg-surface-container-low border border-white/5 shadow-sm relative overflow-hidden flex flex-col md:flex-row items-center gap-6">
            <div className="w-full md:w-48 h-32 rounded-lg bg-surface-container-high overflow-hidden shrink-0 relative">
              <img
                src={VAULT_REPLICA_IMAGE}
                alt="Architectural obsidian vault geometry"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-surface-container-lowest via-transparent to-transparent"></div>
              <span className="absolute bottom-2 left-2 font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface-container-lowest/80 text-secondary-fixed font-semibold">
                LIVE REPLICA
              </span>
            </div>
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-1.5 text-secondary-fixed-dim font-mono text-xs uppercase">
                <span className="material-symbols-outlined text-base">cloud_sync</span>
                <span>Autonomous Replication Active</span>
              </div>
              <h4 className="text-base text-on-surface font-semibold">Decentralized Sharding Node Active</h4>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Your enterprise partition is mirrored across 3 geo-redundant sovereign data vaults with end-to-end zero-knowledge proofs.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column (1 Col): Real-Time Telemetry & Active Transfers */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-mono text-xs uppercase tracking-wider text-outline">Real-Time Telemetry</span>
              <h3 className="text-lg text-on-surface font-semibold">Active Transfers</h3>
            </div>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-secondary-container/10 text-secondary font-medium">
              {transfersList.length} In Pipe
            </span>
          </div>

          <div className="p-5 rounded-xl bg-surface-container-low border border-white/5 shadow-sm space-y-4">
            {/* Complete Item */}
            <div className="p-3 rounded-lg bg-surface-container border border-white/5 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="material-symbols-outlined text-secondary-fixed-dim text-lg">check_circle</span>
                  <span className="text-xs text-on-surface font-medium truncate">design_tokens_v4.json</span>
                </div>
                <span className="font-mono text-xs text-secondary-fixed-dim">100%</span>
              </div>
              <div className="h-1 w-full bg-surface-container-highest rounded-full overflow-hidden">
                <div className="h-full bg-secondary-fixed-dim w-full"></div>
              </div>
              <div className="flex items-center justify-between font-mono text-[11px] text-outline">
                <span>Verified SHA-256</span>
                <span>180 KB</span>
              </div>
            </div>

            {/* Active Transfer */}
            {transfersList.some(t => t.id === 't-2') && (
              <div className="p-3 rounded-lg bg-surface-container border border-white/5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`material-symbols-outlined text-primary-container text-lg ${!isPaused ? 'animate-spin' : ''}`}>
                      sync
                    </span>
                    <span className="text-xs text-on-surface font-medium truncate">4k_product_reel_final.mp4</span>
                  </div>
                  <span className="font-mono text-xs text-primary">{activeProgress}%</span>
                </div>
                <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-container transition-all duration-300"
                    style={{ width: `${activeProgress}%` }}
                  ></div>
                </div>
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="text-on-surface-variant">3.28 GB / 4.20 GB</span>
                  <span className="text-secondary font-medium flex items-center gap-0.5">
                    <span className="material-symbols-outlined text-xs">north</span>
                    {isPaused ? 'Paused' : '85.4 MB/s'}
                  </span>
                </div>
              </div>
            )}

            {/* Queued Transfer */}
            <div className="p-3 rounded-lg bg-surface-container border border-white/5 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="material-symbols-outlined text-outline text-lg">hourglass_empty</span>
                  <span className="text-xs text-on-surface-variant font-medium truncate">contracts_signed.zip</span>
                </div>
                <span className="font-mono text-xs text-outline">Queued</span>
              </div>
              <div className="h-1 w-full bg-surface-container-highest rounded-full overflow-hidden">
                <div className="h-full bg-surface-container-highest w-0"></div>
              </div>
              <div className="flex items-center justify-between font-mono text-[11px] text-outline">
                <span>Waiting for pipe slot</span>
                <span>12.4 MB</span>
              </div>
            </div>

            {/* Transfer Control Footer */}
            <div className="pt-2 flex items-center justify-between border-t border-white/5">
              <button
                type="button"
                onClick={handleTogglePause}
                className="font-mono text-xs text-outline hover:text-on-surface transition-colors flex items-center gap-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">
                  {isPaused ? 'play_circle' : 'pause_circle'}
                </span>
                <span>{isPaused ? 'Resume All' : 'Pause All'}</span>
              </button>
              <button
                type="button"
                onClick={handleAbort}
                className="font-mono text-xs text-error hover:text-on-error-container transition-colors flex items-center gap-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">cancel</span>
                <span>Abort Transfer</span>
              </button>
            </div>
          </div>

          {/* Storage Health Status */}
          <div className="p-5 rounded-xl bg-surface-container-low border border-white/5 shadow-sm space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-outline uppercase tracking-wider">Sync Integrity</span>
              <span className="w-2 h-2 rounded-full bg-secondary-fixed-dim animate-ping"></span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-on-surface">End-to-End Latency</span>
              <span className="font-mono text-secondary-fixed">14 ms</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-on-surface">Hardware Vault HSM</span>
              <span className="text-primary font-medium">YubiHSM 2 Active</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-on-surface">Trash Purge Window</span>
              <button
                onClick={onNavigateToTrash}
                className="text-on-surface-variant hover:text-primary transition-colors cursor-pointer"
              >
                29 Days Remaining
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
