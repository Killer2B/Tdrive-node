import React, { useState } from 'react';
import { ExternalLink } from '../../types';

interface CreateShareDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (newLink: ExternalLink) => void;
  defaultTarget?: string;
}

export const CreateShareDrawer: React.FC<CreateShareDrawerProps> = ({
  isOpen,
  onClose,
  onCreated,
  defaultTarget = "Project_Titan_DueDiligence_2025"
}) => {
  const [vanity, setVanity] = useState("titan-advisory-2025");
  const [watermark, setWatermark] = useState(true);
  const [steganography, setSteganography] = useState(true);
  const [burnAfterRead, setBurnAfterRead] = useState(false);
  const [hasPassword, setHasPassword] = useState(true);
  const [password, setPassword] = useState("••••••••••••••••");
  const [ipFilter, setIpFilter] = useState("");
  const [expiryDays, setExpiryDays] = useState("7 Days");
  const [isSealing, setIsSealing] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSealing(true);

    setTimeout(() => {
      setIsSealing(false);
      const createdLink: ExternalLink = {
        id: `link-${Date.now()}`,
        targetName: defaultTarget,
        targetPath: `/vaults/shares/${vanity}`,
        targetType: 'folder',
        vanityEndpoint: `vaulta.to/p/${vanity}`,
        safeguards: [
          ...(hasPassword ? [{ label: "Password", icon: "key" }] : []),
          ...(watermark ? [{ label: "Watermark", icon: "water_drop", highlight: true }] : []),
          ...(burnAfterRead ? [{ label: "Burn-on-Read", icon: "local_fire_department", highlight: true }] : []),
          ...(ipFilter ? [{ label: "Domain IP", icon: "vpn_lock" }] : [{ label: "Zero-Knowledge", icon: "verified_user" }])
        ],
        quotaUsed: 0,
        quotaLimit: burnAfterRead ? 1 : 50,
        viewsCount: 0,
        telemetryNote: "0 concurrent",
        expiry: expiryDays === "24 Hours" ? "24h" : expiryDays === "7 Days" ? "7d" : expiryDays === "30 Days" ? "30d" : "Custom",
        isRevoked: false
      };
      onCreated(createdLink);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-md z-50 flex justify-end animate-in fade-in duration-200">
      <div 
        className="w-full max-w-xl bg-surface-container-low border-l border-white/10 shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-300"
      >
        {/* Drawer Header */}
        <div className="p-5 bg-surface-container flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary-container text-on-primary-container flex items-center justify-center shadow-md">
              <span className="material-symbols-outlined text-lg">shield_with_heart</span>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-on-surface">Provision Secure Share Enclave</h3>
              <span className="font-mono text-xs text-outline">Zero-Knowledge Token Configuration</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-surface-container-high text-outline hover:text-on-surface transition-colors"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Drawer Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Target Selection */}
          <div className="space-y-1.5">
            <label className="block font-mono text-xs text-on-surface-variant uppercase tracking-wider">
              Vault or Files to Mount
            </label>
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-surface-container-lowest border border-white/5">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-primary text-2xl">folder_zip</span>
                <div>
                  <span className="text-sm font-medium text-on-surface block">{defaultTarget}</span>
                  <span className="font-mono text-xs text-outline">18 items · 1.84 GB Encrypted Volume</span>
                </div>
              </div>
              <span className="font-mono text-xs text-secondary-fixed bg-surface-container-high px-2 py-0.5 rounded">
                Mounted
              </span>
            </div>
          </div>

          {/* Custom Vanity URL */}
          <div className="space-y-1.5">
            <label className="block font-mono text-xs text-on-surface-variant uppercase tracking-wider">
              Custom Vanity Access URL
            </label>
            <div className="flex items-center bg-surface-container-lowest border border-white/5 rounded-lg px-3 focus-within:border-primary-container transition-colors">
              <span className="font-mono text-sm text-outline">vaulta.to/p/</span>
              <input
                type="text"
                value={vanity}
                onChange={(e) => setVanity(e.target.value)}
                required
                className="w-full bg-transparent text-on-surface font-mono text-sm py-2.5 pl-1 border-0 focus:outline-none"
              />
            </div>
          </div>

          {/* Security Guardrails Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-outline uppercase tracking-wider">Security Controls & DRM</span>
              <span className="font-mono text-xs text-secondary-fixed">POLICY: ULTRA-SECURE</span>
            </div>

            {/* Dynamic Watermark */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-surface-container border border-white/5">
              <div className="flex items-start gap-3 pr-4">
                <span className="material-symbols-outlined text-primary mt-0.5 text-xl">branding_watermark</span>
                <div>
                  <span className="text-sm font-medium text-on-surface block">Dynamic Visual Watermarking</span>
                  <span className="text-xs text-outline">
                    Burns viewer's IP, email hash, and timestamp dynamically across every document and video frame.
                  </span>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={watermark}
                  onChange={(e) => setWatermark(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-surface-container-highest peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-container"></div>
              </label>
            </div>

            {/* Anti-Leak Steganographic Tracking */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-surface-container border border-white/5">
              <div className="flex items-start gap-3 pr-4">
                <span className="material-symbols-outlined text-secondary-fixed mt-0.5 text-xl">fingerprint</span>
                <div>
                  <span className="text-sm font-medium text-on-surface block">Anti-Leak Steganographic Tracking</span>
                  <span className="text-xs text-outline">
                    Embeds invisible cryptographic micro-patterns into PDFs to trace camera screen captures.
                  </span>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={steganography}
                  onChange={(e) => setSteganography(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-surface-container-highest peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-container"></div>
              </label>
            </div>

            {/* Burn after reading */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-surface-container border border-white/5">
              <div className="flex items-start gap-3 pr-4">
                <span className="material-symbols-outlined text-error mt-0.5 text-xl">local_fire_department</span>
                <div>
                  <span className="text-sm font-medium text-on-surface block">Expiring Burn-After-Reading</span>
                  <span className="text-xs text-outline">
                    Destroys decrypt keys instantly upon single completed inspection or threshold limit.
                  </span>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={burnAfterRead}
                  onChange={(e) => setBurnAfterRead(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-surface-container-highest peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-error"></div>
              </label>
            </div>

            {/* Password Protection */}
            <div className="p-3.5 rounded-xl bg-surface-container border border-white/5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-primary text-lg">password</span> Passcode Barrier
                </span>
                <span className="font-mono text-xs text-secondary-fixed">Argon2id Hash</span>
              </div>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-surface-container-lowest text-on-surface font-mono text-sm px-3 py-2 rounded-lg border border-white/5 focus:outline-none focus:border-primary-container transition-colors"
                placeholder="Enter enclave access key"
              />
            </div>

            {/* Restrict IP / Domain */}
            <div className="p-3.5 rounded-xl bg-surface-container border border-white/5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-outline text-lg">domain</span> Restrict IP CIDR or Verified Domain
                </span>
              </div>
              <input
                type="text"
                value={ipFilter}
                onChange={(e) => setIpFilter(e.target.value)}
                className="w-full bg-surface-container-lowest text-on-surface font-mono text-sm px-3 py-2 rounded-lg border border-white/5 focus:outline-none focus:border-primary-container transition-colors placeholder:text-outline"
                placeholder="e.g. 192.168.1.0/24 or @sequoia.com, @accel.com"
              />
            </div>

            {/* Expiry Duration Options */}
            <div className="grid grid-cols-4 gap-2 pt-1">
              {["24 Hours", "7 Days", "30 Days", "Custom"].map((duration) => (
                <button
                  type="button"
                  key={duration}
                  onClick={() => setExpiryDays(duration)}
                  className={`py-2 rounded font-mono text-xs text-center transition-colors ${
                    expiryDays === duration
                      ? 'bg-primary-container text-on-primary-container font-semibold shadow-sm'
                      : 'bg-surface-container text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  {duration}
                </button>
              ))}
            </div>
          </div>

          {/* Drawer Footer Actions */}
          <div className="p-5 bg-surface-container border-t border-white/5 flex items-center justify-between gap-4 -mx-6 -mb-6 mt-6">
            <button
              type="button"
              onClick={onClose}
              disabled={isSealing}
              className="px-4 py-2.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface font-mono text-xs transition-colors"
            >
              Discard Enclave
            </button>
            <button
              type="submit"
              disabled={isSealing}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-container hover:bg-secondary-container hover:text-on-secondary-fixed-variant text-on-primary-container font-semibold text-sm rounded-lg shadow-lg shadow-primary-container/20 transition-all cursor-pointer"
            >
              {isSealing ? (
                <>
                  <span className="material-symbols-outlined text-base animate-spin">sync</span>
                  <span>Sealing Cryptographic Enclave...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-base">lock</span>
                  <span>Generate Cryptographic Share</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
