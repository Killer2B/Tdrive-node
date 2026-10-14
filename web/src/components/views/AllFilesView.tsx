import React, { useEffect, useState } from 'react';
import { ExternalLink, FileItem, FileCategory } from '../../types';
import * as api from '../../api';
import { VideoPlayer } from '../VideoPlayer';

interface AllFilesViewProps {
  files: FileItem[];
  viewLayout: 'grid' | 'list';
  shareRevision: number;
  isLoading: boolean;
  loadError: string | null;
  onRetry: () => void;
  selectedFile: FileItem | null;
  onSelectFile: (file: FileItem) => void;
  onDeleteFiles: (ids: string[]) => void;
  onDownloadFile: (file: FileItem) => void;
  onOpenUpload: () => void;
  onOpenCreateShare: (target?: { fileId?: string; name?: string }) => void;
  onCopyChecksum: (hash: string) => void;
  onExportAuditLogs: () => void;
}

export const AllFilesView: React.FC<AllFilesViewProps> = ({
  files,
  viewLayout,
  shareRevision,
  isLoading,
  loadError,
  onRetry,
  selectedFile,
  onSelectFile,
  onDeleteFiles,
  onDownloadFile,
  onOpenUpload,
  onOpenCreateShare,
  onCopyChecksum,
  onExportAuditLogs,
}) => {
  const [activeCategory, setActiveCategory] = useState<'all' | FileCategory>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'modified' | 'size' | 'name'>('modified');
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  const [fileShares, setFileShares] = useState<ExternalLink[]>([]);
  const [fileActivity, setFileActivity] = useState<api.ApiActivity[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsReload, setDetailsReload] = useState(0);

  // Filtered files
  const filteredFiles = files.filter((file) => {
    if (activeCategory === 'all') return true;
    return file.type === activeCategory;
  }).sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'size') return b.sizeBytes - a.sizeBytes;
    return b.modifiedTs - a.modifiedTs;
  });

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedIds(e.target.checked ? filteredFiles.map((f) => f.id) : []);
  };

  const handleRowClick = (file: FileItem) => {
    onSelectFile(file);
    if (!selectedIds.includes(file.id)) {
      setSelectedIds([file.id]);
    }
    setIsInspectorOpen(true);
  };

  const activeInspectionFile = selectedFile && files.some((file) => file.id === selectedFile.id)
    ? selectedFile
    : files[0];

  useEffect(() => {
    if (!activeInspectionFile) {
      setFileShares([]);
      setFileActivity([]);
      return;
    }
    let active = true;
    setDetailsLoading(true);
    setDetailsError(null);
    Promise.all([
      api.shares.forFile(activeInspectionFile.id),
      api.activity.list({ fileId: activeInspectionFile.id, limit: 10 }),
    ])
      .then(([shares, activity]) => {
        if (!active) return;
        setFileShares(shares.shares);
        setFileActivity(activity.items);
      })
      .catch((error: unknown) => {
        if (active) setDetailsError(error instanceof Error ? error.message : 'Could not load file details.');
      })
      .finally(() => { if (active) setDetailsLoading(false); });
    return () => { active = false; };
  }, [activeInspectionFile?.id, detailsReload, shareRevision]);

  return (
    <div className="flex flex-col w-full min-h-screen">
      {/* Sub-Header Command Bar: Breadcrumb, Metrics & High-Level Actions */}
      <div className="px-6 py-3.5 bg-surface-container-low border-b border-white/5 flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <nav className="flex items-center gap-1.5 font-mono text-xs text-outline">
            <span className="flex items-center gap-1 text-outline">
              <span className="material-symbols-outlined text-sm">dns</span>
              Workspace
            </span>
            <span className="material-symbols-outlined text-sm text-outline-variant">chevron_right</span>
            <span className="text-on-surface font-medium bg-surface-container-high px-2 py-0.5 rounded">
              {activeInspectionFile?.name ?? 'All files'}
            </span>
          </nav>
          <div className="h-3.5 w-px bg-surface-container-highest mx-1 hidden md:block"></div>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-container text-secondary text-xs font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary-container animate-pulse"></span>
            Server-managed storage
          </div>
        </div>

        {/* Top Action Set */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onExportAuditLogs}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-mono rounded shadow-sm transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">lock_open</span>
            <span>Export Activity</span>
          </button>
          <button
            type="button"
            onClick={onOpenUpload}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-primary-container text-on-primary-container text-xs font-semibold rounded shadow-[0_2px_12px_rgba(47,145,255,0.3)] hover:bg-secondary-container hover:text-on-secondary-fixed-variant transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">cloud_upload</span>
            <span>Secure Ingest</span>
          </button>
        </div>
      </div>

      {/* Filter, Bulk Operation & Controls Strip */}
      <div className="px-6 py-2 bg-surface-container-lowest border-b border-white/5 flex flex-wrap items-center justify-between gap-4">
        {/* Category Badges / Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-1">
          <button
            type="button"
            onClick={() => setActiveCategory('all')}
            className={`px-3 py-1 rounded font-mono text-xs whitespace-nowrap transition-colors cursor-pointer ${
              activeCategory === 'all'
                ? 'bg-primary-container text-on-primary-container font-medium shadow-sm'
                : 'bg-surface-container text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
            }`}
          >
            All Types
          </button>
          <button
            type="button"
            onClick={() => setActiveCategory('design')}
            className={`px-3 py-1 rounded font-mono text-xs whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeCategory === 'design'
                ? 'bg-primary-container text-on-primary-container font-medium'
                : 'bg-surface-container text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-secondary-fixed-dim"></span>Design (.fig, .ai)
          </button>
          <button
            type="button"
            onClick={() => setActiveCategory('code')}
            className={`px-3 py-1 rounded font-mono text-xs whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeCategory === 'code'
                ? 'bg-primary-container text-on-primary-container font-medium'
                : 'bg-surface-container text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>Code (.ts, .py)
          </button>
          <button
            type="button"
            onClick={() => setActiveCategory('video')}
            className={`px-3 py-1 rounded font-mono text-xs whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeCategory === 'video'
                ? 'bg-primary-container text-on-primary-container font-medium'
                : 'bg-surface-container text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-secondary-container"></span>Video (.mov, .prores)
          </button>
          <button
            type="button"
            onClick={() => setActiveCategory('doc')}
            className={`px-3 py-1 rounded font-mono text-xs whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeCategory === 'doc'
                ? 'bg-primary-container text-on-primary-container font-medium'
                : 'bg-surface-container text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>Documents (.pdf, .key)
          </button>
        </div>

        {/* Active Selection HUD & View Toggles */}
        <div className="flex items-center gap-3">
          {/* Active Bulk Selection */}
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-1 bg-surface-container-high px-2 py-1 rounded border border-white/5 shadow-sm">
              <span className="font-mono text-xs text-primary font-medium px-1">
                {selectedIds.length} selected
              </span>
              <button
                type="button"
                onClick={() => {
                  const first = files.find(f => selectedIds.includes(f.id));
                  if (first) onDownloadFile(first);
                }}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-on-surface hover:bg-surface-bright font-mono text-xs transition-colors"
                title="Download selected"
              >
                <span className="material-symbols-outlined text-sm text-primary">download</span>
                <span>Download</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenCreateShare({ fileId: activeInspectionFile.id, name: activeInspectionFile.name })}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-on-surface hover:bg-surface-bright font-mono text-xs transition-colors"
                title="Share link"
              >
                <span className="material-symbols-outlined text-sm">link</span>
                <span>Share</span>
              </button>
              <button
                type="button"
                onClick={() => onDeleteFiles(selectedIds)}
                className="p-1 rounded text-error hover:bg-error-container/40 transition-colors"
                title="Move to Trash"
              >
                <span className="material-symbols-outlined text-sm">delete</span>
              </button>
            </div>
          )}

          <div className="h-4 w-px bg-surface-container-highest"></div>

          {/* Sort Selection */}
          <div className="flex items-center gap-1 bg-surface-container px-2.5 py-1 rounded border border-white/5 text-on-surface-variant">
            <span className="material-symbols-outlined text-sm text-outline">sort</span>
            <select
              value={sortBy}
              onChange={(e) => {
                if (e.target.value === 'modified' || e.target.value === 'size' || e.target.value === 'name') setSortBy(e.target.value);
              }}
              className="bg-transparent font-mono text-xs text-on-surface focus:outline-none cursor-pointer pr-1"
            >
              <option value="modified" className="bg-surface-container-high text-on-surface">Last modified</option>
              <option value="size" className="bg-surface-container-high text-on-surface">File size</option>
              <option value="name" className="bg-surface-container-high text-on-surface">Alphabetical (A-Z)</option>
            </select>
          </div>

          {/* Inspector Toggle Button */}
          <button
            type="button"
            onClick={() => setIsInspectorOpen(!isInspectorOpen)}
            title="Toggle Inspector Panel"
            className={`flex items-center gap-1 px-2.5 py-1 rounded font-mono text-xs transition-colors border border-white/5 cursor-pointer ${
              isInspectorOpen
                ? 'bg-surface-container-high text-primary'
                : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-base">dock_to_left</span>
            <span className="hidden sm:inline">Details</span>
          </button>
        </div>
      </div>

      {/* Primary Workspace Canvas: Split Layout (Table + Right Inspector) */}
      <div className="flex-1 flex flex-col xl:flex-row w-full overflow-hidden">
        {/* Central Explorer Table Area */}
        <div className="flex-1 overflow-x-auto min-w-0 bg-surface">
          <div className={viewLayout === 'list' ? 'min-w-[780px]' : ''}>
            {/* Table Header Bar */}
            {viewLayout === 'list' && <div className="grid grid-cols-[40px_minmax(240px,2.5fr)_130px_100px_160px_48px] items-center px-6 py-2 bg-surface-container-lowest font-mono text-[11px] text-outline uppercase tracking-wider select-none border-b border-white/5">
              <div className="flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={selectedIds.length === filteredFiles.length && filteredFiles.length > 0}
                  onChange={handleSelectAll}
                  className="w-3.5 h-3.5 rounded-sm bg-surface-container-high accent-primary-container cursor-pointer"
                />
              </div>
              <div className="flex items-center gap-1 cursor-pointer hover:text-on-surface">
                <span>Name</span>
                <span className="material-symbols-outlined text-sm">arrow_downward</span>
              </div>
              <div>Type</div>
              <div>Size</div>
              <div>Modified</div>
              <div className="text-right">Action</div>
            </div>}

            {/* Directory Rows */}
            <div className={viewLayout === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 gap-3 p-4' : 'flex flex-col divide-y divide-white/5'}>
              {isLoading && files.length === 0 ? (
                <div className="p-12 text-center text-sm text-outline" role="status">Loading files…</div>
              ) : loadError && files.length === 0 ? (
                <div role="alert" className="p-12 text-center space-y-3"><p className="text-sm text-error">{loadError}</p><button type="button" onClick={onRetry} className="text-primary text-sm underline">Retry</button></div>
              ) : filteredFiles.length === 0 ? (
                <div className="p-12 text-center text-sm text-outline">No files match the selected category.</div>
              ) : filteredFiles.map((file) => {
                const isSelected = selectedIds.includes(file.id);
                const isInspected = activeInspectionFile?.id === file.id;

                return (
                  <div
                    key={file.id}
                    onClick={() => handleRowClick(file)}
                    className={`grid ${viewLayout === 'grid' ? 'grid-cols-[40px_minmax(0,1fr)] rounded-xl border border-white/5 p-4' : 'grid-cols-[40px_minmax(240px,2.5fr)_130px_100px_160px_48px] px-6 py-2.5'} items-center transition-colors group cursor-pointer relative ${
                      isInspected
                        ? 'bg-surface-container-high shadow-inner'
                        : 'bg-surface hover:bg-surface-container-low'
                    }`}
                  >
                    {/* Blue active indicator stripe */}
                    {isInspected && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary-container"></div>
                    )}

                    {/* Checkbox */}
                    <div className="flex items-center justify-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          setSelectedIds((current) => current.includes(file.id)
                            ? current.filter((id) => id !== file.id)
                            : [...current, file.id]);
                        }}
                        className="w-3.5 h-3.5 rounded-sm bg-surface-container-high accent-primary-container cursor-pointer"
                      />
                    </div>

                    {/* Name & Icon */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-8 h-8 rounded flex items-center justify-center shrink-0 shadow-sm ${
                        isInspected
                          ? 'bg-primary-container/20 text-primary-container'
                          : 'bg-surface-container-high text-primary'
                      }`}>
                        <span className="material-symbols-outlined text-lg">
                          {file.type === 'folder' ? 'folder' :
                           file.type === 'video' ? 'movie' :
                           file.type === 'doc' ? 'picture_as_pdf' :
                           file.type === 'code' ? 'data_object' :
                           file.type === 'archive' ? 'folder_zip' : 'terminal'}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className={`text-sm truncate transition-colors ${
                          isInspected
                            ? 'text-primary font-semibold'
                            : 'text-on-surface font-medium group-hover:text-primary'
                        }`}>
                          {file.name}
                        </p>
                        <span className="font-mono text-xs text-outline">
                          {file.extension ? `.${file.extension.toUpperCase()}` : file.type}
                        </span>
                      </div>
                    </div>

                    <div className={viewLayout === 'grid' ? 'col-span-2 grid grid-cols-2 gap-2 mt-2 pt-3 border-t border-white/5' : 'contents'}>
                      <div className="font-mono text-xs text-on-surface-variant">{file.type}</div>
                      <div className="font-mono text-xs text-on-surface font-medium">{file.size}</div>
                      <div className="font-mono text-xs text-outline truncate">{file.modified}</div>
                      <div className="text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDownloadFile(file);
                          }}
                          className="p-1 rounded text-outline hover:text-on-surface hover:bg-surface-container transition-colors"
                          title="Download file"
                        >
                          <span className="material-symbols-outlined text-lg">download</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Drag & Drop Ingestion Dropzone Banner */}
          <div className="m-6 p-6 rounded-xl bg-surface-container-low/70 border border-white/5 flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-surface-container-high flex items-center justify-center text-primary shrink-0 shadow-inner">
                <span className="material-symbols-outlined text-2xl">upload_file</span>
              </div>
              <div>
                <h4 className="text-base text-on-surface font-semibold">Upload files to this workspace</h4>
                <p className="text-xs text-outline mt-0.5">
                  Files are uploaded to the server using its configured chunk size and storage backend.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto justify-end">
              <button
                type="button"
                onClick={onOpenUpload}
                className="px-4 py-2 bg-surface-container hover:bg-surface-container-high text-on-surface font-mono text-xs rounded transition-colors cursor-pointer"
              >
                Select files
              </button>
            </div>
          </div>
        </div>

        {/* Right-Hand File Inspector / Metadata Blade (380px fixed width desktop) */}
        {isInspectorOpen && activeInspectionFile && (
          <aside className="w-full xl:w-96 bg-surface-container-low border-l border-white/5 shrink-0 flex flex-col shadow-xl animate-in slide-in-from-right duration-200">
            {/* Panel Header */}
            <div className="p-4 bg-surface-container-low border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-lg">info</span>
                <span className="text-sm font-semibold text-on-surface">File Inspector</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => window.open(api.files.streamUrl(activeInspectionFile.id), '_blank')}
                  className="p-1 rounded text-outline hover:text-on-surface hover:bg-surface-container transition-colors"
                  title="Open Fullscreen Viewport"
                >
                  <span className="material-symbols-outlined text-base">open_in_full</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsInspectorOpen(false)}
                  className="p-1 rounded text-outline hover:text-on-surface hover:bg-surface-container transition-colors"
                  title="Close Inspector"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {/* Media Preview Frame with Scrub Simulator */}
              <div className="relative rounded-xl overflow-hidden group">
                {activeInspectionFile.type === 'video' ? (
                  <VideoPlayer
                    key={activeInspectionFile.id}
                    src={api.files.streamUrl(activeInspectionFile.id)}
                    poster={activeInspectionFile.previewUrl}
                  />
                ) : activeInspectionFile.type === 'design' ? (
                  <img
                    src={api.files.streamUrl(activeInspectionFile.id)}
                    alt={activeInspectionFile.name}
                    className="w-full max-h-72 object-contain bg-black rounded-xl border border-white/10"
                  />
                ) : (
                  <div className="w-full h-44 flex items-center justify-center text-outline bg-surface-container-lowest rounded-xl border border-white/5">
                    <span className="material-symbols-outlined text-5xl">
                      {activeInspectionFile.type === 'doc'
                        ? 'description'
                        : activeInspectionFile.type === 'archive'
                          ? 'folder_zip'
                          : activeInspectionFile.type === 'code'
                            ? 'data_object'
                            : activeInspectionFile.type === 'folder'
                              ? 'folder'
                              : 'draft'}
                    </span>
                  </div>
                )}
                <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-container-lowest/80 backdrop-blur-md text-[10px] font-mono text-secondary-fixed pointer-events-none">
                  <span className="w-1.5 h-1.5 rounded-full bg-secondary-container"></span>
                  {activeInspectionFile.extension?.toUpperCase() || 'FILE'}
                </div>
              </div>

              {/* Title & Quick Action buttons */}
              <div>
                <h3 className="text-base font-bold text-on-surface break-words leading-tight">
                  {activeInspectionFile.name}
                </h3>
                <p className="font-mono text-xs text-outline mt-1">
                  Ingested {activeInspectionFile.modified} · {activeInspectionFile.size} ({activeInspectionFile.sizeBytes.toLocaleString()} bytes)
                </p>
                <div className="grid grid-cols-2 gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => onDownloadFile(activeInspectionFile)}
                    className="flex items-center justify-center gap-1.5 py-2 px-3 bg-primary-container hover:bg-secondary-container text-on-primary-container hover:text-on-secondary-fixed-variant font-mono text-xs font-semibold rounded shadow-sm transition-all cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-base">download</span>
                    <span>Download</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenCreateShare({ fileId: activeInspectionFile.id, name: activeInspectionFile.name })}
                    className="flex items-center justify-center gap-1.5 py-2 px-3 bg-surface-container hover:bg-surface-container-high text-on-surface font-mono text-xs rounded border border-white/5 transition-colors cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-base">share</span>
                    <span>Share Link</span>
                  </button>
                </div>
              </div>

              {/* Technical Specifications */}
              <div className="p-4 rounded-xl bg-surface-container border border-white/5 space-y-3 shadow-inner">
                <div className="flex items-center justify-between pb-1">
                  <span className="font-mono text-xs text-outline uppercase tracking-wider">Technical Specs</span>
                  <span className="font-mono text-xs text-outline">{activeInspectionFile.type}</span>
                </div>
                <div className="grid grid-cols-2 gap-y-1.5 font-mono text-xs">
                  <div className="text-outline">File size</div><div className="text-on-surface text-right">{activeInspectionFile.size}</div>
                  <div className="text-outline">MIME type</div><div className="text-on-surface text-right break-all">{activeInspectionFile.type}</div>
                  {activeInspectionFile.technicalSpecs?.resolution && <><div className="text-outline">Resolution</div><div className="text-on-surface text-right">{activeInspectionFile.technicalSpecs.resolution}</div></>}
                  <div className="text-outline">Last updated</div><div className="text-on-surface text-right">{new Date(activeInspectionFile.modifiedTs).toLocaleString()}</div>
                </div>

                <div className="pt-2 border-t border-white/5">
                  <div className="flex items-center justify-between text-outline font-mono text-xs mb-1">
                    <span>SHA-256 Checksum</span>
                    <button
                      type="button"
                      onClick={() => onCopyChecksum(activeInspectionFile.sha256)}
                      disabled={!activeInspectionFile.sha256}
                      className="text-primary hover:underline cursor-pointer"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="p-2 rounded bg-surface-container-lowest font-mono text-[11px] text-on-surface-variant truncate select-all">
                    {activeInspectionFile.sha256}
                  </div>
                </div>
              </div>

              {/* Actual shares */}
              <div className="p-4 rounded-xl bg-surface-container border border-white/5 space-y-3 shadow-inner">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-outline uppercase tracking-wider">Share Links</span>
                  <button
                    type="button"
                    onClick={() => onOpenCreateShare({ fileId: activeInspectionFile.id, name: activeInspectionFile.name })}
                    className="text-primary text-xs font-mono hover:underline cursor-pointer"
                  >
                    + Manage
                  </button>
                </div>
                {detailsLoading ? <p className="text-xs text-outline">Loading share records…</p> : null}
                {detailsError ? <div role="alert" className="flex justify-between gap-2 text-xs text-error"><span>{detailsError}</span><button type="button" onClick={() => setDetailsReload((value) => value + 1)} className="underline">Retry</button></div> : null}
                {!detailsLoading && fileShares.length ? fileShares.map((share) => (
                  <div key={share.id} className="p-2.5 rounded-lg bg-surface-container-low border border-white/5">
                    <p className="text-xs text-on-surface truncate">{share.vanityEndpoint}</p>
                    <p className="font-mono text-[10px] text-outline mt-1">{share.isRevoked ? 'Revoked' : share.isExpired ? 'Expired' : 'Active'} · {share.viewsCount} views · {share.quotaUsed} downloads · {share.expiry}</p>
                  </div>
                )) : !detailsLoading && !detailsError ? <p className="text-xs text-outline">No share links for this file.</p> : null}
              </div>

              {/* Current file record */}
              <div className="p-4 rounded-xl bg-surface-container border border-white/5 space-y-3 shadow-inner">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-outline uppercase tracking-wider">File Record</span>
                  <span className="font-mono text-xs text-secondary-fixed">{activeInspectionFile.isDeleted ? 'In trash' : 'Stored'}</span>
                </div>
                <p className="text-xs text-outline">Last modified {new Date(activeInspectionFile.modifiedTs).toLocaleString()}</p>
              </div>

              {/* Activity Audit Trail */}
              <div className="p-4 rounded-xl bg-surface-container border border-white/5 space-y-2.5 shadow-inner">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-outline uppercase tracking-wider">Activity Audit Log</span>
                  <button type="button" onClick={onExportAuditLogs} className="text-primary text-[11px] hover:underline">Export CSV</button>
                </div>
                {fileActivity.length ? <div className="space-y-2 text-xs">{fileActivity.map((item) => <div key={item.id} className="flex items-start gap-2 text-on-surface-variant"><span className="material-symbols-outlined text-sm text-secondary-fixed-dim mt-0.5">history</span><div><span>{item.action.replaceAll('_', ' ')}</span><span className="block text-outline font-mono text-[10px]">{new Date(item.at).toLocaleString()} · {item.ip ?? 'IP unavailable'}</span></div></div>)}</div> : !detailsLoading && <div className="text-xs text-outline">No activity recorded for this file.</div>}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};
