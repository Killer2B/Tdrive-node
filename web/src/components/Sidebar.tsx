import React from 'react';
import { ViewMode } from '../types';

interface SidebarProps {
  currentView: ViewMode;
  onNavigate: (view: ViewMode) => void;
  onOpenUpload: () => void;
  onOpenUpgrade: () => void;
  storageUsedTB: number;
  storageTotalTB: number;
  username: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  onOpenUpload,
  onOpenUpgrade,
  storageUsedTB,
  storageTotalTB,
  username,
}) => {

  const navItems: { id: ViewMode; label: string; icon: string; section: 'workspace' | 'management' }[] = [
    { id: 'overview', label: 'Overview', icon: 'dashboard', section: 'workspace' },
    { id: 'all-files', label: 'All Files', icon: 'folder_open', section: 'workspace' },
    { id: 'recent-starred', label: 'Recent & Starred', icon: 'star', section: 'workspace' },
    { id: 'shared-vaults', label: 'Shared Vaults', icon: 'folder_shared', section: 'workspace' },
    { id: 'recovery-trash', label: 'Recovery / Trash', icon: 'delete_outline', section: 'management' },
    { id: 'security-access', label: 'Security & Audit', icon: 'shield', section: 'management' },
    { id: 'workspace-settings', label: 'Settings', icon: 'settings', section: 'management' },
  ];

  const utilizationPercent = storageTotalTB > 0 ? Math.min(100, Math.round((storageUsedTB / storageTotalTB) * 100)) : 0;
  const initials = username.slice(0, 2).toLocaleUpperCase();

  return (
    <aside className="hidden md:flex fixed left-0 top-0 h-screen w-72 bg-surface-container-lowest flex-col z-50 border-r border-white/5 shadow-[0_0_24px_rgba(0,0,0,0.4)]">
      {/* Brand Header */}
      <div className="p-5 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-primary-container flex items-center justify-center text-on-primary-container shadow-[0_0_12px_rgba(47,145,255,0.3)]">
            <span className="material-symbols-outlined text-lg">lock</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xl font-bold tracking-tight text-on-surface">Vaulta</span>
            <span className="font-mono text-[10px] uppercase bg-surface-container-high px-1.5 py-0.5 rounded text-secondary font-semibold">
              Private
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface-container text-on-surface-variant text-xs font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary-container" />
          <span>Personal workspace</span>
        </div>
      </div>

      {/* New Upload Button with Dropdown */}
      <div className="px-5 py-3">
        <div className="flex rounded-lg overflow-hidden shadow-[0_4px_16px_rgba(47,145,255,0.25)]">
          <button
            onClick={onOpenUpload}
            type="button"
            className="flex-1 flex items-center gap-2 px-4 py-2.5 bg-primary-container text-on-primary-container text-sm font-semibold hover:bg-secondary-container hover:text-on-secondary-fixed-variant transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-lg">add_circle</span>
            <span>New Upload</span>
          </button>
        </div>
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
              {storageUsedTB.toFixed(1)} TB / {storageTotalTB.toFixed(1)} TB
            </span>
          </div>
          <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
            <div className="h-full bg-primary-container transition-all" style={{ width: `${utilizationPercent}%` }}></div>
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
            <span className="w-8 h-8 rounded-full bg-primary-container text-on-primary-container ring-1 ring-white/10 flex items-center justify-center text-[11px] font-semibold">{initials}</span>
            <div>
              <div className="text-xs text-on-surface font-medium leading-none">{username}</div>
              <div className="font-mono text-[10px] text-outline leading-none mt-1">Workspace owner</div>
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
