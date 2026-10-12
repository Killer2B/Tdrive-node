import React, { useState, useEffect } from 'react';
import * as api from '../../api';

interface SettingsViewProps {
  onSaved: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onSaved }) => {
  const [encryptionStandard, setEncryptionStandard] = useState('kyber-1024');
  const [autoExpand, setAutoExpand] = useState(true);
  const [watermarkTemplate, setWatermarkTemplate] = useState('{{user_email}} · {{ip_address}} · {{session_hash}} · {{timestamp}}');
  const [retentionDays, setRetentionDays] = useState('30');
  const [clusterRegion, setClusterRegion] = useState('eu-frankfurt');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.settings
      .get()
      .then((r) => {
        const s = r.settings as Record<string, string | boolean>;
        if (typeof s.encryptionStandard === 'string') setEncryptionStandard(s.encryptionStandard);
        if (typeof s.autoExpand === 'boolean') setAutoExpand(s.autoExpand);
        if (typeof s.watermarkTemplate === 'string') setWatermarkTemplate(s.watermarkTemplate);
        if (typeof s.retentionDays === 'string') setRetentionDays(s.retentionDays);
        if (typeof s.clusterRegion === 'string') setClusterRegion(s.clusterRegion);
      })
      .catch(() => {});
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.settings.save({ encryptionStandard, autoExpand, watermarkTemplate, retentionDays, clusterRegion });
      onSaved();
    } catch {
      /* يتجاهل؛ onSaved لن يُستدعى عند الفشل */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative w-full px-8 py-6 space-y-8 max-w-[1200px] mx-auto">
      <div>
        <div className="flex items-center gap-1.5 text-outline font-mono text-xs uppercase tracking-wider mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary-fixed-dim"></span>
          <span>Security Policy & Enclave Governance</span>
        </div>
        <h1 className="text-3xl text-on-surface tracking-tight font-semibold">
          Workspace Settings
        </h1>
        <p className="text-sm text-outline mt-1">
          Configure cryptographic algorithms, hardware HSM integration, forensic watermarks, and auto-purging windows.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Encryption Algorithm */}
        <div className="p-6 rounded-xl bg-surface-container-low border border-white/5 space-y-4 shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-on-surface">Cryptographic Algorithm Suite</h3>
              <p className="text-xs text-outline mt-0.5">Primary symmetric and post-quantum key encapsulation mechanism.</p>
            </div>
            <span className="font-mono text-xs px-2.5 py-0.5 rounded bg-surface-container-high text-secondary-fixed">
              Hardware Attested
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
            <div
              onClick={() => setEncryptionStandard('kyber-1024')}
              className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                encryptionStandard === 'kyber-1024'
                  ? 'bg-surface-container border-primary-container shadow-md'
                  : 'bg-surface-container-lowest border-white/5 opacity-70 hover:opacity-100'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-on-surface">Kyber-1024 + AES-256-GCM</span>
                  {encryptionStandard === 'kyber-1024' && (
                    <span className="material-symbols-outlined text-primary text-base">check_circle</span>
                  )}
                </div>
                <p className="text-xs text-outline mt-1.5 leading-relaxed">
                  Post-quantum lattice security with hardware-isolated ephemeral key derivation. Default for high-security enclaves.
                </p>
              </div>
              <span className="font-mono text-[11px] text-secondary-fixed mt-3">NIST Standardized 2024</span>
            </div>

            <div
              onClick={() => setEncryptionStandard('aes-256-standard')}
              className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                encryptionStandard === 'aes-256-standard'
                  ? 'bg-surface-container border-primary-container shadow-md'
                  : 'bg-surface-container-lowest border-white/5 opacity-70 hover:opacity-100'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-on-surface">Standard AES-256-GCM</span>
                  {encryptionStandard === 'aes-256-standard' && (
                    <span className="material-symbols-outlined text-primary text-base">check_circle</span>
                  )}
                </div>
                <p className="text-xs text-outline mt-1.5 leading-relaxed">
                  High-throughput hardware acceleration via AES-NI instructions. Optimized for massive 8K video streaming pipelines.
                </p>
              </div>
              <span className="font-mono text-[11px] text-outline mt-3">FIPS 140-3 Level 3</span>
            </div>
          </div>
        </div>

        {/* Forensic Watermark Template */}
        <div className="p-6 rounded-xl bg-surface-container-low border border-white/5 space-y-4 shadow-xl">
          <div>
            <h3 className="text-base font-semibold text-on-surface">Dynamic Watermark Formula</h3>
            <p className="text-xs text-outline mt-0.5">
              Template burned into client video frames and PDF vector trees to prevent unauthorized leaks.
            </p>
          </div>
          <div className="space-y-2">
            <input
              type="text"
              value={watermarkTemplate}
              onChange={(e) => setWatermarkTemplate(e.target.value)}
              className="w-full bg-surface-container-lowest border border-white/5 text-on-surface font-mono text-xs p-3 rounded-lg focus:outline-none focus:border-primary-container"
            />
            <div className="flex items-center gap-2 font-mono text-[11px] text-outline">
              <span>Available tokens:</span>
              <span className="text-secondary-fixed">{"{{user_email}}"}</span>
              <span className="text-secondary-fixed">{"{{ip_address}}"}</span>
              <span className="text-secondary-fixed">{"{{session_hash}}"}</span>
              <span className="text-secondary-fixed">{"{{timestamp}}"}</span>
            </div>
          </div>
        </div>

        {/* Sovereign Region & Quota Rules */}
        <div className="p-6 rounded-xl bg-surface-container-low border border-white/5 space-y-4 shadow-xl">
          <h3 className="text-base font-semibold text-on-surface">Cluster Routing & Auto-Expansion</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block font-mono text-xs text-outline uppercase tracking-wider">
                Primary Cryptographic Sovereign Cluster
              </label>
              <select
                value={clusterRegion}
                onChange={(e) => setClusterRegion(e.target.value)}
                className="w-full bg-surface-container-lowest border border-white/5 text-on-surface font-mono text-xs p-3 rounded-lg focus:outline-none focus:border-primary-container"
              >
                <option value="eu-frankfurt">EU Sovereign • Frankfurt-01 (GDPR Strict Air-Gap)</option>
                <option value="us-east-04">US East • AWS CloudHSM Sovereign Enclave #04</option>
                <option value="ap-tokyo">Asia-Pacific • Tokyo Tier-IV Sovereign Vault</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block font-mono text-xs text-outline uppercase tracking-wider">
                Trash Shredding Window
              </label>
              <select
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
                className="w-full bg-surface-container-lowest border border-white/5 text-on-surface font-mono text-xs p-3 rounded-lg focus:outline-none focus:border-primary-container"
              >
                <option value="14">14 Days Multi-Pass Shredding</option>
                <option value="30">30 Days Standard Enterprise Retention</option>
                <option value="90">90 Days Extended Compliance Archive</option>
              </select>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between p-3.5 rounded-lg bg-surface-container border border-white/5">
            <div>
              <span className="text-sm font-medium text-on-surface block">Automatic Storage Auto-Expand</span>
              <span className="text-xs text-outline">
                Automatically allocate +5 TB block when volume reaches 90% threshold to avoid pipe choke.
              </span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={autoExpand}
                onChange={(e) => setAutoExpand(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-surface-container-highest peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-container"></div>
            </label>
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-primary-container hover:bg-secondary-container hover:text-on-secondary-fixed-variant text-on-primary-container font-mono text-xs font-semibold rounded-lg shadow-lg transition-all cursor-pointer disabled:opacity-50"
          >
            {saving ? 'يحفظ…' : 'حفظ الإعدادات'}
          </button>
        </div>
      </form>
    </div>
  );
};
