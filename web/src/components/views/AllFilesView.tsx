import React, { useState } from 'react';
import { FileItem, FileCategory } from '../../types';
import { VIDEO_PREVIEW_IMG } from '../../data/mockData';
import * as api from '../../api';

interface AllFilesViewProps {
  files: FileItem[];
  selectedFile: FileItem | null;
  onSelectFile: (file: FileItem) => void;
  onDeleteFiles: (ids: string[]) => void;
  onDownloadFile: (file: FileItem) => void;
  onOpenUpload: () => void;
  onOpenCreateShare: (targetName?: string) => void;
  onCopyChecksum: (hash: string) => void;
  onRestoreVersion: (version: string) => void;
}

export const AllFilesView: React.FC<AllFilesViewProps> = ({
  files,
  selectedFile,
  onSelectFile,
  onDeleteFiles,
  onDownloadFile,
  onOpenUpload,
  onOpenCreateShare,
  onCopyChecksum,
  onRestoreVersion
}) => {
  const [activeCategory, setActiveCategory] = useState<'all' | FileCategory>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>(['f-3']);
  const [sortBy, setSortBy] = useState<'modified' | 'size' | 'name'>('modified');
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  const [isPlayingVideo, setIsPlayingVideo] = useState(false);
  const [videoScrub, setVideoScrub] = useState(40);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Filtered files
  const filteredFiles = files.filter((file) => {
    if (activeCategory === 'all') return true;
    return file.type === activeCategory;
  }).sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'size') return b.sizeBytes - a.sizeBytes;
    return 0; // modified
  });

  const handleToggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(i => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(filteredFiles.map(f => f.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleRowClick = (file: FileItem) => {
    onSelectFile(file);
    if (!selectedIds.includes(file.id)) {
      setSelectedIds([file.id]);
    }
    setIsInspectorOpen(true);
  };

  const activeInspectionFile = selectedFile || files.find(f => f.id === 'f-3') || files[0];

  return (
    <div className="flex flex-col w-full min-h-screen">
      {/* Sub-Header Command Bar: Breadcrumb, Metrics & High-Level Actions */}
      <div className="px-6 py-3.5 bg-surface-container-low border-b border-white/5 flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <nav className="flex items-center gap-1.5 font-mono text-xs text-outline">
            <span className="flex items-center gap-1 text-outline">
              <span className="material-symbols-outlined text-sm">dns</span>
              Vaulta
            </span>
            <span className="material-symbols-outlined text-sm text-outline-variant">chevron_right</span>
            <span className="hover:text-primary transition-colors cursor-pointer">Workspace Projects</span>
            <span className="material-symbols-outlined text-sm text-outline-variant">chevron_right</span>
            <span className="hover:text-primary transition-colors cursor-pointer">2025 Rebrand & Identity</span>
            <span className="material-symbols-outlined text-sm text-outline-variant">chevron_right</span>
            <span className="text-on-surface font-medium bg-surface-container-high px-2 py-0.5 rounded">
              Deliverables
            </span>
          </nav>
          <div className="h-3.5 w-px bg-surface-container-highest mx-1 hidden md:block"></div>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-container text-secondary text-xs font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary-container animate-pulse"></span>
            Zero-Knowledge Synchronized
          </div>
        </div>

        {/* Top Action Set */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => alert("Audit log verified: Latest Merkle block synchronized across 3 regions.")}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-mono rounded shadow-sm transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">lock_open</span>
            <span>Audit Logs</span>
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
                onClick={() => onOpenCreateShare(activeInspectionFile.name)}
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
              onChange={(e) => setSortBy(e.target.value as any)}
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
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingOver(false);
            onOpenUpload();
          }}
          className={`flex-1 overflow-x-auto min-w-0 bg-surface transition-colors ${
            isDraggingOver ? 'bg-primary-container/5' : ''
          }`}
        >
          <div className="min-w-[780px]">
            {/* Table Header Bar */}
            <div className="grid grid-cols-[40px_minmax(240px,2.5fr)_130px_100px_160px_120px_130px_48px] items-center px-6 py-2 bg-surface-container-lowest font-mono text-[11px] text-outline uppercase tracking-wider select-none border-b border-white/5">
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
              <div>Tags</div>
              <div>Size</div>
              <div>Security Tier</div>
              <div>Collaborators</div>
              <div>Modified</div>
              <div className="text-right">Action</div>
            </div>

            {/* Directory Rows */}
            <div className="flex flex-col divide-y divide-white/5">
              {filteredFiles.map((file) => {
                const isSelected = selectedIds.includes(file.id);
                const isInspected = activeInspectionFile.id === file.id;

                return (
                  <div
                    key={file.id}
                    onClick={() => handleRowClick(file)}
                    className={`grid grid-cols-[40px_minmax(240px,2.5fr)_130px_100px_160px_120px_130px_48px] items-center px-6 py-2.5 transition-colors group cursor-pointer relative ${
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
                        onClick={(e) => handleToggleSelect(file.id, e)}
                        onChange={() => {}}
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
                          {file.extension ? `${file.extension.toUpperCase()} · Master` : `${file.size} total`}
                        </span>
                      </div>
                    </div>

                    {/* Tags */}
                    <div>
                      {file.tags[0] && (
                        <span className={`px-2 py-0.5 rounded font-mono text-[11px] inline-flex items-center gap-1 ${file.tags[0].color}`}>
                          <span className="w-1 h-1 rounded-full bg-current"></span>
                          {file.tags[0].label}
                        </span>
                      )}
                    </div>

                    {/* Size */}
                    <div className="font-mono text-xs text-on-surface font-medium">
                      {file.size}
                    </div>

                    {/* Security Tier */}
                    <div>
                      <span className="inline-flex items-center gap-1 font-mono text-xs text-secondary">
                        <span className="material-symbols-outlined text-sm text-secondary-fixed-dim">
                          {file.securityTier === 'Zero-Knowledge' ? 'enhanced_encryption' :
                           file.securityTier === 'Hardware Key' ? 'verified_user' : 'lock'}
                        </span>
                        {file.securityTier}
                      </span>
                    </div>

                    {/* Collaborators */}
                    <div className="flex items-center -space-x-1.5">
                      {file.collaborators.map((c, i) => (
                        <span
                          key={i}
                          title={`${c.name} (${c.role})`}
                          className="w-6 h-6 rounded-full bg-primary-container text-on-primary-container font-mono text-[10px] flex items-center justify-center font-bold ring-1 ring-background"
                        >
                          {c.initials}
                        </span>
                      ))}
                    </div>

                    {/* Modified */}
                    <div className="font-mono text-xs text-outline truncate">
                      {file.modified}
                    </div>

                    {/* Action */}
                    <div className="text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDownloadFile(file);
                        }}
                        className="p-1 rounded text-outline hover:text-on-surface hover:bg-surface-container transition-colors"
                        title="Download sample"
                      >
                        <span className="material-symbols-outlined text-lg">download</span>
                      </button>
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
                <h4 className="text-base text-on-surface font-semibold">Drag & Drop Assets to Ingest</h4>
                <p className="text-xs text-outline mt-0.5">
                  Hardware-accelerated AES-256 client-side chunking. Maximum single object payload 500 GB.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto justify-end">
              <button
                type="button"
                onClick={onOpenUpload}
                className="px-4 py-2 bg-surface-container hover:bg-surface-container-high text-on-surface font-mono text-xs rounded transition-colors cursor-pointer"
              >
                Browse Directory
              </button>
              <button
                type="button"
                onClick={onOpenUpload}
                className="px-4 py-2 bg-primary-container hover:bg-secondary-container text-on-primary-container hover:text-on-secondary-fixed-variant font-mono text-xs font-semibold rounded shadow-md transition-all cursor-pointer"
              >
                Direct CLI Upload
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
                  onClick={() => alert(`Enclave URI: ${activeInspectionFile.path}`)}
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
              <div className="relative rounded-xl overflow-hidden bg-surface-container-lowest border border-white/5 shadow-md group">
                {activeInspectionFile.type === 'video' ? (
                  <video
                    key={activeInspectionFile.id}
                    src={api.files.streamUrl(activeInspectionFile.id)}
                    poster={activeInspectionFile.previewUrl || VIDEO_PREVIEW_IMG}
                    controls
                    preload="metadata"
                    className="w-full h-44 object-contain bg-black"
                  />
                ) : activeInspectionFile.type === 'design' ? (
                  <img
                    src={api.files.streamUrl(activeInspectionFile.id)}
                    alt={activeInspectionFile.name}
                    className="w-full h-44 object-cover object-center"
                  />
                ) : (
                  <div className="w-full h-44 flex items-center justify-center text-outline bg-surface-container-lowest">
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
                <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-container-lowest/80 backdrop-blur-md text-[10px] font-mono text-secondary-fixed pointer-events-none">
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
                    onClick={() => onOpenCreateShare(activeInspectionFile.name)}
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
                  <span className="font-mono text-xs text-secondary-fixed-dim font-medium">Verified</span>
                </div>
                <div className="grid grid-cols-2 gap-y-1.5 font-mono text-xs">
                  <div className="text-outline">Resolution</div>
                  <div className="text-on-surface text-right">{activeInspectionFile.technicalSpecs?.resolution || '3840 × 2160 (UHD)'}</div>
                  <div className="text-outline">Color Space</div>
                  <div className="text-on-surface text-right">{activeInspectionFile.technicalSpecs?.colorSpace || 'DCI-P3 / Wide Gamut'}</div>
                  <div className="text-outline">Framerate</div>
                  <div className="text-on-surface text-right">{activeInspectionFile.technicalSpecs?.framerate || '24.000 fps TC'}</div>
                  <div className="text-outline">Bit Depth</div>
                  <div className="text-on-surface text-right">{activeInspectionFile.technicalSpecs?.bitDepth || '12-bit Quantized'}</div>
                  <div className="text-outline">Encryption</div>
                  <div className="text-secondary text-right">{activeInspectionFile.technicalSpecs?.encryption || 'AES-256-GCM'}</div>
                </div>

                <div className="pt-2 border-t border-white/5">
                  <div className="flex items-center justify-between text-outline font-mono text-xs mb-1">
                    <span>SHA-256 Checksum</span>
                    <button
                      type="button"
                      onClick={() => onCopyChecksum(activeInspectionFile.sha256)}
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

              {/* Access & Permissions Section */}
              <div className="p-4 rounded-xl bg-surface-container border border-white/5 space-y-3 shadow-inner">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-outline uppercase tracking-wider">Access & Permissions</span>
                  <button
                    type="button"
                    onClick={() => onOpenCreateShare(activeInspectionFile.name)}
                    className="text-primary text-xs font-mono hover:underline cursor-pointer"
                  >
                    + Manage
                  </button>
                </div>

                {/* Password Protected Link Toggle Box */}
                <div className="p-2.5 rounded-lg bg-surface-container-low border border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-secondary-fixed-dim text-lg">link</span>
                    <div>
                      <p className="text-xs text-on-surface font-medium leading-none">Password Protected Link</p>
                      <p className="font-mono text-[10px] text-outline leading-none mt-1">Expires in 7 days · 12 views</p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-secondary-container text-on-secondary-fixed-variant text-[10px] font-mono font-semibold">
                    Active
                  </span>
                </div>

                {/* Collaborators List */}
                <div className="space-y-2 pt-1">
                  {activeInspectionFile.collaborators.map((c, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-surface-container-highest font-mono text-[10px] flex items-center justify-center text-on-surface font-bold">
                          {c.initials}
                        </span>
                        <div>
                          <p className="text-on-surface font-medium leading-none">{c.name}</p>
                          <p className="font-mono text-[10px] text-outline leading-none mt-0.5">{c.role}</p>
                        </div>
                      </div>
                      <span className="font-mono text-[11px] text-outline">{c.role === 'Owner' ? 'Admin' : 'Can edit'}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Version History Timeline */}
              <div className="p-4 rounded-xl bg-surface-container border border-white/5 space-y-3 shadow-inner">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-outline uppercase tracking-wider">Version History</span>
                  <span className="font-mono text-xs text-secondary-fixed">v3.2 Current</span>
                </div>
                <div className="space-y-3 relative pl-4">
                  <div className="absolute left-1.5 top-1 bottom-1 w-0.5 bg-surface-container-highest"></div>
                  
                  {activeInspectionFile.versionHistory?.map((ver, vidx) => (
                    <div key={vidx} className="relative">
                      <span className={`absolute -left-4 top-1 w-2.5 h-2.5 rounded-full ring-4 ring-surface-container ${
                        ver.isActive ? 'bg-primary-container' : 'bg-surface-container-highest'
                      }`}></span>
                      <div className="flex items-center justify-between">
                        <p className={`text-xs ${ver.isActive ? 'text-on-surface font-semibold' : 'text-on-surface-variant font-medium'}`}>
                          {ver.version} {ver.isActive && '(Active)'}
                        </p>
                        {!ver.isActive ? (
                          <button
                            type="button"
                            onClick={() => onRestoreVersion(ver.version)}
                            className="text-primary hover:underline font-mono text-[11px] cursor-pointer"
                          >
                            Restore
                          </button>
                        ) : (
                          <span className="font-mono text-[11px] text-outline">{ver.timeAgo}</span>
                        )}
                      </div>
                      <p className="text-[11px] text-outline">{ver.label}</p>
                    </div>
                  )) || (
                    <div className="text-xs text-outline">v1.0 Ingested original</div>
                  )}
                </div>
              </div>

              {/* Activity Audit Trail */}
              <div className="p-4 rounded-xl bg-surface-container border border-white/5 space-y-2.5 shadow-inner">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-outline uppercase tracking-wider">Activity Audit Log</span>
                  <span className="material-symbols-outlined text-sm text-outline">verified</span>
                </div>
                <div className="space-y-2 text-xs">
                  {activeInspectionFile.auditLog?.map((log, lidx) => (
                    <div key={lidx} className="flex items-start gap-2 text-on-surface-variant">
                      <span className="material-symbols-outlined text-sm text-secondary-fixed-dim mt-0.5">
                        {lidx === 0 ? 'download' : lidx === 1 ? 'link' : 'cloud_done'}
                      </span>
                      <div>
                        <span>{log.action}</span>
                        <span className="block text-outline font-mono text-[10px]">{log.timeAgo} · {log.ip}</span>
                      </div>
                    </div>
                  )) || (
                    <div className="text-xs text-outline">Verified on fra-01 cluster node</div>
                  )}
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};
