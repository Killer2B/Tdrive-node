import React, { useState } from 'react';
import { ViewMode } from '../types';
import { USER_AVATAR } from '../data/mockData';

interface SidebarProps {
  currentView: ViewMode;
  onNavigate: (view: ViewMode) => void;
  onOpenUpload: () => void;
  onOpenUpgrade: () => void;
  storageUsedTB: number;
  storageTotalTB: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  onOpenUpload,
  onOpenUpgrade,
  storageUsedTB,
  storageTotalTB
}) => {
  const [showUploadMenu, setShowUploadMenu] = useState(false);
  const [showTenantMenu, setShowTenantMenu] = useState(false);
  const [activeTenant, setActiveTenant] = useState('Acme');

  const navItems: { id: ViewMode; label: string; icon: string; section: 'workspace' | 'management' }[] = [
    { id: 'overview', label: 'Overview', icon: 'dashboard', section: 'workspace' },
    { id: 'all-files', label: 'All Files', icon: 'folder_open', section: 'workspace' },
    { id: 'recent-starred', label: 'Recent & Starred', icon: 'star', section: 'workspace' },
    { id: 'shared-vaults', label: 'Shared Vaults', icon: 'folder_shared', section: 'workspace' },
    { id: 'recovery-trash', label: 'Recovery / Trash', icon: 'delete_outline', section: 'management' },
    { id: 'security-access', label: 'Security & Audit', icon: 'shield', section: 'management' },
    { id: 'workspace-settings', label: 'Settings', icon: 'settings', section: 'management' },
  ];

  const utilizationPercent = Math.min(100, Math.round((storageUsedTB / storageTotalTB) * 100));

  return (
    <aside className="fixed left-0 top-0 h-screen w-72 bg-surface-container-lowest flex flex-col z-50 border-r border-white/5 shadow-[0_0_24px_rgba(0,0,0,0.4)]">
      {/* Brand Header */}
      <div className="p-5 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-primary-container flex items-center justify-center text-on-primary-container shadow-[0_0_12px_rgba(47,145,255,0.3)]">
            <span className="material-symbols-outlined text-lg">lock</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xl font-bold tracking-tight text-on-surface">Vaulta</span>
            <span className="font-mono text-[10px] uppercase bg-surface-container-high px-1.5 py-0.5 rounded text-secondary font-semibold">
              Pro
            </span>
          </div>
        </div>

        {/* Tenant Switcher */}
        <div className="relative">
          <button
            onClick={() => setShowTenantMenu(!showTenantMenu)}
            type="button"
            className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface text-xs font-mono transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-secondary-container animate-pulse"></span>
            <span>{activeTenant}</span>
            <span className="material-symbols-outlined text-xs">unfold_more</span>
          </button>

          {showTenantMenu && (
            <div className="absolute right-0 top-8 w-44 rounded-xl bg-surface-container border border-white/10 shadow-2xl py-1 z-50 animate-in fade-in duration-150">
              <div className="px-3 py-1.5 text-[10px] font-mono text-outline uppercase">Tenants & Enclaves</div>
              {['Acme', 'Starlight Capital', 'Studio Berlin', 'Sovereign Lab'].map((t) => (
                <button
                  key={t}
                  onClick={() => { setActiveTenant(t); setShowTenantMenu(false); }}
                  className={`w-full px-3 py-1.5 text-xs text-left flex items-center justify-between hover:bg-surface-container-high transition-colors ${
                    activeTenant === t ? 'text-primary font-medium' : 'text-on-surface-variant'
                  }`}
                >
                  <span>{t}</span>
                  {activeTenant === t && <span className="material-symbols-outlined text-sm">check</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* New Upload Button with Dropdown */}
      <div className="px-5 py-3 relative">
        <div className="flex rounded-lg overflow-hidden shadow-[0_4px_16px_rgba(47,145,255,0.25)]">
          <button
            onClick={onOpenUpload}
            type="button"
            className="flex-1 flex items-center gap-2 px-4 py-2.5 bg-primary-container text-on-primary-container text-sm font-semibold hover:bg-secondary-container hover:text-on-secondary-fixed-variant transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-lg">add_circle</span>
            <span>New Upload</span>
          </button>
          <button
            onClick={() => setShowUploadMenu(!showUploadMenu)}
            type="button"
            className="px-2.5 bg-primary-container text-on-primary-container border-l border-white/20 hover:bg-secondary-container hover:text-on-secondary-fixed-variant transition-colors flex items-center justify-center cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">expand_more</span>
          </button>
        </div>

        {showUploadMenu && (
          <div className="absolute left-5 right-5 top-14 rounded-xl bg-surface-container border border-white/10 shadow-2xl py-1.5 z-50 animate-in fade-in duration-150">
            <button
              onClick={() => { setShowUploadMenu(false); onOpenUpload(); }}
              className="w-full px-3.5 py-2 text-xs text-left text-on-surface hover:bg-surface-container-high flex items-center gap-2.5 transition-colors"
            >
              <span className="material-symbols-outlined text-base text-primary">upload_file</span>
              <span>Upload Files</span>
            </button>
            <button
              onClick={() => { setShowUploadMenu(false); onOpenUpload(); }}
              className="w-full px-3.5 py-2 text-xs text-left text-on-surface hover:bg-surface-container-high flex items-center gap-2.5 transition-colors"
            >
              <span className="material-symbols-outlined text-base text-secondary-fixed">drive_folder_upload</span>
              <span>Upload Folder</span>
            </button>
            <button
              onClick={() => { setShowUploadMenu(false); onOpenUpload(); }}
              className="w-full px-3.5 py-2 text-xs text-left text-on-surface hover:bg-surface-container-high flex items-center gap-2.5 transition-colors"
            >
              <span className="material-symbols-outlined text-base text-tertiary">terminal</span>
              <span>Ingest via CLI Stream</span>
            </button>
          </div>
        )}
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        <div className="px-3 py-1 font-mono text-[11px] text-outline uppercase tracking-wider">
          Workspace
        </div>
        {navItems.filter(i => i.section === 'workspace').map((item) => {
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-lg text-sm transition-colors text-left cursor-pointer ${
                isActive
                  ? 'bg-surface-container-high text-primary font-medium shadow-sm'
                  : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
              }`}
            >
              <span className={`material-symbols-outlined text-lg ${isActive ? 'text-primary' : 'text-outline'}`}>
                {item.icon}
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}

        <div className="px-3 pt-4 pb-1 font-mono text-[11px] text-outline uppercase tracking-wider">
          Management
        </div>
        {navItems.filter(i => i.section === 'management').map((item) => {
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-lg text-sm transition-colors text-left cursor-pointer ${
                isActive
                  ? 'bg-surface-container-high text-primary font-medium shadow-sm'
                  : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
              }`}
            >
              <span className={`material-symbols-outlined text-lg ${isActive ? 'text-primary' : 'text-outline'}`}>
                {item.icon}
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Storage & User Footer */}
      <div className="p-4 space-y-3 border-t border-white/5">
        {/* Storage Meter */}
        <div className="p-3.5 rounded-xl bg-surface-container-low border border-white/5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-mono text-xs text-on-surface-variant">Storage</span>
            <span className="font-mono text-xs text-on-surface font-medium">
              {storageUsedTB.toFixed(1)} TB / {storageTotalTB} TB
            </span>
          </div>
          <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden flex">
            <div className="h-full bg-primary-container" style={{ width: `${Math.min(utilizationPercent, 45)}%` }}></div>
            <div className="h-full bg-secondary-fixed-dim" style={{ width: `${Math.min(utilizationPercent - 45 > 0 ? utilizationPercent - 45 : 0, 15)}%` }}></div>
            <div className="h-full bg-tertiary" style={{ width: `${Math.min(utilizationPercent - 60 > 0 ? utilizationPercent - 60 : 0, 8)}%` }}></div>
          </div>
          <div className="flex items-center justify-between pt-2 font-mono text-[11px] text-outline">
            <span>{utilizationPercent}% Utilized</span>
            <button
              onClick={onOpenUpgrade}
              className="text-primary hover:text-secondary-fixed transition-colors cursor-pointer font-medium"
            >
              Upgrade
            </button>
          </div>
        </div>

        {/* User Profile */}
        <div className="flex items-center justify-between p-2 rounded-xl bg-surface-container-low border border-white/5">
          <div className="flex items-center gap-2.5">
            <img
              src={USER_AVATAR}
              alt="Alex Rivera"
              referrerPolicy="no-referrer"
              className="w-8 h-8 rounded-full object-cover ring-1 ring-white/10"
            />
            <div>
              <div className="text-xs text-on-surface font-medium leading-none">Alex Rivera</div>
              <div className="font-mono text-[10px] text-outline leading-none mt-1">Security Lead</div>
            </div>
          </div>
          <button
            onClick={() => onNavigate('workspace-settings')}
            className="text-on-surface-variant hover:text-on-surface p-1 rounded hover:bg-surface-container transition-colors"
            title="Profile & Settings"
          >
            <span className="material-symbols-outlined text-lg">more_vert</span>
          </button>
        </div>
      </div>
    </aside>
  );
};
