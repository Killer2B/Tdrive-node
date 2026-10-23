import React from 'react';

export interface ToastMessage {
  id: string;
  type?: 'success' | 'info' | 'warning' | 'error';
  title: string;
  message?: string;
  action?: { label: string; onClick: () => void };
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div aria-live="polite" className="fixed bottom-4 right-4 left-4 sm:left-auto z-[70] flex flex-col gap-2 sm:max-w-md pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto p-4 rounded-xl bg-surface-container border border-white/10 shadow-2xl flex items-start justify-between gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <div className="flex items-start gap-3">
            <span className={`material-symbols-outlined text-lg mt-0.5 ${
              toast.type === 'error' ? 'text-error' :
              toast.type === 'warning' ? 'text-secondary-fixed' :
              'text-primary'
            }`}>
              {toast.type === 'error' ? 'error' : toast.type === 'warning' ? 'warning' : 'check_circle'}
            </span>
            <div>
              <p className="text-sm font-medium text-on-surface">{toast.title}</p>
              {toast.message && (
                <p className="text-xs text-outline mt-0.5">{toast.message}</p>
              )}
              {toast.action && <button type="button" onClick={toast.action.onClick} className="min-h-11 mt-1 text-sm font-semibold text-primary hover:underline">{toast.action.label}</button>}
            </div>
          </div>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(toast.id)}
            className="text-outline hover:text-on-surface p-1 rounded hover:bg-surface-container-high transition-colors"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      ))}
    </div>
  );
};
