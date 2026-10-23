import React, { useState, useRef, useEffect } from 'react';
import * as api from '../../api';
import { ToastMessage } from '../Toast';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  folderId: string | null;
  folderName: string;
  initialFiles?: File[];
  onInitialFilesHandled?: () => void;
  onUploaded: () => void;
  onToast: (title: string, message?: string, type?: ToastMessage['type']) => void;
}

interface UploadItem {
  id: string;
  file: File;
  folderId: string | null;
  name: string;
  progress: number;
  speed: string;
  status: 'queued' | 'uploading' | 'done' | 'error' | 'canceled';
  error?: string;
}

function fmtDuration(sec?: number): string {
  if (!sec) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export const UploadModal: React.FC<UploadModalProps> = ({ isOpen, onClose, folderId, folderName, onUploaded, onToast, initialFiles, onInitialFilesHandled }) => {
  const [activeTab, setActiveTab] = useState<'browse' | 'remote'>('browse');
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<UploadItem[]>([]);
  const activeRef = useRef(new Map<string, api.UploadHandle>());

  // الرابط
  const [url, setUrl] = useState('');
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<Awaited<ReturnType<typeof api.downloads.probe>> | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [formatId, setFormatId] = useState<string>('best');
  const [enqueuing, setEnqueuing] = useState(false);

  const updateUpload = (id: string, patch: Partial<UploadItem>) => setUploads((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  const pumpUploads = () => {
    while (activeRef.current.size < 2 && pendingRef.current.length) {
      const item = pendingRef.current.shift()!;
      updateUpload(item.id, { status: 'uploading', error: undefined });
      const handle = api.uploadFile(item.file, {
        folderId: item.folderId,
        onProgress: (fraction, speed) => updateUpload(item.id, { progress: Math.round(fraction * 100), speed }),
      });
      activeRef.current.set(item.id, handle);
      handle.promise
        .then(() => { updateUpload(item.id, { progress: 100, status: 'done' }); onUploaded(); })
        .catch((error: unknown) => {
          const canceled = error instanceof Error && (error.name === 'AbortError' || (error instanceof api.ApiError && error.code === 'Canceled'));
          updateUpload(item.id, { status: canceled ? 'canceled' : 'error', error: canceled ? undefined : error instanceof Error ? error.message : 'فشل الرفع' });
        })
        .finally(() => { activeRef.current.delete(item.id); pumpUploads(); });
    }
  };
  const handleNativeFiles = (fileList: FileList | File[] | null) => {
    if (!fileList?.length) return;
    const items: UploadItem[] = Array.from(fileList).map((file) => ({ id: crypto.randomUUID(), file, folderId, name: file.name, progress: 0, speed: '', status: 'queued' }));
    setUploads((previous) => [...items, ...previous]); pendingRef.current.push(...items); pumpUploads();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  const cancelUpload = (item: UploadItem) => {
    pendingRef.current = pendingRef.current.filter((queued) => queued.id !== item.id);
    activeRef.current.get(item.id)?.cancel(); updateUpload(item.id, { status: 'canceled' });
  };
  const retryUpload = (item: UploadItem) => {
    const retry = { ...item, progress: 0, speed: '', status: 'queued' as const, error: undefined };
    updateUpload(item.id, retry); pendingRef.current.push(retry); pumpUploads();
  };
  useEffect(() => {
    if (isOpen && initialFiles?.length) { handleNativeFiles(initialFiles); onInitialFilesHandled?.(); }
  }, [isOpen, initialFiles]);
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key !== 'Tab') return;
      const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]') ?? [])].filter((element) => element.offsetParent !== null);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    dialogRef.current?.addEventListener('keydown', keyboard);
    return () => { dialogRef.current?.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, [isOpen]);
  useEffect(() => () => { pendingRef.current = []; for (const handle of activeRef.current.values()) handle.cancel(); }, []);

  if (!isOpen) return null;

  const runProbe = async () => {
    if (!url.trim()) return;
    setProbing(true);
    setProbe(null);
    setProbeError(null);
    try {
      const result = await api.downloads.probe(url.trim());
      if (result.mode === 'error') {
        setProbeError(result.message ?? 'تعذّرت قراءة الرابط');
        return;
      }
      setProbe(result);
      setFormatId(result.qualities?.[0]?.id ?? 'best');
    } catch (e) {
      setProbeError(e instanceof Error ? e.message : 'تعذّرت قراءة الرابط');
    } finally {
      setProbing(false);
    }
  };

  const startDownload = async () => {
    if (!probe) return;
    setEnqueuing(true);
    try {
      await api.downloads.enqueue({
        url: url.trim(),
        mode: probe.mode === 'media' ? 'media' : 'direct',
        formatId: probe.mode === 'media' ? formatId : undefined,
        folderId,
        title: probe.title,
        name: probe.filename,
      });
      onToast('أُضيف للتحميل', probe.title ?? url);
      setUrl('');
      setProbe(null);
      onClose();
    } catch (e) {
      onToast('تعذّرت الإضافة', e instanceof Error ? e.message : undefined, 'error');
    } finally {
      setEnqueuing(false);
    }
  };

  const tabClass = (tab: string) =>
    `pb-2.5 px-3 font-mono text-xs border-b-2 transition-colors ${
      activeTab === tab ? 'border-primary-container text-primary font-medium' : 'border-transparent text-outline hover:text-on-surface'
    }`;

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200" dir="rtl">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="upload-title" className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-surface-container-low border border-white/10 rounded-2xl shadow-2xl flex flex-col outline-none">
        <div className="p-5 bg-surface-container flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary-container text-on-primary-container flex items-center justify-center shadow-md">
              <span className="material-symbols-outlined text-xl">cloud_upload</span>
            </div>
            <div>
              <h3 id="upload-title" className="text-lg font-semibold text-on-surface">إضافة ملفّات</h3>
              <p className="font-mono text-xs text-outline">رفع مجزّأ قابل للاستئناف · أو تحميل من رابط</p>
              <p className="font-mono text-xs text-primary mt-1 break-all" dir="ltr">Destination: {folderName}</p>
            </div>
          </div>
          <button type="button" aria-label="Close upload dialog" onClick={onClose} className="min-h-11 min-w-11 rounded-lg hover:bg-surface-container-high text-outline hover:text-on-surface transition-colors">
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        <div className="flex border-b border-white/5 bg-surface-container-lowest px-5 pt-2 gap-2">
          <button type="button" onClick={() => setActiveTab('browse')} className={tabClass('browse')}>
            رفع من الجهاز
          </button>
          <button type="button" onClick={() => setActiveTab('remote')} className={tabClass('remote')}>
            تحميل من رابط
          </button>
        </div>

        <div className="p-6">
          {activeTab === 'browse' && (
            <>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  handleNativeFiles(e.dataTransfer.files);
                }}
                role="button" tabIndex={0} aria-label="Select files to upload"
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); fileInputRef.current?.click(); } }}
                className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer focus-visible:outline focus-visible:outline-primary transition-colors ${
                  isDragging ? 'border-primary bg-primary-container/10 scale-[0.99]' : 'border-white/10 hover:border-primary-container/60 hover:bg-surface-container'
                }`}
              >
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleNativeFiles(e.target.files)} />
                <div className="w-14 h-14 rounded-2xl bg-surface-container-high flex items-center justify-center text-primary mb-3 shadow-inner">
                  <span className="material-symbols-outlined text-3xl">upload_file</span>
                </div>
                <h4 className="text-base font-semibold text-on-surface">اسحب الملفّات هنا أو انقر للاختيار</h4>
                <p className="text-xs text-outline mt-1 max-w-sm">
                  رفع قابل للاستئناف مع التحقق من الأجزاء. عند انقطاع الاتصال اضغط إعادة المحاولة لإكمال الأجزاء الناقصة.
                </p>
              </div>

              {uploads.length > 0 && (
                <div className="mt-4 space-y-2 max-h-52 overflow-y-auto">
                  {uploads.map((u) => (
                    <div key={u.id} className="p-3 rounded-lg bg-surface-container border border-white/5">
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-on-surface truncate max-w-[70%]">{u.name}</span>
                        <span className={`font-mono ${u.status === 'error' ? 'text-error' : u.status === 'done' ? 'text-secondary-fixed' : 'text-outline'}`}>
                          {u.status === 'error' ? 'خطأ' : u.status === 'done' ? 'اكتمل' : u.status === 'queued' ? 'بانتظار الرفع' : u.status === 'canceled' ? 'أُلغي' : `${u.progress}% · ${u.speed}`}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-surface-container-lowest overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${u.status === 'error' ? 'bg-error' : 'bg-primary-container'}`}
                          style={{ width: `${u.progress}%` }}
                        />
                      </div>
                      {u.error && <p className="text-[11px] text-error mt-1">{u.error}</p>}
                      <div className="flex gap-2 mt-1">
                        {(u.status === 'queued' || u.status === 'uploading') && <button type="button" onClick={() => cancelUpload(u)} className="min-h-11 text-xs text-error underline">إلغاء</button>}
                        {(u.status === 'error' || u.status === 'canceled') && <button type="button" onClick={() => retryUpload(u)} className="min-h-11 text-xs text-primary underline">إعادة المحاولة</button>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === 'remote' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                  <input aria-label="Download URL"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runProbe()}
                  placeholder="https://... (يوتيوب، فيديو، أو رابط ملف مباشر)"
                  className="flex-1 bg-surface-container-lowest border border-white/10 rounded-lg px-3 py-2.5 text-on-surface outline-none focus:border-primary-container transition-colors text-sm"
                />
                <button
                  onClick={runProbe}
                  disabled={probing || !url.trim()}
                  className="px-4 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {probing ? <span className="material-symbols-outlined animate-spin text-lg">progress_activity</span> : <span className="material-symbols-outlined text-lg">search</span>}
                  معاينة
                </button>
              </div>

              {probeError && (
                <div className="flex items-center gap-2 text-error text-sm bg-error-container/20 border border-error/20 rounded-lg px-3 py-2">
                  <span className="material-symbols-outlined text-base">error</span>
                  <span>{probeError}</span>
                </div>
              )}

              {probe && (
                <div className="p-4 rounded-xl bg-surface-container border border-white/5 space-y-3">
                  <div className="flex gap-3">
                    {probe.thumbnail && <img src={probe.thumbnail} alt="" className="w-28 h-16 object-cover rounded-lg bg-surface-container-lowest" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-on-surface font-medium text-sm truncate">{probe.title ?? 'ملف'}</p>
                      <p className="font-mono text-xs text-outline mt-1">
                        {probe.mode === 'media'
                          ? `${probe.uploader ?? ''} ${probe.durationSec ? `· ${fmtDuration(probe.durationSec)}` : ''}`
                          : `${api.formatSize(probe.sizeBytes)} ${probe.contentType ? `· ${probe.contentType}` : ''}`}
                      </p>
                    </div>
                  </div>

                  {probe.mode === 'media' && probe.qualities && probe.qualities.length > 0 && (
                    <div>
                      <label className="font-mono text-xs text-outline uppercase tracking-wider">الجودة</label>
                      <select
                        value={formatId}
                        onChange={(e) => setFormatId(e.target.value)}
                        className="mt-1.5 w-full bg-surface-container-lowest border border-white/10 rounded-lg px-3 py-2 text-on-surface text-sm outline-none focus:border-primary-container"
                      >
                        {probe.qualities.map((q) => (
                          <option key={q.id} value={q.id}>
                            {q.label} {q.filesize ? `(${api.formatSize(q.filesize)})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <button
                    onClick={startDownload}
                    disabled={enqueuing}
                    className="w-full py-2.5 rounded-lg bg-primary-container text-on-primary-container font-medium hover:bg-secondary-container hover:text-on-secondary-fixed-variant transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined text-xl">download</span>
                    بدء التحميل إلى سحابتي
                  </button>
                </div>
              )}

              <p className="text-[11px] text-outline leading-relaxed">
                يتمّ التحميل على الخادم ثم الحفظ في تخزينك. يظهر التقدّم في «نظرة عامّة». لا نتجاوز أيّ حماية DRM؛ إن كان المحتوى محميًّا ستظهر رسالة واضحة.
              </p>
            </div>
          )}
        </div>

        <div className="p-4 bg-surface-container border-t border-white/5 flex items-center justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-mono text-xs transition-colors">
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
