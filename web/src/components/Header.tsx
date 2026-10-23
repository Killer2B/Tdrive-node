import React, { useState } from 'react';
import * as api from '../api';

interface HeaderProps {
  onOpenCommandPalette: () => void;
  viewLayout: 'grid' | 'list';
  onToggleViewLayout: (mode: 'grid' | 'list') => void;
  onFilterClick?: (type: string) => void;
  username: string;
  notifications: api.ApiActivity[];
}

export const Header: React.FC<HeaderProps> = ({
  onOpenCommandPalette,
  viewLayout,
  onToggleViewLayout,
  username,
  notifications,
}) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const initials = username.slice(0, 2).toLocaleUpperCase();

  return (
    <header className="fixed top-0 left-0 md:left-72 right-0 h-16 bg-surface-container-lowest/80 backdrop-blur-xl z-40 border-b border-white/5 shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
      <div className="h-16 w-full px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-5">
        <button type="button" onClick={onOpenCommandPalette} aria-label="Open navigation and search" className="md:hidden shrink-0 min-h-11 min-w-11 rounded-lg text-primary hover:bg-surface-container"><span aria-hidden="true" className="material-symbols-outlined">menu</span></button>
        {/* Omnisearch Bar */}
        <div className="flex-1 min-w-0 max-w-xl">
          <button type="button"
            onClick={onOpenCommandPalette}
            aria-label="Quick search and navigation"
            className="relative flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg border border-white/5 bg-surface-container-low px-3 text-left text-sm text-on-surface-variant hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-outline text-lg">
              search
            </span>
            <span className="min-w-0 flex-1 truncate">Quick search & navigation</span>
            <kbd aria-hidden="true" className="hidden shrink-0 rounded border border-white/10 bg-surface-container-highest px-1.5 py-0.5 font-mono text-xs sm:block">Ctrl / Cmd+K</kbd>
          </button>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1 sm:gap-3">
          <div className="h-4 w-px bg-surface-container-highest hidden md:block"></div>

          {/* Authenticated session status */}
          <div className="hidden lg:flex items-center gap-1.5 font-mono text-xs text-outline">
            <span className="w-2 h-2 rounded-full bg-secondary-fixed-dim"></span>
            <span>Signed in</span>
          </div>

          <div className="h-4 w-px bg-surface-container-highest hidden lg:block"></div>

          {/* Grid / List Layout Switcher */}
          <div className="flex items-center gap-0.5 bg-surface-container-low p-0.5 rounded-lg border border-white/5">
            <button
              type="button"
              onClick={() => onToggleViewLayout('grid')}
              title="Grid view"
              aria-label="Grid view"
              aria-pressed={viewLayout === 'grid'}
              className={`min-h-11 min-w-11 flex items-center justify-center rounded transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                viewLayout === 'grid'
                  ? 'text-on-surface bg-surface-container-high'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-lg">grid_view</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleViewLayout('list')}
              title="List view"
              aria-label="List view"
              aria-pressed={viewLayout === 'list'}
              className={`min-h-11 min-w-11 flex items-center justify-center rounded transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                viewLayout === 'list'
                  ? 'text-on-surface bg-surface-container-high'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-lg">view_headline</span>
            </button>
          </div>

          {/* Notifications Button & Dropdown */}
          <div className="relative hidden sm:block">
            <button
              type="button"
              onClick={() => setShowNotifications(!showNotifications)}
              aria-label="Recent activity"
              aria-expanded={showNotifications}
              className="relative min-h-11 min-w-11 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors border border-white/5 focus-visible:outline-2 focus-visible:outline-primary"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-lg">notifications</span>
              {notifications.length > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary-container animate-pulse"></span>
              )}
            </button>

            {showNotifications && (
              <div className="absolute right-0 top-11 w-80 rounded-xl bg-surface-container border border-white/10 shadow-2xl p-3 z-50 animate-in fade-in duration-150">
                <div className="flex items-center justify-between pb-2 border-b border-white/5">
                   <span className="text-sm text-on-surface font-semibold">Recent activity</span>
                  <button
                    type="button"
                    onClick={() => setShowNotifications(false)}
                    className="text-[11px] font-mono text-primary hover:underline"
                  >
                    Close
                  </button>
                </div>
                <div className="py-2 space-y-2 max-h-60 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="text-xs text-outline py-3 text-center">No recent activity.</p>
                  ) : (
                    notifications.slice(0, 10).map((n) => (
                      <div key={n.id} className="p-2 rounded-lg bg-surface-container-lowest text-xs space-y-0.5">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-on-surface">{n.action.replaceAll('_', ' ')}</span>
                          <span className="font-mono text-[10px] text-outline">{api.formatRelative(n.at)}</span>
                        </div>
                        <p className="text-outline text-[11px]">{n.targetName ?? n.targetType ?? 'Workspace'}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Avatar */}
          <span aria-label={username} title={username} className="hidden sm:flex w-8 h-8 rounded-full bg-primary-container text-on-primary-container ring-1 ring-white/10 items-center justify-center text-[11px] font-semibold">{initials}</span>
        </div>
      </div>
    </header>
  );
};
