import React, { useState, useEffect } from 'react';
import { FileItem, ViewMode } from '../types';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  files: FileItem[];
  onSelectFile: (file: FileItem) => void;
  onChangeView: (view: ViewMode) => void;
  onOpenUpload: () => void;
  onOpenCreateShare: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  files,
  onSelectFile,
  onChangeView,
  onOpenUpload,
  onOpenCreateShare
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
        f.path.toLowerCase().includes(query.toLowerCase()) ||
        f.tags.some(t => t.label.toLowerCase().includes(query.toLowerCase())) ||
        f.sha256.toLowerCase().includes(query.toLowerCase())
      )
    : files.slice(0, 5);

  const navigationActions: { label: string; icon: string; view: ViewMode }[] = [
    { label: 'Overview Telemetry & Live HUD', icon: 'dashboard', view: 'overview' },
    { label: 'All Files & Inspector Blade', icon: 'folder_open', view: 'all-files' },
    { label: 'Shared Vaults & Client Collaboration', icon: 'folder_shared', view: 'shared-vaults' },
    { label: 'Security & Audit Fabric', icon: 'shield', view: 'security-access' },
    { label: 'Recent & Starred Enclaves', icon: 'star', view: 'recent-starred' },
    { label: 'Recovery & Trash Shredder', icon: 'delete_outline', view: 'recovery-trash' },
  ];

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-md z-50 flex items-start justify-center pt-20 p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-surface-container-low border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Search Input Bar */}
        <div className="p-4 bg-surface-container border-b border-white/5 flex items-center gap-3">
          <span className="material-symbols-outlined text-outline text-xl">search</span>
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Omnisearch files, tags, metadata or vaults..."
            className="w-full bg-transparent text-on-surface font-sans text-sm focus:outline-none placeholder:text-outline"
          />
          <kbd className="font-mono text-xs px-2 py-0.5 bg-surface-container-highest text-on-surface-variant rounded">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-3 space-y-4">
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
                    <span className="font-medium group-hover:text-primary transition-colors">Upload & Ingest New File</span>
                  </div>
                  <span className="font-mono text-outline text-[11px]">Direct / CLI</span>
                </button>
                <button
                  onClick={() => { onOpenCreateShare(); onClose(); }}
                  className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-surface-container text-left transition-colors text-xs text-on-surface group"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-secondary-fixed text-base">add_moderator</span>
                    <span className="font-medium group-hover:text-secondary-fixed transition-colors">Create Secure Client Share</span>
                  </div>
                  <span className="font-mono text-outline text-[11px]">Zero-Knowledge</span>
                </button>
              </div>
            </div>
          )}

          {/* Files */}
          <div>
            <div className="px-3 py-1 text-[11px] font-mono text-outline uppercase tracking-wider">
              {query ? `Matching Files (${filteredFiles.length})` : 'Frequently Accessed'}
            </div>
            <div className="space-y-1">
              {filteredFiles.map((file) => (
                <button
                  key={file.id}
                  onClick={() => {
                    onSelectFile(file);
                    onChangeView('all-files');
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
                      {file.securityTier}
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
                  className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-surface-container text-left transition-colors text-xs text-on-surface-variant hover:text-on-surface"
                >
                  <span className="material-symbols-outlined text-base text-outline">{nav.icon}</span>
                  <span>{nav.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
