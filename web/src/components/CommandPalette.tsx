import React, { useState, useEffect } from 'react';
import { FileItem, ViewMode } from '../types';
import { ExplorerDialog } from './modals/ExplorerDialog';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  files: FileItem[];
  onSelectFile: (file: FileItem) => void;
  onChangeView: (view: ViewMode) => void;
  onOpenUpload: () => void;
  onOpenCreateShare: () => void;
  onSearchDrive: (query: string) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  files,
  onSelectFile,
  onChangeView,
  onOpenUpload,
  onOpenCreateShare,
  onSearchDrive,
}) => {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filteredFiles = query.trim()
    ? files.filter(f => 
        f.name.toLowerCase().includes(query.toLowerCase()) ||
      f.type.toLowerCase().includes(query.toLowerCase()) ||
      (f.extension ?? '').toLowerCase().includes(query.toLowerCase()) ||
        f.sha256.toLowerCase().includes(query.toLowerCase())
      )
    : files.slice(0, 5);

  const navigationActions: { label: string; icon: string; view: ViewMode }[] = [
    { label: 'Overview', icon: 'dashboard', view: 'overview' },
    { label: 'My files', icon: 'folder_open', view: 'all-files' },
    { label: 'Shared links', icon: 'folder_shared', view: 'shared-vaults' },
    { label: 'Security', icon: 'shield', view: 'security-access' },
    { label: 'Recent & starred', icon: 'star', view: 'recent-starred' },
    { label: 'Trash', icon: 'delete_outline', view: 'recovery-trash' },
    { label: 'Settings & API keys', icon: 'settings', view: 'workspace-settings' },
  ];

  return (
    <ExplorerDialog title="Search & navigation" onClose={onClose}>
        {/* Search Input Bar */}
        <div className="p-4 bg-surface-container border-b border-white/5 flex items-center gap-3">
          <span className="material-symbols-outlined text-outline text-xl">search</span>
          <input
            autoFocus
            aria-label="Search drive or recent files"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files or jump to a view"
            onKeyDown={(event) => { if (event.key === 'Enter' && query.trim()) { onSearchDrive(query.trim()); onClose(); } }}
            className="min-h-11 w-full min-w-0 bg-transparent text-on-surface font-sans text-base focus:outline-none placeholder:text-outline"
          />
          <kbd className="font-mono text-xs px-2 py-0.5 bg-surface-container-highest text-on-surface-variant rounded">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-3 space-y-4">
          {query.trim() && <button type="button" onClick={() => { onSearchDrive(query.trim()); onClose(); }} className="min-h-11 w-full rounded-lg bg-primary-container px-3 text-left text-sm text-on-primary-container">Search entire drive for “{query.trim()}”</button>}
          {/* Quick Actions */}
          {!query && (
            <div>
              <div className="px-3 py-1 text-[11px] font-mono text-outline uppercase tracking-wider">
                Quick Actions
              </div>
              <div className="space-y-1">
                <button
                  onClick={() => { onOpenUpload(); onClose(); }}
                  className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-surface-container text-left transition-colors text-xs text-on-surface group"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-primary text-base">cloud_upload</span>
                    <span className="font-medium group-hover:text-primary transition-colors">Upload files</span>
                  </div>
                  <span className="font-mono text-outline text-[11px]">Upload file</span>
                </button>
                <button
                  onClick={() => { onOpenCreateShare(); onClose(); }}
                  className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-surface-container text-left transition-colors text-xs text-on-surface group"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-secondary-fixed text-base">add_moderator</span>
                    <span className="font-medium group-hover:text-secondary-fixed transition-colors">Create a shared link</span>
                  </div>
                  <span className="font-mono text-outline text-[11px]">Share link</span>
                </button>
              </div>
            </div>
          )}

          {/* Files */}
          <div>
            <div className="px-3 py-1 text-[11px] font-mono text-outline uppercase tracking-wider">
              {query ? `Matching recent files (${filteredFiles.length})` : 'Recent files'}
            </div>
            <div className="space-y-1">
              {filteredFiles.map((file) => (
                <button
                  key={file.id}
                  onClick={() => {
                    onSelectFile(file);
                    onClose();
                  }}
                  className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-surface-container text-left transition-colors text-xs group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`material-symbols-outlined text-base shrink-0 ${
                      file.type === 'video' ? 'text-primary' :
                      file.type === 'doc' ? 'text-tertiary' :
                      file.type === 'folder' ? 'text-secondary-fixed' :
                      'text-outline'
                    }`}>
                      {file.type === 'video' ? 'movie' :
                       file.type === 'doc' ? 'picture_as_pdf' :
                       file.type === 'folder' ? 'folder' : 'data_object'}
                    </span>
                    <span className="font-medium text-on-surface truncate group-hover:text-primary transition-colors">
                      {file.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[11px] text-outline shrink-0">
                    <span>{file.size}</span>
                    <span className="px-1.5 py-0.2 rounded bg-surface-container-high text-on-surface-variant">
                      {file.extension ? `.${file.extension.toUpperCase()}` : file.type}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Jump to View */}
          <div>
            <div className="px-3 py-1 text-[11px] font-mono text-outline uppercase tracking-wider">
              Workspace Views
            </div>
            <div className="space-y-1">
              {navigationActions.map((nav) => (
                <button
                  key={nav.view}
                  onClick={() => {
                    onChangeView(nav.view);
                    onClose();
                  }}
                  className="min-h-11 w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-surface-container text-left transition-colors text-sm text-on-surface-variant hover:text-on-surface"
                >
                  <span className="material-symbols-outlined text-base text-outline">{nav.icon}</span>
                  <span>{nav.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
    </ExplorerDialog>
  );
};
