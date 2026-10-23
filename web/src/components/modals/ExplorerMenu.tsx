import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface ExplorerMenuAction {
  label: string;
  icon: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}

export function ExplorerMenu({ x, y, actions, onClose, returnFocus }: {
  x: number;
  y: number;
  actions: ExplorerMenuAction[];
  onClose: () => void;
  returnFocus: HTMLElement | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [position, setPosition] = useState({ x, y });
  useLayoutEffect(() => {
    const bounds = ref.current!.getBoundingClientRect();
    setPosition({ x: Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8)) });
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [x, y]);
  useEffect(() => {
    const element = ref.current;
    const close = () => closeRef.current();
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('resize', close);
      if (returnFocus?.isConnected && (document.activeElement === document.body || element?.contains(document.activeElement))) returnFocus.focus();
    };
  }, [returnFocus]);

  return <div className="fixed inset-0 z-[80]" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }} onContextMenu={(event) => { event.preventDefault(); onClose(); }}>
    <div ref={ref} role="menu" aria-label="Item actions" style={{ left: position.x, top: position.y }}
      className="fixed max-h-[calc(100dvh-1rem)] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-white/15 bg-surface-container p-1.5 text-on-surface shadow-2xl"
      onKeyDown={(event) => {
        event.stopPropagation();
        const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); onClose(); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
      }}>
      {actions.map((action) => <button key={action.label} type="button" role="menuitem" disabled={action.disabled}
        className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40 ${action.danger ? 'text-error' : ''}`}
        onClick={() => { onClose(); returnFocus?.focus(); action.onClick(); }}>
        <span aria-hidden="true" className="material-symbols-outlined text-lg">{action.icon}</span>
        <span className="flex-1">{action.label}</span>
        {action.shortcut && <span aria-hidden="true" className="text-xs text-outline">{action.shortcut}</span>}
      </button>)}
    </div>
  </div>;
}
