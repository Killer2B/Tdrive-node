import React, { useEffect, useId, useRef } from 'react';

export const explorerButton = 'min-h-11 min-w-11 rounded-lg px-3 text-sm transition-colors hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 disabled:cursor-not-allowed';

export function ExplorerDialog({ title, children, onClose, wide = false }: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return <dialog ref={ref} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); closeRef.current(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}
    className={`fixed m-auto max-h-[90dvh] w-[calc(100%-2rem)] ${wide ? 'max-w-4xl' : 'max-w-lg'} overflow-y-auto rounded-2xl border border-white/10 bg-surface-container-low p-0 text-on-surface shadow-2xl backdrop:bg-black/70`}>
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-white/10 p-4">
      <h2 id={titleId} className="min-w-0 break-words text-lg font-semibold">{title}</h2>
      <button type="button" onClick={onClose} aria-label={`Close ${title}`} className={explorerButton}>
        <span aria-hidden="true" className="material-symbols-outlined">close</span>
      </button>
    </div>
    {children}
  </dialog>;
}

export function ExplorerNameDialog({ itemName, mode, onSubmit, onClose }: {
  itemName?: string;
  mode: 'create' | 'rename';
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = React.useState(itemName ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputId = useId();
  const mounted = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    mounted.current = true;
    input.current?.focus();
    if (mode === 'rename') {
      const dot = (itemName ?? '').lastIndexOf('.');
      input.current?.setSelectionRange(0, dot > 0 ? dot : (itemName ?? '').length);
    }
    return () => { mounted.current = false; };
  }, [mode, itemName]);

  return <ExplorerDialog title={mode === 'create' ? 'New folder' : 'Rename'} onClose={onClose}>
    <form className="space-y-4 p-5" onSubmit={async (event) => {
      event.preventDefault();
      if (busy || !name.trim()) return;
      setBusy(true);
      setError(null);
      try {
        await onSubmit(name.trim());
        if (mounted.current) onClose();
      } catch (cause) {
        if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not save the name. Try again.');
      } finally {
        if (mounted.current) setBusy(false);
      }
    }}>
      <label htmlFor={inputId} className="block text-sm">{mode === 'create' ? 'Folder name' : 'Name'}</label>
      <input ref={input} id={inputId} autoFocus required maxLength={200} value={name} disabled={busy}
        onChange={(event) => setName(event.target.value)} aria-describedby={error ? `${inputId}-error` : undefined}
        className="min-h-11 w-full rounded-lg border border-white/15 bg-surface-container-lowest px-3 text-base focus-visible:outline-2 focus-visible:outline-primary" />
      {error && <p id={`${inputId}-error`} role="alert" className="break-words text-sm text-error">{error}</p>}
      {busy && <p role="status" className="text-sm text-on-surface-variant">Saving... Closing this dialog will not cancel the request.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={explorerButton}>Cancel</button>
        <button type="submit" disabled={busy || !name.trim() || (mode === 'rename' && name.trim() === itemName)} className={`${explorerButton} bg-primary-container text-on-primary-container hover:bg-primary`}>
          {busy ? 'Saving...' : mode === 'create' ? 'Create folder' : 'Save'}
        </button>
      </div>
    </form>
  </ExplorerDialog>;
}
