import React, { useEffect, useRef, useState } from 'react';
import * as api from '../../api';
import type { DriveItem } from '../views/AllFilesView';
import { ExplorerDialog, explorerButton } from './ExplorerDialog';

export function FolderPickerModal({ items, initialPath, mode, onSubmit, onClose }: {
  items: DriveItem[];
  initialPath: api.ApiFolder[];
  mode: 'move' | 'copy';
  onSubmit: (destinationId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [path, setPath] = useState<api.ApiFolder[]>([]);
  const [folders, setFolders] = useState<api.ApiFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const mounted = useRef(true);
  const currentId = path.at(-1)?.id ?? null;
  const blocked = new Set(items.filter((item) => item.type === 'folder').map((item) => item.id));
  const invalidDestination = path.some((folder) => blocked.has(folder.id)) ||
    (mode === 'move' && items.every((item) => (item.parentId ?? null) === currentId));

  useEffect(() => {
    mounted.current = true;
    let active = true;
    // Re-resolve ancestors instead of trusting a stale folder path after a move.
    const resolve = async () => {
      const ancestors: api.ApiFolder[] = [];
      let id = initialPath.at(-1)?.id ?? null;
      const seen = new Set<string>();
      while (id) {
        if (seen.has(id)) throw new Error('The folder path could not be resolved.');
        seen.add(id);
        const { folder } = await api.folders.get(id);
        if (!active) return;
        ancestors.unshift(folder);
        id = folder.parentId;
      }
      if (active) setPath(ancestors);
    };
    void resolve().catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not open the folder. Browse from My files instead.');
    }).finally(() => { if (active) setInitializing(false); });
    return () => { active = false; mounted.current = false; };
  }, [initialPath]);

  useEffect(() => {
    if (initializing) return;
    let active = true;
    setLoading(true);
    setFolders([]);
    void api.folders.list(currentId).then((result) => {
      if (active) setFolders([...result.folders].sort((a, b) => a.name.localeCompare(b.name)));
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load folders.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [currentId, initializing, reload]);

  const navigate = (next: api.ApiFolder[]) => { setError(null); setPath(next); };
  return <ExplorerDialog title={`${mode === 'move' ? 'Move' : 'Copy'} ${items.length === 1 ? items[0].name : `${items.length} items`}`} onClose={onClose}>
    <div className="space-y-4 p-4">
      <p className="text-sm text-on-surface-variant">Choose a destination folder.</p>
      <nav aria-label="Destination folder" className="flex flex-wrap items-center gap-1 text-sm">
        <button type="button" disabled={initializing || busy} onClick={() => navigate([])} className={explorerButton} aria-current={!path.length ? 'page' : undefined}>My files</button>
        {path.map((folder, index) => <React.Fragment key={folder.id}>
          <span aria-hidden="true" className="material-symbols-outlined text-outline">chevron_right</span>
          <button type="button" disabled={busy} onClick={() => navigate(path.slice(0, index + 1))} className={`${explorerButton} max-w-full truncate`} aria-current={index === path.length - 1 ? 'page' : undefined}>{folder.name}</button>
        </React.Fragment>)}
      </nav>
      {error && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-error"><p className="min-w-0 break-words">{error}</p><button type="button" disabled={busy || initializing} onClick={() => { setError(null); setReload((value) => value + 1); }} className={`${explorerButton} underline`}>Retry</button></div>}
      <div className="max-h-64 min-h-32 overflow-y-auto rounded-xl border border-white/10" aria-label="Destination folders" aria-busy={loading || initializing}>
        {loading || initializing ? <p role="status" className="p-4 text-sm text-on-surface-variant">Loading folders...</p> : folders.length ? folders.map((folder) => <button key={folder.id} type="button" disabled={busy || blocked.has(folder.id)}
          onClick={() => navigate([...path, folder])} className={`${explorerButton} flex w-full items-center gap-3 rounded-none text-left`}>
          <span aria-hidden="true" className="material-symbols-outlined text-primary">folder</span>
          <span className="min-w-0 flex-1 truncate">{folder.name}</span>
          {blocked.has(folder.id) ? <span className="text-xs text-on-surface-variant">Selected</span> : <span aria-hidden="true" className="material-symbols-outlined">chevron_right</span>}
        </button>) : !error && <p className="p-4 text-sm text-on-surface-variant">No folders inside. You can choose this folder.</p>}
      </div>
      {invalidDestination && <p className="text-sm text-on-surface-variant">Choose a different folder. An item cannot be moved into itself or its current location.</p>}
      {busy && <p role="status" className="text-sm text-on-surface-variant">{mode === 'move' ? 'Moving' : 'Copying'}... Closing this dialog will not cancel the request.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={explorerButton}>Cancel</button>
        <button type="button" disabled={busy || loading || initializing || invalidDestination} className={`${explorerButton} bg-primary-container text-on-primary-container hover:bg-primary`}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            setError(null);
            try { await onSubmit(currentId); if (mounted.current) onClose(); }
            catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not transfer the items.'); }
            finally { if (mounted.current) setBusy(false); }
          }}>{busy ? 'Working...' : `${mode === 'move' ? 'Move' : 'Copy'} here`}</button>
      </div>
    </div>
  </ExplorerDialog>;
}
