import React, { useState } from 'react';
import { ClientNode } from '../../types';

interface SecurityAuditViewProps {
  clientNodes: ClientNode[];
  onRevokeNode: (nodeId: string) => void;
  onOpenDeduplication: () => void;
  onEmptyStaleTrash: () => void;
  onConvertTiffs: () => void;
  onRecalculateQuotas: () => void;
  onOpenZeroOutModal: () => void;
  onExportAuditLog: () => void;
  storageUsedTB: number;
  storageTotalTB: number;
}

export const SecurityAuditView: React.FC<SecurityAuditViewProps> = ({
  clientNodes,
  onRevokeNode,
  onOpenDeduplication,
  onEmptyStaleTrash,
  onConvertTiffs,
  onRecalculateQuotas,
  onOpenZeroOutModal,
  onExportAuditLog,
  storageUsedTB,
  storageTotalTB
}) => {
  const [horizonRange, setHorizonRange] = useState<'6m' | '1y' | 'pred'>('6m');
  const [isRecalculating, setIsRecalculating] = useState(false);

  const utilizationPercent = ((storageUsedTB / storageTotalTB) * 100).toFixed(1);

  const handleRecalc = () => {
    setIsRecalculating(true);
    setTimeout(() => {
      setIsRecalculating(false);
      onRecalculateQuotas();
    }, 1200);
  };

  return (
    <div className="relative w-full px-8 py-6 space-y-8 max-w-[1600px] mx-auto">
      {/* Context Bar */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-primary font-mono text-xs uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary-container animate-pulse"></span>
            <span>Telemetry Node #804 • Frankfurt-01 Cluster</span>
          </div>
          <h1 className="text-3xl text-on-surface tracking-tight font-semibold">
            System Telemetry, Storage Quota & Cryptographic Security
          </h1>
          <p className="text-sm text-outline">
            Continuous zero-knowledge storage ledger, cryptographic block deduplication metrics, and hardware security posture.
          </p>
        </div>
        <div className="flex items-center gap-2.5 self-start md:self-auto">
          <button
            type="button"
            onClick={onExportAuditLog}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-mono text-xs rounded-lg transition-colors shadow-sm cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">history</span>
            <span>Audit Log Export</span>
          </button>
          <button
            type="button"
            onClick={handleRecalc}
            disabled={isRecalculating}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary-container text-on-primary-container font-mono text-xs font-semibold rounded-lg shadow-md hover:bg-secondary-container hover:text-on-secondary-fixed-variant transition-all cursor-pointer"
          >
            <span className={`material-symbols-outlined text-base ${isRecalculating ? 'animate-spin' : ''}`}>
              bolt
            </span>
            <span>{isRecalculating ? 'Computing Merkle Tree...' : 'Recalculate Hash Quotas'}</span>
          </button>
        </div>
      </div>

      {/* Top Bento: Primary Radial Storage + Deduplication Hub + 6-Month Projection */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Card 1: Main Vault Dial Visualizer (5 Cols) */}
        <div className="lg:col-span-5 bg-surface-container-low border border-white/5 rounded-xl p-6 flex flex-col justify-between shadow-xl relative overflow-hidden">
          <div className="absolute -right-16 -top-16 w-56 h-56 bg-primary-container/10 rounded-full blur-3xl pointer-events-none"></div>
          
          <div className="flex items-center justify-between pb-4">
            <div>
              <span className="font-mono text-xs text-outline uppercase tracking-wider">Allocated Volume</span>
              <div className="text-xl font-semibold text-on-surface mt-0.5">Primary Storage Quota</div>
            </div>
            <span className="px-2 py-0.5 bg-surface-container-high text-secondary-fixed-dim rounded font-mono text-xs">
              AES-256-GCM
            </span>
          </div>

          {/* Radial Gauge */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 py-4">
            <div className="relative w-52 h-52 flex items-center justify-center shrink-0">
              <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 160 160">
                <circle
                  cx="80"
                  cy="80"
                  r="66"
                  fill="transparent"
                  stroke="#272a31"
                  strokeWidth="12"
                  strokeLinecap="round"
                />
                <circle
                  cx="80"
                  cy="80"
                  r="66"
                  fill="transparent"
                  stroke="#2f91ff"
                  strokeWidth="12"
                  strokeDasharray="414"
                  strokeDashoffset="130"
                  strokeLinecap="round"
                  className="transition-all duration-1000"
                />
                <circle
                  cx="80"
                  cy="80"
                  r="66"
                  fill="transparent"
                  stroke="#00eefc"
                  strokeWidth="12"
                  strokeDasharray="414"
                  strokeDashoffset="260"
                  strokeLinecap="round"
                />
                <circle
                  cx="80"
                  cy="80"
                  r="66"
                  fill="transparent"
                  stroke="#bbc7db"
                  strokeWidth="12"
                  strokeDasharray="414"
                  strokeDashoffset="350"
                  strokeLinecap="round"
                />
              </svg>
              {/* Dial Center Stats */}
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="font-mono text-[11px] text-outline uppercase tracking-wider">Utilization</span>
                <span className="text-3xl font-bold text-on-surface tracking-tight font-mono">{utilizationPercent}%</span>
                <span className="font-mono text-xs text-secondary-fixed font-medium">
                  {storageUsedTB.toFixed(2)} / {storageTotalTB.toFixed(2)} TB
                </span>
              </div>
            </div>

            {/* Quick breakdown indicators */}
            <div className="flex flex-col gap-2 w-full sm:w-auto font-mono text-xs">
              <div className="p-2 px-3 rounded bg-surface-container-high/60 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary-container"></span>
                  <span className="text-on-surface">Media Assets</span>
                </div>
                <span className="text-on-surface-variant font-medium">1.64 TB</span>
              </div>
              <div className="p-2 px-3 rounded bg-surface-container-high/60 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-secondary-container"></span>
                  <span className="text-on-surface">Raw Archives</span>
                </div>
                <span className="text-on-surface-variant font-medium">0.98 TB</span>
              </div>
              <div className="p-2 px-3 rounded bg-surface-container-high/60 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-tertiary"></span>
                  <span className="text-on-surface">Snapshots & VM</span>
                </div>
                <span className="text-on-surface-variant font-medium">0.45 TB</span>
              </div>
              <div className="p-2 px-3 rounded bg-surface-container-high/60 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-outline"></span>
                  <span className="text-on-surface">Documents & Code</span>
                </div>
                <span className="text-on-surface-variant font-medium">0.35 TB</span>
              </div>
            </div>
          </div>

          {/* Footnote Deduplication Banner */}
          <div className="p-4 rounded-lg bg-surface-container border border-white/5 flex items-center justify-between gap-4 mt-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary-container/20 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-lg">grain</span>
              </div>
              <div>
                <div className="font-mono text-xs text-on-surface font-semibold">840 GB Deduplicated</div>
                <div className="font-mono text-[11px] text-outline">Content-addressed zero-loss compression saves 16.8% footprint</div>
              </div>
            </div>
            <span className="font-mono text-xs text-secondary-fixed bg-surface-container-high px-2 py-0.5 rounded">
              Ratio 1.24x
            </span>
          </div>
        </div>

        {/* Card 2: 6-Month Storage Forecast & Growth Sparkline (7 Cols) */}
        <div className="lg:col-span-7 bg-surface-container-low border border-white/5 rounded-xl p-6 flex flex-col justify-between shadow-xl relative overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <div>
              <span className="font-mono text-xs text-outline uppercase tracking-wider">Predictive Ingestion</span>
              <div className="text-xl font-semibold text-on-surface mt-0.5">Storage Growth & Burn Horizon</div>
            </div>
            <div className="flex items-center gap-1 bg-surface-container-high p-0.5 rounded-lg border border-white/5 font-mono text-xs">
              <button
                type="button"
                onClick={() => setHorizonRange('6m')}
                className={`px-3 py-1 rounded transition-colors ${horizonRange === '6m' ? 'bg-primary-container text-on-primary-container font-medium' : 'text-on-surface-variant hover:text-on-surface'}`}
              >
                6 Months
              </button>
              <button
                type="button"
                onClick={() => setHorizonRange('1y')}
                className={`px-3 py-1 rounded transition-colors ${horizonRange === '1y' ? 'bg-primary-container text-on-primary-container font-medium' : 'text-on-surface-variant hover:text-on-surface'}`}
              >
                1 Year
              </button>
              <button
                type="button"
                onClick={() => setHorizonRange('pred')}
                className={`px-3 py-1 rounded transition-colors ${horizonRange === 'pred' ? 'bg-primary-container text-on-primary-container font-medium' : 'text-on-surface-variant hover:text-on-surface'}`}
              >
                Predictive
              </button>
            </div>
          </div>

          {/* Forecast Area Curve */}
          <div className="w-full flex-1 flex flex-col justify-end pt-4">
            <div className="h-44 w-full relative">
              <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 600 160">
                <line x1="0" x2="600" y1="20" y2="20" stroke="#272a31" strokeWidth="1" strokeDasharray="4 4" />
                <line x1="0" x2="600" y1="70" y2="70" stroke="#272a31" strokeWidth="1" strokeDasharray="4 4" />
                <line x1="0" x2="600" y1="120" y2="120" stroke="#272a31" strokeWidth="1" strokeDasharray="4 4" />
                
                {/* Area Fill */}
                <path
                  d="M 0 140 L 90 128 L 200 112 L 310 94 L 420 68 L 520 44 L 600 24 L 600 160 L 0 160 Z"
                  fill="url(#growthGradient)"
                  opacity="0.4"
                />
                {/* Solid Line */}
                <path
                  d="M 0 140 L 90 128 L 200 112 L 310 94 L 420 68 L 520 44 L 600 24"
                  fill="none"
                  stroke="#2f91ff"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
                {/* Extrapolation dash */}
                <line x1="420" x2="600" y1="68" y2="24" stroke="#00eefc" strokeWidth="2" strokeDasharray="5 5" />

                {/* Nodes */}
                <circle cx="90" cy="128" r="4" fill="#10131a" stroke="#2f91ff" strokeWidth="2" />
                <circle cx="200" cy="112" r="4" fill="#10131a" stroke="#2f91ff" strokeWidth="2" />
                <circle cx="310" cy="94" r="4" fill="#10131a" stroke="#2f91ff" strokeWidth="2" />
                <circle cx="420" cy="68" r="5" fill="#00eefc" stroke="#10131a" strokeWidth="2" />
                <circle cx="520" cy="44" r="4" fill="#10131a" stroke="#00eefc" strokeWidth="2" />
                <circle cx="600" cy="24" r="4" fill="#10131a" stroke="#00eefc" strokeWidth="2" />

                <defs>
                  <linearGradient id="growthGradient" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#2f91ff" stopOpacity="0.5" />
                    <stop offset="100%" stopColor="#2f91ff" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
              </svg>
            </div>

            {/* X-Axis Labels */}
            <div className="flex justify-between items-center pt-2 font-mono text-[11px] text-outline">
              <span>Nov '24 (1.8 TB)</span>
              <span>Dec '24 (2.1 TB)</span>
              <span>Jan '25 (2.5 TB)</span>
              <span className="text-primary font-medium">Feb '25 (Current)</span>
              <span className="text-secondary-fixed">Mar '25 (Est. 4.1 TB)</span>
              <span className="text-secondary-fixed">Apr '25 (Est. 4.8 TB)</span>
            </div>
          </div>

          {/* Horizon Stat Ticker */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-6">
            <div className="p-4 bg-surface-container border border-white/5 rounded-lg">
              <span className="font-mono text-xs text-outline">Net Ingest Velocity</span>
              <div className="text-lg font-bold text-on-surface font-mono mt-1">
                +28.4 GB<span className="text-xs text-outline font-normal">/day</span>
              </div>
            </div>
            <div className="p-4 bg-surface-container border border-white/5 rounded-lg">
              <span className="font-mono text-xs text-outline">Runway Horizon</span>
              <div className="text-lg font-bold text-secondary-fixed font-mono mt-1">
                ~54 Days<span className="text-xs text-outline font-normal"> left</span>
              </div>
            </div>
            <div className="p-4 bg-surface-container border border-white/5 rounded-lg">
              <span className="font-mono text-xs text-outline">Auto-Expand Threshold</span>
              <div className="text-lg font-bold text-primary font-mono mt-1">
                4.50 TB (90%)
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Optimization Matrix & Recommendations */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl">auto_fix_high</span>
            <h2 className="text-xl font-semibold text-on-surface">Cleanup & Deduplication Recommendations</h2>
          </div>
          <span className="font-mono text-xs text-outline">
            Potential Savings: <strong className="text-secondary-fixed font-semibold">67.4 GB</strong>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Rec 1: Video Duplicate Renders */}
          <div className="bg-surface-container-low border border-white/5 rounded-xl p-5 flex flex-col justify-between shadow-lg relative group hover:bg-surface-container transition-all">
            <div className="space-y-2.5">
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 rounded-lg bg-surface-container-high flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined text-2xl">movie_filter</span>
                </div>
                <span className="px-2 py-0.5 rounded font-mono text-[11px] bg-primary-container/20 text-primary font-medium">
                  Save 42.8 GB
                </span>
              </div>
              <div>
                <div className="text-base font-semibold text-on-surface">14 Duplicate Video Renders</div>
                <p className="text-xs text-outline mt-1 leading-relaxed">
                  Identified identical sha256 byte-streams matching ProRes & H.265 master proxy cuts across workspace campaigns.
                </p>
              </div>
              <div className="p-2 bg-surface-container-lowest border border-white/5 rounded font-mono text-[11px] text-on-surface-variant flex items-center justify-between">
                <span className="truncate">/vault/renders/v2_final_4k.mov</span>
                <span className="text-outline">×3 clones</span>
              </div>
            </div>
            <div className="pt-4 mt-4 border-t border-white/5 flex items-center gap-2">
              <button
                type="button"
                onClick={onOpenDeduplication}
                className="flex-1 py-2 bg-primary-container text-on-primary-container font-mono text-xs rounded-lg font-medium hover:bg-secondary-container hover:text-on-secondary-fixed-variant transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
              >
                <span className="material-symbols-outlined text-base">cleaning_services</span>
                <span>Review & Purge</span>
              </button>
            </div>
          </div>

          {/* Rec 2: Stale Trash Purge */}
          <div className="bg-surface-container-low border border-white/5 rounded-xl p-5 flex flex-col justify-between shadow-lg relative group hover:bg-surface-container transition-all">
            <div className="space-y-2.5">
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 rounded-lg bg-surface-container-high flex items-center justify-center text-secondary-fixed-dim">
                  <span className="material-symbols-outlined text-2xl">delete_sweep</span>
                </div>
                <span className="px-2 py-0.5 rounded font-mono text-[11px] bg-secondary-container/20 text-secondary-fixed font-medium">
                  Save 18.2 GB
                </span>
              </div>
              <div>
                <div className="text-base font-semibold text-on-surface">Trash Items &gt; 30 Days</div>
                <p className="text-xs text-outline mt-1 leading-relaxed">
                  Deleted workspace files, deprecated design branches, and ephemeral sandbox states past retention policies.
                </p>
              </div>
              <div className="p-2 bg-surface-container-lowest border border-white/5 rounded font-mono text-[11px] text-on-surface-variant flex items-center justify-between">
                <span>324 objects pending shredding</span>
                <span className="text-outline">Expire now</span>
              </div>
            </div>
            <div className="pt-4 mt-4 border-t border-white/5 flex items-center gap-2">
              <button
                type="button"
                onClick={onEmptyStaleTrash}
                className="flex-1 py-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-mono text-xs rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">delete_forever</span>
                <span>Empty Stale Trash</span>
              </button>
            </div>
          </div>

          {/* Rec 3: Uncompressed Raw TIFFs */}
          <div className="bg-surface-container-low border border-white/5 rounded-xl p-5 flex flex-col justify-between shadow-lg relative group hover:bg-surface-container transition-all">
            <div className="space-y-2.5">
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 rounded-lg bg-surface-container-high flex items-center justify-center text-tertiary">
                  <span className="material-symbols-outlined text-2xl">tune</span>
                </div>
                <span className="px-2 py-0.5 rounded font-mono text-[11px] bg-surface-container-highest text-tertiary font-medium">
                  Save 6.4 GB
                </span>
              </div>
              <div>
                <div className="text-base font-semibold text-on-surface">Uncompressed Raw TIFFs</div>
                <p className="text-xs text-outline mt-1 leading-relaxed">
                  Batch compress raster production assets to AVIF Lossless. Pixel-perfect fidelity with 62% smaller container footings.
                </p>
              </div>
              <div className="p-2 bg-surface-container-lowest border border-white/5 rounded font-mono text-[11px] text-on-surface-variant flex items-center justify-between">
                <span>96 RAW assets</span>
                <span className="text-secondary-fixed">Lossless 1:1</span>
              </div>
            </div>
            <div className="pt-4 mt-4 border-t border-white/5 flex items-center gap-2">
              <button
                type="button"
                onClick={onConvertTiffs}
                className="flex-1 py-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-mono text-xs rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">transform</span>
                <span>Convert to AVIF</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Cryptographic Security Fabric & Session Governance */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: HSM Encryption Key & Recovery Posture (7 Cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-surface-container-low border border-white/5 rounded-xl p-6 shadow-xl space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center text-on-primary-container shadow-md">
                  <span className="material-symbols-outlined text-lg">enhanced_encryption</span>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-on-surface">Cryptographic Security Fabric</h3>
                  <span className="font-mono text-xs text-outline">Post-Quantum Lattice Seeded • Kyber-1024</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 font-mono text-xs text-secondary-fixed-dim bg-surface-container px-3 py-1 rounded border border-white/5">
                <span className="w-2 h-2 rounded-full bg-secondary-fixed-dim animate-ping"></span>
                <span>Hardware Attested</span>
              </div>
            </div>

            {/* Master Key Status Pill Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-surface-container border border-white/5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-outline">Master Encryption Key</span>
                  <span className="material-symbols-outlined text-primary text-base">verified_user</span>
                </div>
                <div className="text-sm font-medium text-on-surface">HSM Backed • Passkey Verified</div>
                <div className="font-mono text-[11px] text-outline truncate">FIPS 140-3 L3 • AWS CloudHSM ID #hsm-0a88f</div>
              </div>

              <div className="p-4 rounded-lg bg-surface-container border border-white/5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-outline">Zero-Knowledge Recovery</span>
                  <span className="material-symbols-outlined text-secondary-fixed text-base">key</span>
                </div>
                <div className="text-sm font-medium text-on-surface">Backed up to YubiKey (Slot 2)</div>
                <div className="font-mono text-[11px] text-outline truncate">FIDO2/WebAuthn Token: YK-5C-NFC-9844</div>
              </div>

              <div className="p-4 rounded-lg bg-surface-container border border-white/5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-outline">Sharding & Erasure Coding</span>
                  <span className="material-symbols-outlined text-tertiary text-base">hub</span>
                </div>
                <div className="text-sm font-medium text-on-surface">Reed-Solomon 8+4 Multi-Region</div>
                <div className="font-mono text-[11px] text-outline">Tolerates up to 4 concurrent node failures</div>
              </div>

              <div className="p-4 rounded-lg bg-surface-container border border-white/5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-outline">Audit Hash Verification</span>
                  <span className="material-symbols-outlined text-primary text-base">security_update_good</span>
                </div>
                <div className="text-sm font-medium text-on-surface">Merkle Root Synchronized</div>
                <div className="font-mono text-[11px] text-outline">Latest Block #14,892,109 (0.4s ago)</div>
              </div>
            </div>

            {/* Compliance Badges Banner */}
            <div className="p-4 rounded-xl bg-surface-container-high/40 border border-white/5 flex flex-wrap items-center justify-between gap-4">
              <span className="font-mono text-xs text-outline uppercase tracking-wider">Certified Compliance:</span>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 px-3 py-1 rounded bg-surface-container text-on-surface font-mono text-xs">
                  <span className="material-symbols-outlined text-primary text-base">check_circle</span>
                  <span>SOC2 Type II</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 rounded bg-surface-container text-on-surface font-mono text-xs">
                  <span className="material-symbols-outlined text-secondary-fixed text-base">check_circle</span>
                  <span>HIPAA Compliant</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 rounded bg-surface-container text-on-surface font-mono text-xs">
                  <span className="material-symbols-outlined text-tertiary text-base">shield</span>
                  <span>GDPR Sovereign (EU-Frankfurt)</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Device Matrix & Active Client Nodes (5 Cols) */}
        <div className="lg:col-span-5 bg-surface-container-low border border-white/5 rounded-xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4">
              <div>
                <span className="font-mono text-xs text-outline uppercase tracking-wider">Device Matrix</span>
                <div className="text-lg font-semibold text-on-surface mt-0.5">Active Client Nodes</div>
              </div>
              <span className="px-2 py-0.5 bg-surface-container-high text-on-surface-variant font-mono text-xs rounded">
                {clientNodes.filter(n => !n.isRevoked).length} Authenticated
              </span>
            </div>

            {/* Session List */}
            <div className="space-y-2.5">
              {clientNodes.map((node) => (
                <div
                  key={node.id}
                  className="p-3.5 rounded-lg bg-surface-container border border-white/5 flex items-start justify-between gap-3 transition-colors hover:bg-surface-container-high"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary-container/20 text-primary flex items-center justify-center shrink-0 mt-0.5">
                      <span className="material-symbols-outlined text-base">
                        {node.deviceType === 'laptop' ? 'laptop_mac' :
                         node.deviceType === 'desktop' ? 'desktop_windows' : 'tablet_mac'}
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm text-on-surface font-medium">{node.name}</span>
                        {node.isCurrent && (
                          <span className="px-1.5 py-0.2 bg-primary-container text-on-primary-container font-mono text-[10px] rounded">
                            Current
                          </span>
                        )}
                        {node.isRevoked && (
                          <span className="px-1.5 py-0.2 bg-error-container text-on-error-container font-mono text-[10px] rounded">
                            Revoked
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[11px] text-outline mt-0.5">
                        {node.location} • IP {node.ip}
                      </div>
                      <div className="font-mono text-[11px] text-secondary-fixed mt-0.5">
                        {node.enclaveId} • {node.activeStatus}
                      </div>
                    </div>
                  </div>

                  {node.isCurrent ? (
                    <span className="material-symbols-outlined text-primary text-base">lock</span>
                  ) : node.isRevoked ? (
                    <span className="font-mono text-[11px] text-outline">Purged</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onRevokeNode(node.id)}
                      className="text-error hover:text-error-container font-mono text-xs px-2 py-1 rounded hover:bg-error-container/20 transition-colors cursor-pointer"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Emergency Cryptographic Zero-Out Action */}
          <div className="pt-4 mt-6 border-t border-white/5 flex items-center justify-between bg-error-container/20 p-3 rounded-lg border border-error/30">
            <div className="flex items-center gap-2 text-error">
              <span className="material-symbols-outlined text-lg">gavel</span>
              <span className="font-mono text-xs font-semibold">Emergency Cryptographic Zero-Out</span>
            </div>
            <button
              type="button"
              onClick={onOpenZeroOutModal}
              className="px-3 py-1.5 bg-error-container text-on-error-container hover:bg-error hover:text-on-error rounded font-mono text-xs font-semibold transition-colors cursor-pointer shadow-md"
            >
              Wipe All Peers
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
