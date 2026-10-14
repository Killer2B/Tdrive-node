import React, { useState } from 'react';
import { FileItem } from '../../types';

interface RecentStarredViewProps {
  files: FileItem[];
  onSelectFile: (file: FileItem) => void;
  onToggleStar: (fileId: string) => void;
  onDownloadFile: (file: FileItem) => void;
  onOpenCreateShare: (target?: { fileId?: string; name?: string }) => void;
  isLoading: boolean;
  loadError: string | null;
  onRetry: () => void;
}

export const RecentStarredView: React.FC<RecentStarredViewProps> = ({
  files,
  onSelectFile,
  onToggleStar,
  onDownloadFile,
  onOpenCreateShare,
  isLoading,
  loadError,
  onRetry,
}) => {
  const [filterMode, setFilterMode] = useState<'all' | 'starred' | 'recent'>('all');

  const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const displayedFiles = files.filter(f => {
    if (filterMode === 'starred') return f.isStarred;
    if (filterMode === 'recent') return f.modifiedTs >= recentCutoff;
    return f.isStarred || f.isPinned || f.modifiedTs >= recentCutoff;
  });

  return (
    <div className="relative w-full px-8 py-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-outline font-mono text-xs uppercase tracking-wider mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary-fixed-dim"></span>
            <span>Frequently accessed files</span>
          </div>
          <h1 className="text-3xl text-on-surface tracking-tight font-semibold">
            Recent & Starred Files
          </h1>
          <p className="text-sm text-outline mt-1">
            Review recently updated, pinned, and starred files in this workspace.
          </p>
        </div>

        <div className="flex items-center gap-1 bg-surface-container-low p-1 rounded-lg border border-white/5 font-mono text-xs">
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className={`px-3 py-1.5 rounded transition-colors ${filterMode === 'all' ? 'bg-primary-container text-on-primary-container font-medium' : 'text-on-surface-variant hover:text-on-surface'}`}
          >
            All Priority ({displayedFiles.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('starred')}
            className={`px-3 py-1.5 rounded transition-colors ${filterMode === 'starred' ? 'bg-primary-container text-on-primary-container font-medium' : 'text-on-surface-variant hover:text-on-surface'}`}
          >
            Starred
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('recent')}
            className={`px-3 py-1.5 rounded transition-colors ${filterMode === 'recent' ? 'bg-primary-container text-on-primary-container font-medium' : 'text-on-surface-variant hover:text-on-surface'}`}
          >
            Last 24 Hours
          </button>
        </div>
      </div>

      {loadError && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-error/30 bg-error-container/20 p-3 text-sm text-error"><span>{loadError}</span><button type="button" onClick={onRetry} className="underline">Retry</button></div>}

      <div className="rounded-xl bg-surface-container-low border border-white/5 divide-y divide-white/5 shadow-xl overflow-hidden">
        {isLoading && files.length === 0 ? (
          <div className="p-12 text-center text-outline font-mono text-sm" role="status">Loading files…</div>
        ) : loadError && files.length === 0 ? null : displayedFiles.length === 0 ? (
          <div className="p-12 text-center text-outline font-mono text-sm">
            No files match the selected filter.
          </div>
        ) : (
          displayedFiles.map((file) => (
            <div
              key={file.id}
              onClick={() => onSelectFile(file)}
              className="p-4 hover:bg-surface-container transition-colors flex items-center justify-between gap-4 group cursor-pointer"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onToggleStar(file.id); }}
                  className="p-1 text-secondary-fixed hover:scale-110 transition-transform"
                  title={file.isStarred ? 'Unstar' : 'Star'}
                >
                  <span className="material-symbols-outlined text-xl">
                    {file.isStarred ? 'star' : 'star_border'}
                  </span>
                </button>

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
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface-container text-secondary shrink-0">
                      {file.extension ? `.${file.extension.toUpperCase()}` : file.type}
                    </span>
                  </div>
                  <div className="font-mono text-xs text-outline mt-0.5">
                    {file.size} · Updated {file.modified}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onOpenCreateShare({ fileId: file.id, name: file.name }); }}
                  className="p-2 rounded hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors"
                  title="Share"
                >
                  <span className="material-symbols-outlined text-lg">share</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDownloadFile(file); }}
                  className="p-2 rounded hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors"
                  title="Download"
                >
                  <span className="material-symbols-outlined text-lg">download</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
