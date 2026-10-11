import React, { useState } from 'react';
import { USER_AVATAR } from '../data/mockData';

interface HeaderProps {
  onOpenCommandPalette: () => void;
  viewLayout: 'grid' | 'list';
  onToggleViewLayout: (mode: 'grid' | 'list') => void;
  onFilterClick?: (type: string) => void;
  onOpenNotifications?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenCommandPalette,
  viewLayout,
  onToggleViewLayout,
  onFilterClick
}) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([
    { id: '1', title: 'SHA-256 Verified', desc: 'design_tokens_v4.json passed parity checks.', time: '5m ago' },
    { id: '2', title: 'New Peer Authenticated', desc: 'MacBook Pro 16" connected via Passkey.', time: '24m ago' },
    { id: '3', title: 'Replication Node Sync', desc: 'Frankfurt-01 Sovereign Cluster verified block #14,892,109.', time: '1h ago' }
  ]);

  return (
    <header className="fixed top-0 left-72 right-0 h-16 bg-surface-container-lowest/80 backdrop-blur-xl z-40 border-b border-white/5 shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
      <div className="h-16 w-full px-6 flex items-center justify-between gap-5">
        {/* Omnisearch Bar */}
        <div className="flex-1 max-w-xl">
          <div
            onClick={onOpenCommandPalette}
            className="relative flex items-center cursor-pointer group"
          >
            <span className="material-symbols-outlined absolute left-3.5 text-outline text-lg group-hover:text-primary transition-colors">
              search
            </span>
            <input
              type="text"
              readOnly
              placeholder="Omnisearch files, tags, metadata or vaults..."
              className="w-full bg-surface-container-low text-on-surface placeholder:text-outline font-sans text-sm pl-10 pr-20 py-2 rounded-lg border border-white/5 group-hover:border-white/10 group-hover:bg-surface-container transition-all cursor-pointer"
            />
            <div className="absolute right-2.5 flex items-center gap-1">
              <kbd className="font-mono text-[11px] px-1.5 py-0.5 bg-surface-container-highest text-on-surface-variant rounded border border-white/10">
                ⌘K
              </kbd>
            </div>
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-3">
          {/* Filter options */}
          <div className="hidden xl:flex items-center gap-1 bg-surface-container-low p-0.5 rounded-lg border border-white/5">
            <button
              type="button"
              onClick={() => onFilterClick && onFilterClick('Type')}
              className="px-2.5 py-1 font-mono text-xs rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
            >
              Type
            </button>
            <button
              type="button"
              onClick={() => onFilterClick && onFilterClick('People')}
              className="px-2.5 py-1 font-mono text-xs rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
            >
              People
            </button>
            <button
              type="button"
              onClick={() => onFilterClick && onFilterClick('Modified')}
              className="px-2.5 py-1 font-mono text-xs rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
            >
              Modified
            </button>
          </div>

          <div className="h-4 w-px bg-surface-container-highest hidden md:block"></div>

          {/* Zero-Knowledge Status */}
          <div className="hidden lg:flex items-center gap-1.5 font-mono text-xs text-outline">
            <span className="w-2 h-2 rounded-full bg-secondary-fixed-dim"></span>
            <span>Zero-Knowledge Encrypted</span>
          </div>

          <div className="h-4 w-px bg-surface-container-highest hidden lg:block"></div>

          {/* Grid / List Layout Switcher */}
          <div className="flex items-center gap-0.5 bg-surface-container-low p-0.5 rounded-lg border border-white/5">
            <button
              type="button"
              onClick={() => onToggleViewLayout('grid')}
              title="Grid view"
              className={`p-1.5 rounded transition-colors ${
                viewLayout === 'grid'
                  ? 'text-on-surface bg-surface-container-high'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-lg">grid_view</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleViewLayout('list')}
              title="List view"
              className={`p-1.5 rounded transition-colors ${
                viewLayout === 'list'
                  ? 'text-on-surface bg-surface-container-high'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-lg">view_headline</span>
            </button>
          </div>

          {/* Notifications Button & Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors border border-white/5"
            >
              <span className="material-symbols-outlined text-lg">notifications</span>
              {notifications.length > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary-container animate-pulse"></span>
              )}
            </button>

            {showNotifications && (
              <div className="absolute right-0 top-11 w-80 rounded-xl bg-surface-container border border-white/10 shadow-2xl p-3 z-50 animate-in fade-in duration-150">
                <div className="flex items-center justify-between pb-2 border-b border-white/5">
                  <span className="font-mono text-xs text-on-surface uppercase font-semibold">Security Alerts</span>
                  <button
                    onClick={() => setNotifications([])}
                    className="text-[11px] font-mono text-primary hover:underline"
                  >
                    Clear All
                  </button>
                </div>
                <div className="py-2 space-y-2 max-h-60 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="text-xs text-outline py-3 text-center">No unread security alerts</p>
                  ) : (
                    notifications.map(n => (
                      <div key={n.id} className="p-2 rounded-lg bg-surface-container-lowest text-xs space-y-0.5">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-on-surface">{n.title}</span>
                          <span className="font-mono text-[10px] text-outline">{n.time}</span>
                        </div>
                        <p className="text-outline text-[11px]">{n.desc}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Avatar */}
          <img
            src={USER_AVATAR}
            alt="Alex Rivera"
            referrerPolicy="no-referrer"
            className="w-8 h-8 rounded-full object-cover ring-1 ring-white/10"
          />
        </div>
      </div>
    </header>
  );
};
