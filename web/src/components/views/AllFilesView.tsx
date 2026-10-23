import React, { useEffect, useRef, useState } from 'react';
import type { ExternalLink, FileItem } from '../../types';
import * as api from '../../api';
import { VideoPlayer } from '../VideoPlayer';
import { ExplorerDialog, ExplorerNameDialog, explorerButton } from '../modals/ExplorerDialog';
import { FolderPickerModal } from '../modals/FolderPickerModal';
import { ExplorerMenu, type ExplorerMenuAction } from '../modals/ExplorerMenu';

export interface DriveItem {
  id: string;
  type: 'file' | 'folder';
  name: string;
  parentId?: string | null;
}
export interface DriveClipboard { mode: 'move' | 'copy'; items: DriveItem[] }
export interface AllFilesViewProps {
  files: FileItem[];
  folders: api.ApiFolder[];
  folderPath: api.ApiFolder[];
  foldersLoading: boolean;
  foldersError: string | null;
  onNavigateFolder: (path: api.ApiFolder[]) => void;
  onCreateFolder: (name: string) => Promise<void>;
  onRetryFolders: () => void;
  viewLayout: 'grid' | 'list';
  shareRevision: number;
  isLoading: boolean;
  loadError: string | null;
  onRetry: () => void;
  selectedFile: FileItem | null;
  selectionRevision?: number;
  onSelectFile: (file: FileItem) => void;
  onDownloadFile: (file: FileItem) => void;
  onOpenUpload: () => void;
  onOpenCreateShare: (target?: { fileId?: string; name?: string }) => void;
  onCopyChecksum: (hash: string) => void;
  onExportAuditLogs?: () => void;
  onRename: (item: DriveItem, name: string) => Promise<void>;
  onTransfer: (items: DriveItem[], destinationId: string | null, mode: 'move' | 'copy') => Promise<void>;
  onTrash: (items: DriveItem[]) => Promise<void>;
  onUploadFiles: (files: File[]) => void;
  search: string;
  onSearchChange: (query: string) => void;
  onRefresh: () => void;
  nextOffset: number | null;
  onLoadMore: () => void;
  total: number;
  clipboard: DriveClipboard | null;
  onClipboardChange: (clipboard: DriveClipboard | null) => void;
  sortBy: 'name' | 'modified' | 'size';
  sortOrder: 'asc' | 'desc';
  onSortChange: (sort: 'name' | 'modified' | 'size', order: 'asc' | 'desc') => void;
}

const itemKey = (item: DriveItem) => `${item.type}:${item.id}`;
const dragType = 'application/x-tdrive-items';
const iconForFile = (file: FileItem) => file.type === 'video' ? 'movie' : /^(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.extension ?? '') ? 'image' : file.type === 'doc' ? 'description' : file.type === 'archive' ? 'folder_zip' : file.type === 'code' ? 'code' : 'draft';

export const AllFilesView: React.FC<AllFilesViewProps> = (props) => {
  const { files, folders, folderPath, viewLayout, clipboard, search } = props;
  const currentId = folderPath.at(-1)?.id ?? null;
  const entries: DriveItem[] = [
    ...folders.map((folder): DriveItem => ({ id: folder.id, name: folder.name, type: 'folder', parentId: folder.parentId })),
    ...files.map((file): DriveItem => ({ id: file.id, name: file.name, type: 'file', parentId: file.parentId })),
  ];
  const [selected, setSelected] = useState<string[]>([]);
  const [focused, setFocused] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [preview, setPreview] = useState<FileItem | null>(null);
  const [nameDialog, setNameDialog] = useState<{ mode: 'create' | 'rename'; item?: DriveItem } | null>(null);
  const [picker, setPicker] = useState<{ mode: 'move' | 'copy'; items: DriveItem[] } | null>(null);
  const [trashItems, setTrashItems] = useState<DriveItem[] | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: DriveItem[]; trigger: HTMLElement | null } | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [externalDrag, setExternalDrag] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const anchor = useRef<string | null>(null);
  const dragItems = useRef<DriveItem[]>([]);
  const navigation = useRef(0);
  const busyItems = useRef(new Set<string>());
  const mounted = useRef(true);
  const latestClipboard = useRef(clipboard);
  latestClipboard.current = clipboard;
  const selectedItems = entries.filter((item) => selected.includes(itemKey(item)));
  const single = selectedItems.length === 1 ? selectedItems[0] : null;
  const activeFile = single?.type === 'file' ? files.find((file) => file.id === single.id) ?? null : null;
  const selectionBusy = selectedItems.some((item) => busy[itemKey(item)]);
  const allSelected = entries.length > 0 && selectedItems.length === entries.length;
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setSelected([]); setFocused(null); setMenu(null); setDetailsOpen(false); setPreview(null);
    anchor.current = null;
    navigation.current++;
  }, [currentId, search]);
  useEffect(() => {
    const keys = new Set(entries.map(itemKey));
    setSelected((previous) => previous.filter((key) => keys.has(key)));
  }, [files, folders]);
  useEffect(() => {
    const file = props.selectedFile;
    if (!file) return;
    const key = `file:${file.id}`;
    if (files.some((candidate) => candidate.id === file.id)) { setSelected((previous) => previous.includes(key) ? previous : [key]); setFocused(key); }
    else setPreview(file);
  }, [props.selectionRevision]);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedItems.length > 0 && !allSelected;
  }, [selectedItems.length, allSelected]);

  const runAction = async (label: string, items: DriveItem[], action: () => Promise<void>) => {
    const keys = items.map(itemKey);
    if (keys.some((key) => busyItems.current.has(key))) throw new Error('These items are already being updated.');
    keys.forEach((key) => busyItems.current.add(key));
    setBusy((previous) => ({ ...previous, ...Object.fromEntries(keys.map((key) => [key, label])) }));
    setActionError(null); setNotice(null);
    try { await action(); }
    catch (cause) {
      if (mounted.current) setActionError(cause instanceof Error ? cause.message : `Could not finish ${label.toLowerCase()}.`);
      throw cause;
    } finally {
      keys.forEach((key) => busyItems.current.delete(key));
      if (mounted.current) setBusy((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !keys.includes(key))));
    }
  };
  const focusRow = (key: string) => { setFocused(key); rowRefs.current.get(key)?.focus(); };
  const selectItem = (item: DriveItem, modifiers: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) => {
    const key = itemKey(item);
    const toggle = modifiers.ctrlKey || modifiers.metaKey;
    if (modifiers.shiftKey && anchor.current) {
      const from = entries.findIndex((entry) => itemKey(entry) === anchor.current);
      const to = entries.findIndex((entry) => itemKey(entry) === key);
      const range = entries.slice(Math.min(from < 0 ? to : from, to), Math.max(from, to) + 1).map(itemKey);
      setSelected((previous) => toggle ? [...new Set([...previous, ...range])] : range);
    } else {
      setSelected((previous) => toggle ? previous.includes(key) ? previous.filter((value) => value !== key) : [...previous, key] : [key]);
      anchor.current = key;
    }
    setFocused(key);
    if (item.type === 'file') {
      const file = files.find((candidate) => candidate.id === item.id);
      if (file) props.onSelectFile(file);
    }
  };
  const openItem = (item: DriveItem) => {
    if (busyItems.current.has(itemKey(item))) return;
    if (item.type === 'folder') {
      const folder = folders.find((candidate) => candidate.id === item.id);
      if (folder && !search.trim()) props.onNavigateFolder([...folderPath, folder]);
      else if (folder) {
        const revision = ++navigation.current;
        void runAction('Opening', [item], async () => {
          const path: api.ApiFolder[] = [];
          const seen = new Set<string>();
          let id: string | null = folder.id;
          while (id) {
            if (seen.has(id)) throw new Error('The folder path could not be resolved.');
            seen.add(id);
            const result = await api.folders.get(id);
            if (!mounted.current || navigation.current !== revision) return;
            path.unshift(result.folder);
            id = result.folder.parentId;
          }
          props.onNavigateFolder(path);
        }).catch(() => {});
      }
    } else {
      const file = files.find((candidate) => candidate.id === item.id);
      if (file) { props.onSelectFile(file); setPreview(file); }
    }
  };
  const putClipboard = (items: DriveItem[], mode: 'move' | 'copy') => {
    if (!items.length) return;
    props.onClipboardChange({ mode, items: items.map((item) => ({ ...item })) });
    setNotice(`${items.length} ${items.length === 1 ? 'item' : 'items'} ready to ${mode === 'move' ? 'move' : 'copy'}. Open a destination folder and paste.`);
  };
  const paste = () => {
    if (!clipboard?.items.length) return;
    const snapshot = clipboard;
    void runAction(snapshot.mode === 'move' ? 'Moving' : 'Copying', snapshot.items, () => props.onTransfer(snapshot.items, currentId, snapshot.mode))
      .then(() => {
        if (snapshot.mode === 'move' && latestClipboard.current === snapshot) props.onClipboardChange(null);
        if (mounted.current) setNotice(snapshot.mode === 'move' ? 'Items moved.' : 'Items copied.');
      }).catch(() => {});
  };
  const trash = (items: DriveItem[]) => {
    if (!items.length) return;
    setTrashItems(items.map((item) => ({ ...item })));
  };
  const openMenu = (item: DriveItem, x: number, y: number, trigger: HTMLElement | null) => {
    const targets = selected.includes(itemKey(item)) ? selectedItems : [item];
    if (!selected.includes(itemKey(item))) selectItem(item);
    setMenu({ x, y, items: targets, trigger });
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (event.defaultPrevented || !target || !root.current?.contains(target) || target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]') || document.querySelector('dialog[open],[aria-modal="true"]') || nameDialog || picker || preview || menu || trashItems) return;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelected(entries.map(itemKey)); return; }
      if (command && ['c', 'x', 'v'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        if (event.key.toLowerCase() === 'v') paste();
        else if (!selectionBusy) putClipboard(selectedItems, event.key.toLowerCase() === 'x' ? 'move' : 'copy');
        return;
      }
      if (event.key === 'Escape') { event.preventDefault(); setSelected([]); setDetailsOpen(false); anchor.current = null; return; }
      if (event.key === 'Delete' && selectedItems.length && !selectionBusy) { event.preventDefault(); trash(selectedItems); return; }
      if (event.key === 'F2' && single && !selectionBusy) { event.preventDefault(); setNameDialog({ mode: 'rename', item: single }); return; }
      if (target.closest('button,a,summary')) return;
      if (event.key === 'Enter' && single) { event.preventDefault(); openItem(single); return; }
      const focusItem = entries.find((item) => itemKey(item) === focused) ?? single;
      if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && focusItem) {
        event.preventDefault();
        const row = rowRefs.current.get(itemKey(focusItem));
        const bounds = row?.getBoundingClientRect();
        openMenu(focusItem, bounds?.left ?? 20, bounds?.bottom ?? 100, row ?? null); return;
      }
      if (event.key === ' ' && focusItem) { event.preventDefault(); selectItem(focusItem, { ctrlKey: true }); return; }
      if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) && entries.length) {
        event.preventDefault();
        const index = entries.findIndex((item) => itemKey(item) === focused);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : Math.max(0, Math.min(entries.length - 1, index + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1)));
        if (!command || event.shiftKey) selectItem(entries[next], event);
        focusRow(itemKey(entries[next]));
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  const isInternal = (event: React.DragEvent) => event.dataTransfer.types.includes(dragType);
  const moveDropped = (event: React.DragEvent, destinationId: string | null) => {
    event.preventDefault(); event.stopPropagation(); setDropTarget(null); setExternalDrag(false);
    const items = dragItems.current;
    dragItems.current = [];
    if (!items.length) { setActionError('This drag has expired. Select the items and try again.'); return; }
    if (items.some((item) => item.type === 'folder' && item.id === destinationId)) { setActionError('A folder cannot be moved into itself.'); return; }
    void runAction('Moving', items, () => props.onTransfer(items, destinationId, 'move')).catch(() => {});
  };
  const menuItems = menu?.items ?? [];
  const menuSingle = menuItems.length === 1 ? menuItems[0] : null;
  const menuFile = menuSingle?.type === 'file' ? files.find((file) => file.id === menuSingle.id) : null;
  const menuBusy = menuItems.some((item) => busy[itemKey(item)]);
  const menuActions: ExplorerMenuAction[] = [
    { label: 'Open', icon: 'open_in_new', shortcut: 'Enter', disabled: !menuSingle || menuBusy, onClick: () => { if (menuSingle) openItem(menuSingle); } },
    { label: 'Cut', icon: 'content_cut', shortcut: 'Ctrl / Cmd+X', disabled: menuBusy, onClick: () => putClipboard(menuItems, 'move') },
    { label: 'Copy', icon: 'content_copy', shortcut: 'Ctrl / Cmd+C', disabled: menuBusy, onClick: () => putClipboard(menuItems, 'copy') },
    { label: 'Move to...', icon: 'drive_file_move', disabled: menuBusy, onClick: () => setPicker({ mode: 'move', items: menuItems }) },
    { label: 'Copy to...', icon: 'folder_copy', disabled: menuBusy, onClick: () => setPicker({ mode: 'copy', items: menuItems }) },
    { label: 'Rename', icon: 'edit', shortcut: 'F2', disabled: !menuSingle || menuBusy, onClick: () => { if (menuSingle) setNameDialog({ mode: 'rename', item: menuSingle }); } },
    ...(menuFile ? [
      { label: 'Download', icon: 'download', onClick: () => props.onDownloadFile(menuFile) },
      { label: 'Share', icon: 'share', onClick: () => props.onOpenCreateShare({ fileId: menuFile.id, name: menuFile.name }) },
    ] : []),
    { label: 'Details', icon: 'info', disabled: !menuSingle, onClick: () => setDetailsOpen(true) },
    { label: 'Move to trash', icon: 'delete', shortcut: 'Delete', disabled: menuBusy, danger: true, onClick: () => trash(menuItems) },
  ];

  return <div ref={root} className="flex min-w-0 flex-col" aria-label="File explorer"
    onDragOver={(event) => {
      if (isInternal(event) || event.dataTransfer.types.includes('Files')) {
        event.preventDefault(); event.dataTransfer.dropEffect = isInternal(event) ? 'move' : 'copy';
        if (!isInternal(event)) setExternalDrag(true);
      }
    }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setExternalDrag(false); }}
    onDrop={(event) => {
      if (isInternal(event)) { moveDropped(event, currentId); return; }
      event.preventDefault(); setExternalDrag(false);
      const dropped = [...event.dataTransfer.files];
      const hasDirectory = [...event.dataTransfer.items].some((item) => item.webkitGetAsEntry?.()?.isDirectory);
      if (hasDirectory) { setActionError('Folder uploads are not supported yet. Open the folder on your computer and drop its files instead.'); return; }
      if (dropped.length) { setActionError(null); props.onUploadFiles(dropped); }
    }}>
    <div className="space-y-4 border-b border-white/5 bg-surface-container-low px-3 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Folder breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          <button type="button" onClick={() => props.onNavigateFolder([])} aria-current={!folderPath.length ? 'page' : undefined} className={`${explorerButton} font-medium`}>My files</button>
          {folderPath.map((folder, index) => <React.Fragment key={folder.id}>
            <span aria-hidden="true" className="material-symbols-outlined text-outline">chevron_right</span>
            <button type="button" title={folder.name} onClick={() => props.onNavigateFolder(folderPath.slice(0, index + 1))} aria-current={index === folderPath.length - 1 ? 'page' : undefined} className={`${explorerButton} max-w-full truncate sm:max-w-60`}>{folder.name}</button>
          </React.Fragment>)}
        </nav>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setNameDialog({ mode: 'create' })} className={`${explorerButton} flex items-center gap-2 bg-surface-container`}><span aria-hidden="true" className="material-symbols-outlined">create_new_folder</span>New folder</button>
          <button type="button" onClick={props.onOpenUpload} className={`${explorerButton} flex items-center gap-2 bg-primary-container font-medium text-on-primary-container hover:bg-primary`}><span aria-hidden="true" className="material-symbols-outlined">upload</span>Upload</button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {folderPath.length > 0 && <button type="button" onClick={() => props.onNavigateFolder(folderPath.slice(0, -1))} aria-label="Go to parent folder" className={explorerButton}><span aria-hidden="true" className="material-symbols-outlined">arrow_upward</span></button>}
        <div className="flex min-w-0 flex-1 basis-48 items-center gap-2 rounded-lg border border-white/10 bg-surface-container-lowest pl-3">
          <span aria-hidden="true" className="material-symbols-outlined text-outline">search</span>
          <label htmlFor="explorer-search" className="sr-only">Search all files and folders</label>
          <input id="explorer-search" type="search" value={search} onChange={(event) => props.onSearchChange(event.target.value)} placeholder="Search files and folders" className="min-h-11 w-full min-w-0 rounded-lg bg-transparent px-1 text-base placeholder:text-outline focus-visible:outline-2 focus-visible:outline-primary" />
          {search && <button type="button" aria-label="Clear search" onClick={() => props.onSearchChange('')} className={explorerButton}><span aria-hidden="true" className="material-symbols-outlined">close</span></button>}
        </div>
        <label htmlFor="explorer-sort" className="sr-only">Sort files and folders</label>
        <select id="explorer-sort" value={props.sortBy} onChange={(event) => props.onSortChange(event.target.value as AllFilesViewProps['sortBy'], props.sortOrder)} className="min-h-11 max-w-full rounded-lg border border-white/10 bg-surface-container px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary">
          <option value="name">Name</option><option value="modified">Date modified</option><option value="size">Size</option>
        </select>
        <button type="button" aria-label={props.sortOrder === 'asc' ? 'Sort descending' : 'Sort ascending'} onClick={() => props.onSortChange(props.sortBy, props.sortOrder === 'asc' ? 'desc' : 'asc')} className={explorerButton}><span aria-hidden="true" className="material-symbols-outlined">{props.sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'}</span></button>
        <button type="button" onClick={props.onRefresh} disabled={props.isLoading || props.foldersLoading} aria-label="Refresh files" className={explorerButton}><span aria-hidden="true" className={`material-symbols-outlined ${props.isLoading ? 'motion-safe:animate-spin' : ''}`}>refresh</span></button>
        <button type="button" aria-pressed={detailsOpen} onClick={() => setDetailsOpen((open) => !open)} className={`${explorerButton} flex items-center gap-2 ${detailsOpen ? 'bg-surface-container-high text-primary' : ''}`}><span aria-hidden="true" className="material-symbols-outlined">info</span><span className="hidden sm:inline">Details</span></button>
      </div>
    </div>

    <div className="flex min-h-16 flex-wrap items-center gap-2 border-b border-white/5 px-3 py-2 sm:px-6">
      <label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center" title="Select all loaded items">
        <input ref={selectAllRef} type="checkbox" aria-label="Select all loaded items" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? entries.map(itemKey) : [])} className="h-4 w-4 accent-primary-container focus-visible:outline-2 focus-visible:outline-primary" />
      </label>
      <span role="status" className="mr-2 text-sm text-on-surface-variant">{selectedItems.length ? `${selectedItems.length} selected` : `${props.total} ${props.total === 1 ? 'item' : 'items'}`}</span>
      {selectedItems.length > 0 && <>
        <button type="button" disabled={selectionBusy} onClick={() => setPicker({ mode: 'move', items: selectedItems })} className={explorerButton}>Move to</button>
        <button type="button" disabled={selectionBusy} onClick={() => setPicker({ mode: 'copy', items: selectedItems })} className={explorerButton}>Copy to</button>
        {single && <button type="button" disabled={selectionBusy} onClick={() => setNameDialog({ mode: 'rename', item: single })} className={explorerButton}>Rename</button>}
        {activeFile && <>
          <button type="button" onClick={() => props.onDownloadFile(activeFile)} className={explorerButton}>Download</button>
          <button type="button" onClick={() => props.onOpenCreateShare({ fileId: activeFile.id, name: activeFile.name })} className={explorerButton}>Share</button>
        </>}
        <button type="button" disabled={selectionBusy} onClick={() => trash(selectedItems)} className={`${explorerButton} text-error`}>Trash</button>
        <button type="button" aria-label="Clear selection" onClick={() => { setSelected([]); anchor.current = null; }} className={explorerButton}><span aria-hidden="true" className="material-symbols-outlined">close</span></button>
      </>}
      {clipboard?.items.length ? <div className="flex min-w-0 flex-wrap items-center gap-1 sm:ml-auto">
        <span className="text-xs text-on-surface-variant">{clipboard.items.length} ready to {clipboard.mode === 'move' ? 'move' : 'copy'}</span>
        <button type="button" disabled={clipboard.items.some((item) => busy[itemKey(item)])} onClick={paste} className={`${explorerButton} text-primary`}>Paste here</button>
        <button type="button" onClick={() => props.onClipboardChange(null)} aria-label="Clear clipboard" className={explorerButton}><span aria-hidden="true" className="material-symbols-outlined">close</span></button>
      </div> : null}
    </div>
    {notice && <p role="status" className="px-5 py-3 text-sm text-primary">{notice}</p>}
    {actionError && <div role="alert" className="flex items-start justify-between gap-2 border-b border-error/20 bg-error-container/10 px-5 py-2"><p className="min-w-0 self-center break-words text-sm text-error">{actionError}</p><button type="button" aria-label="Dismiss error" onClick={() => setActionError(null)} className={explorerButton}><span aria-hidden="true" className="material-symbols-outlined">close</span></button></div>}
    {props.foldersError && <div role="alert" className="flex flex-wrap items-center gap-2 p-4 text-sm text-error"><p className="min-w-0 break-words">{props.foldersError}</p><button type="button" onClick={props.onRetryFolders} className={`${explorerButton} underline`}>Retry folders</button></div>}
    {props.loadError && <div role="alert" className="flex flex-wrap items-center gap-2 p-4 text-sm text-error"><p className="min-w-0 break-words">{props.loadError}</p><button type="button" onClick={props.onRetry} className={`${explorerButton} underline`}>Retry</button></div>}

    <div className="flex min-w-0 flex-col xl:flex-row">
      <div className={`relative min-w-0 flex-1 ${externalDrag ? 'bg-primary/10 ring-2 ring-inset ring-primary' : ''}`}>
        {externalDrag && <p role="status" className="pointer-events-none sticky top-0 z-10 bg-primary-container p-4 text-center text-sm font-medium text-on-primary-container">Drop files to upload to {folderPath.at(-1)?.name ?? 'My files'}</p>}
        {viewLayout === 'list' && <div aria-hidden="true" className="hidden grid-cols-[44px_minmax(0,1fr)_110px_150px_44px] gap-3 border-b border-white/5 px-3 py-3 text-xs text-on-surface-variant md:grid sm:px-6"><span /><span>Name</span><span>Size</span><span>Date modified</span><span /></div>}
        <div role="grid" aria-label={search ? 'Search results' : 'Files and folders'} aria-multiselectable="true" aria-busy={props.isLoading || props.foldersLoading} tabIndex={entries.length ? -1 : 0} className={viewLayout === 'grid' ? 'grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 sm:p-6 2xl:grid-cols-3' : 'divide-y divide-white/5'}
          onClick={(event) => { if (event.target === event.currentTarget) { setSelected([]); anchor.current = null; } }}>
          {entries.map((item, index) => {
            const key = itemKey(item);
            const file = item.type === 'file' ? files.find((candidate) => candidate.id === item.id) : null;
            const folder = item.type === 'folder' ? folders.find((candidate) => candidate.id === item.id) : null;
            const checked = selected.includes(key);
            const cut = clipboard?.mode === 'move' && clipboard.items.some((candidate) => itemKey(candidate) === key);
            return <div key={key} ref={(element) => { if (element) rowRefs.current.set(key, element); else rowRefs.current.delete(key); }} role="row" aria-selected={checked} aria-label={item.name}
              tabIndex={focused === key || (!focused && index === 0) ? 0 : -1} onFocus={() => setFocused(key)} draggable={!busy[key]}
              onClick={(event) => { if (event.detail <= 1 || event.ctrlKey || event.metaKey || event.shiftKey) selectItem(item, event); event.currentTarget.focus(); }} onDoubleClick={() => openItem(item)}
              onContextMenu={(event) => { event.preventDefault(); openMenu(item, event.clientX, event.clientY, event.currentTarget); }}
              onDragStart={(event) => {
                const targets = checked ? selectedItems : [item];
                if (targets.some((candidate) => busyItems.current.has(itemKey(candidate)))) { event.preventDefault(); return; }
                if (!checked) selectItem(item);
                dragItems.current = targets;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData(dragType, JSON.stringify(targets));
              }} onDragEnd={() => { dragItems.current = []; setDropTarget(null); }}
              onDragOver={(event) => { if (folder && isInternal(event)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDropTarget(key); } }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget((previous) => previous === key ? null : previous); }}
              onDrop={(event) => { if (folder && isInternal(event)) moveDropped(event, folder.id); }}
              className={`group relative grid min-w-0 items-center gap-2 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${viewLayout === 'grid' ? 'grid-cols-[44px_minmax(0,1fr)_44px] rounded-xl border border-white/10 p-3' : 'grid-cols-[44px_minmax(0,1fr)_44px] px-3 py-1 md:grid-cols-[44px_minmax(0,1fr)_110px_150px_44px] md:gap-3 sm:px-6'} ${dropTarget === key ? 'bg-primary/20 ring-2 ring-inset ring-primary' : checked ? 'bg-primary/10' : 'hover:bg-surface-container-low'} ${cut ? 'opacity-60' : ''}`}>
              <div role="gridcell">
                <label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}>
                  <input type="checkbox" aria-label={`Select ${item.name}`} checked={checked} onChange={() => selectItem(item, { ctrlKey: true })} className="h-4 w-4 accent-primary-container focus-visible:outline-2 focus-visible:outline-primary" />
                </label>
              </div>
              <div role="gridcell" className="flex min-w-0 items-center gap-3 py-2">
                <span aria-hidden="true" className={`material-symbols-outlined shrink-0 ${folder ? 'text-primary' : 'text-on-surface-variant'} ${viewLayout === 'grid' ? 'text-3xl' : 'text-2xl'}`}>{folder ? 'folder' : file ? iconForFile(file) : 'draft'}</span>
                <div className="min-w-0"><p title={item.name} className="truncate text-sm font-medium text-on-surface">{item.name}</p>
                  <p className="truncate text-xs text-on-surface-variant">{busy[key] ? `${busy[key]}...` : folder ? 'Folder' : viewLayout === 'grid' ? `${file?.size ?? ''} ${file?.extension ? ` / ${file.extension.toUpperCase()}` : ''}` : file?.extension?.toUpperCase() ?? 'File'}</p>
                </div>
              </div>
              {viewLayout === 'list' && <><div role="gridcell" className="hidden text-sm text-on-surface-variant md:block">{file?.size ?? '-'}</div><div role="gridcell" className="hidden truncate text-sm text-on-surface-variant md:block">{file?.modified ?? (folder ? new Date(folder.modified).toLocaleDateString() : '')}</div></>}
              <div role="gridcell"><button type="button" aria-label={`More actions for ${item.name}`} aria-haspopup="menu" aria-expanded={menu?.items.some((candidate) => itemKey(candidate) === key) ?? false}
                onPointerDown={(event) => event.stopPropagation()} onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); const bounds = event.currentTarget.getBoundingClientRect(); openMenu(item, bounds.right - 256, bounds.bottom, event.currentTarget); }} className={`${explorerButton} flex items-center justify-center p-0 text-on-surface-variant`}><span aria-hidden="true" className="material-symbols-outlined">more_horiz</span></button></div>
            </div>;
          })}
        </div>
        {!entries.length && !(props.isLoading || props.foldersLoading) && !props.loadError && !props.foldersError && <div className="px-5 py-16 text-center">
          <span aria-hidden="true" className="material-symbols-outlined mb-3 text-5xl text-primary">{search ? 'search' : 'folder_open'}</span>
          <h2 className="text-lg font-medium">{search ? 'No matching files or folders' : 'This folder is empty'}</h2>
          <p className="mt-2 text-sm text-on-surface-variant">{search ? 'Try a different name.' : 'Drop files here, upload from your computer, or create a folder.'}</p>
          {!search && <button type="button" onClick={props.onOpenUpload} className={`${explorerButton} mt-4 bg-primary-container text-on-primary-container hover:bg-primary`}>Upload files</button>}
        </div>}
        {(props.isLoading || props.foldersLoading) && <p role="status" className="p-6 text-center text-sm text-on-surface-variant">Loading...</p>}
        {props.nextOffset !== null && <div className="flex flex-wrap items-center justify-center gap-3 p-5"><span className="text-sm text-on-surface-variant">Showing {entries.length} of {props.total} items</span><button type="button" onClick={props.onLoadMore} disabled={props.isLoading} className={`${explorerButton} bg-surface-container`}>Load more</button></div>}
        {entries.length > 0 && <p className="px-6 py-5 text-xs text-on-surface-variant">Double-click to open. Drag files here to upload. {selectedItems.length > 1 ? 'Download is available for one file at a time; your browser handles each download separately.' : 'Use Ctrl / Cmd to select more than one item.'}</p>}
      </div>
      {detailsOpen && <FileDetails item={single} file={activeFile} shareRevision={props.shareRevision} onClose={() => setDetailsOpen(false)} onCopyChecksum={props.onCopyChecksum} onExportAuditLogs={props.onExportAuditLogs} />}
    </div>
    {menu && <ExplorerMenu x={menu.x} y={menu.y} actions={menuActions} returnFocus={menu.trigger} onClose={() => setMenu(null)} />}
    {trashItems && <TrashConfirmation items={trashItems} onClose={() => setTrashItems(null)} onConfirm={async () => {
      await runAction('Moving to trash', trashItems, () => props.onTrash(trashItems));
      if (mounted.current) setSelected((previous) => previous.filter((key) => !trashItems.some((item) => itemKey(item) === key)));
    }} />}
    {nameDialog && <ExplorerNameDialog mode={nameDialog.mode} itemName={nameDialog.item?.name} onClose={() => setNameDialog(null)} onSubmit={(name) => nameDialog.item ? runAction('Renaming', [nameDialog.item], () => props.onRename(nameDialog.item!, name)) : props.onCreateFolder(name)} />}
    {picker && <FolderPickerModal initialPath={folderPath} items={picker.items} mode={picker.mode} onClose={() => setPicker(null)} onSubmit={(destinationId) => runAction(picker.mode === 'move' ? 'Moving' : 'Copying', picker.items, () => props.onTransfer(picker.items, destinationId, picker.mode))} />}
    {preview && <FilePreview file={preview} onClose={() => setPreview(null)} onDownload={() => props.onDownloadFile(preview)} onShare={() => props.onOpenCreateShare({ fileId: preview.id, name: preview.name })} />}
  </div>;
};

function TrashConfirmation({ items, onClose, onConfirm }: { items: DriveItem[]; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return <ExplorerDialog title="Move to trash?" onClose={onClose}>
    <div className="space-y-4 p-5">
      <p className="break-words text-sm">{items.length === 1 ? `Move "${items[0].name}" to trash?` : `Move ${items.length} selected items to trash?`} Files can be restored from Trash.</p>
      {items.some((item) => item.type === 'folder') && <p className="rounded-lg bg-surface-container p-3 text-sm text-on-surface-variant">Folder trash is not supported yet. Folders will not be permanently deleted or emptied. The server will report any unsupported items.</p>}
      {error && <p role="alert" className="break-words text-sm text-error">{error}</p>}
      {busy && <p role="status" className="text-sm text-on-surface-variant">Moving to trash... Closing this dialog will not cancel the request.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" autoFocus onClick={onClose} className={explorerButton}>Cancel</button>
        <button type="button" disabled={busy || !!error} onClick={async () => {
          if (busy) return;
          setBusy(true); setError(null);
          try { await onConfirm(); if (mounted.current) onClose(); }
          catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not move the items to trash.'); }
          finally { if (mounted.current) setBusy(false); }
        }} className={`${explorerButton} bg-error-container text-on-error-container hover:bg-error-container/80`}>{busy ? 'Moving...' : 'Move to trash'}</button>
      </div>
    </div>
  </ExplorerDialog>;
}

function FilePreview({ file, onClose, onDownload, onShare }: { file: FileItem; onClose: () => void; onDownload: () => void; onShare: () => void }) {
  const [imageError, setImageError] = useState(false);
  const isImage = /^(png|jpe?g|gif|webp|avif|bmp|svg|ico)$/i.test(file.extension ?? '');
  return <ExplorerDialog title={file.name} onClose={onClose} wide>
    <div className="space-y-4 p-4">
      {file.type === 'video' ? <VideoPlayer key={file.id} src={api.files.streamUrl(file.id)} poster={file.previewUrl} /> : isImage && !imageError ? <img src={api.files.streamUrl(file.id)} alt={file.name} onError={() => setImageError(true)} className="max-h-[65dvh] w-full rounded-lg bg-surface-container-lowest object-contain" /> : <div className="rounded-xl bg-surface-container-lowest px-4 py-16 text-center"><span aria-hidden="true" className="material-symbols-outlined text-5xl text-primary">{iconForFile(file)}</span><p className="mt-4 text-sm text-on-surface-variant">{imageError ? 'The image could not be loaded.' : 'A preview is not available for this file.'}</p><p className="mt-2 text-sm text-on-surface-variant">Download it to open it on your computer.</p></div>}
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-on-surface-variant">{file.size}</p><div className="flex gap-2"><button type="button" onClick={onShare} className={explorerButton}>Share</button><button type="button" onClick={onDownload} className={`${explorerButton} bg-primary-container text-on-primary-container hover:bg-primary`}>Download</button></div></div>
    </div>
  </ExplorerDialog>;
}

function FileDetails({ item, file, shareRevision, onClose, onCopyChecksum, onExportAuditLogs }: {
  item: DriveItem | null; file: FileItem | null; shareRevision: number; onClose: () => void;
  onCopyChecksum: (hash: string) => void; onExportAuditLogs?: () => void;
}) {
  const [shares, setShares] = useState<ExternalLink[]>([]);
  const [activity, setActivity] = useState<api.ApiActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    setShares([]); setActivity([]); setError(null);
    if (!file) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    void Promise.all([api.shares.forFile(file.id), api.activity.list({ fileId: file.id, limit: 10 })])
      .then(([links, records]) => { if (active) { setShares(links.shares); setActivity(records.items); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load details.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [file?.id, shareRevision, reload]);
  return <aside aria-label="Item details" className="w-full shrink-0 border-t border-white/10 bg-surface-container-low xl:w-80 xl:border-t-0 xl:border-l">
    <div className="flex items-center justify-between gap-2 border-b border-white/5 p-4"><h2 className="font-medium">Details</h2><button type="button" aria-label="Close details" onClick={onClose} className={explorerButton}><span aria-hidden="true" className="material-symbols-outlined">close</span></button></div>
    <div className="space-y-5 p-5">
      {!item ? <p className="text-sm text-on-surface-variant">Select one file or folder to see its details.</p> : <>
        <h3 className="break-words text-base font-semibold">{item.name}</h3>
        <dl className="space-y-3 text-sm"><div className="flex justify-between gap-3"><dt className="text-on-surface-variant">Type</dt><dd>{item.type === 'folder' ? 'Folder' : file?.extension?.toUpperCase() ?? 'File'}</dd></div>
          {file && <><div className="flex justify-between gap-3"><dt className="text-on-surface-variant">Size</dt><dd>{file.size}</dd></div><div><dt className="text-on-surface-variant">Modified</dt><dd className="mt-1">{new Date(file.modifiedTs).toLocaleString()}</dd></div></>}
        </dl>
        {file && <>
          {loading && <p role="status" className="text-sm text-on-surface-variant">Loading details...</p>}
          {error && <div role="alert"><p className="break-words text-sm text-error">{error}</p><button type="button" onClick={() => setReload((value) => value + 1)} className={`${explorerButton} text-primary`}>Retry</button></div>}
          <section><h4 className="mb-2 text-sm font-medium">Shared links</h4>{shares.length ? shares.map((share) => <div key={share.id} className="mb-2 rounded-lg bg-surface-container p-3 text-sm"><p className="break-all">{share.vanityEndpoint}</p><p className="mt-1 text-xs text-on-surface-variant">{share.isRevoked ? 'Revoked' : share.isExpired ? 'Expired' : 'Active'}</p></div>) : !loading && !error && <p className="text-sm text-on-surface-variant">No shared links.</p>}</section>
          <section><h4 className="mb-2 text-sm font-medium">Activity</h4>{activity.length ? activity.map((record) => <div key={record.id} className="mb-3 text-sm"><p>{record.action.replaceAll('_', ' ')}</p><p className="mt-1 text-xs text-on-surface-variant">{new Date(record.at).toLocaleString()}</p></div>) : !loading && !error && <p className="text-sm text-on-surface-variant">No activity yet.</p>}</section>
          <details className="border-t border-white/10 pt-3"><summary className="min-h-11 cursor-pointer py-3 text-sm text-on-surface-variant focus-visible:outline-2 focus-visible:outline-primary">More information</summary><div className="space-y-3 pt-2"><p className="break-all font-mono text-xs text-on-surface-variant">SHA-256: {file.sha256 || 'Unavailable'}</p><button type="button" disabled={!file.sha256} onClick={() => onCopyChecksum(file.sha256)} className={explorerButton}>Copy checksum</button>{onExportAuditLogs && <button type="button" onClick={onExportAuditLogs} className={explorerButton}>Export activity</button>}</div></details>
        </>}
      </>}
    </div>
  </aside>;
}
