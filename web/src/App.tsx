/**
 * Tdrive — جذر التطبيق. يحافظ على تصميم Vaulta ويربطه بالـ API الحقيقيّ:
 * مصادقة، ملفّات/سلّة حقيقية، رفع مجزّأ، تحميل من الروابط، وتقدّم لحظيّ عبر SSE.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ViewMode, FileItem, ExternalLink, ActiveTransfer, ClientNode } from './types';
import {
  INITIAL_SHARED_VAULTS,
  INITIAL_EXTERNAL_LINKS,
  INITIAL_CLIENT_NODES,
} from './data/mockData';
import * as api from './api';
import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { OverviewView } from './components/views/OverviewView';
import { AllFilesView } from './components/views/AllFilesView';
import { SharedVaultsView } from './components/views/SharedVaultsView';
import { SecurityAuditView } from './components/views/SecurityAuditView';
import { RecentStarredView } from './components/views/RecentStarredView';
import { TrashView } from './components/views/TrashView';
import { SettingsView } from './components/views/SettingsView';
import { CreateShareDrawer } from './components/modals/CreateShareDrawer';
import { UploadModal } from './components/modals/UploadModal';
import { DeduplicationModal } from './components/modals/DeduplicationModal';
import { EmergencyZeroOutModal } from './components/modals/EmergencyZeroOutModal';
import { UpgradeModal } from './components/modals/UpgradeModal';
import { CommandPalette } from './components/CommandPalette';
import { ToastContainer, ToastMessage } from './components/Toast';

type AuthState = 'checking' | 'out' | 'in';

export default function App() {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [username, setUsername] = useState('المالك');

  const [currentView, setCurrentView] = useState<ViewMode>('overview');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [trashItems, setTrashItems] = useState<FileItem[]>([]);
  const [sharedVaults] = useState(INITIAL_SHARED_VAULTS);
  const [externalLinks, setExternalLinks] = useState<ExternalLink[]>(INITIAL_EXTERNAL_LINKS);
  const [transfers, setTransfers] = useState<ActiveTransfer[]>([]);
  const [clientNodes, setClientNodes] = useState<ClientNode[]>(INITIAL_CLIENT_NODES);

  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [storageUsedTB, setStorageUsedTB] = useState<number>(0);
  const [storageTotalTB, setStorageTotalTB] = useState<number>(5.0);
  const [viewLayout, setViewLayout] = useState<'grid' | 'list'>('grid');

  const [isShareDrawerOpen, setIsShareDrawerOpen] = useState(false);
  const [shareTargetName, setShareTargetName] = useState<string>('');
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isDeduplicationOpen, setIsDeduplicationOpen] = useState(false);
  const [isZeroOutOpen, setIsZeroOutOpen] = useState(false);
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const jobsRef = useRef<Map<string, api.ApiJob>>(new Map());

  const addToast = useCallback(
    (title: string, message?: string, type: ToastMessage['type'] = 'success') => {
      const id = `toast-${Date.now()}-${Math.random()}`;
      setToasts((prev) => [...prev, { id, title, message, type }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
    },
    [],
  );
  const removeToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  // ===== تحميل البيانات =====
  const reloadFiles = useCallback(async () => {
    try {
      const [all, trash] = await Promise.all([api.files.list({ view: 'all' }), api.files.list({ view: 'trash' })]);
      setFiles(all.files.map((f) => api.toFileItem(f, username)));
      setTrashItems(trash.files.map((f) => api.toFileItem(f, username)));
      const usedTB = all.usage.usedBytes / 1e12;
      setStorageUsedTB(Number(usedTB.toFixed(3)));
      setStorageTotalTB(Math.max(5, Math.ceil(usedTB * 1.25)));
    } catch {
      /* الجلسة قد تكون انتهت */
    }
  }, [username]);

  const refreshTransfers = useCallback(() => {
    const list = Array.from(jobsRef.current.values())
      .sort((a, b) => (b.id > a.id ? 1 : -1))
      .map(api.jobToTransfer);
    setTransfers(list);
  }, []);

  // فحص الجلسة عند الإقلاع
  useEffect(() => {
    (async () => {
      try {
        const s = await api.auth.session();
        if (s.user) {
          setUsername(s.user.username);
          setAuthState('in');
        } else setAuthState('out');
      } catch {
        setAuthState('out');
      }
    })();
  }, []);

  // بعد الدخول: حمّل الملفّات والمهام واشترك في SSE
  useEffect(() => {
    if (authState !== 'in') return;
    void reloadFiles();
    (async () => {
      try {
        const { jobs } = await api.downloads.jobs('active');
        for (const j of jobs) jobsRef.current.set(j.id, j);
        refreshTransfers();
      } catch {
        /* تجاهل */
      }
    })();
    const disconnect = api.connectEvents((job) => {
      const prev = jobsRef.current.get(job.id);
      jobsRef.current.set(job.id, job);
      refreshTransfers();
      if (job.status === 'done' && prev?.status !== 'done') {
        addToast('اكتمل التحميل', job.name, 'success');
        void reloadFiles();
      } else if (job.status === 'error' && prev?.status !== 'error') {
        addToast('فشل التحميل', job.error ?? job.name, 'error');
      }
    });
    return disconnect;
  }, [authState, reloadFiles, refreshTransfers, addToast]);

  // ===== إجراءات الملفّات =====
  const handleDownloadFile = (file: FileItem) => {
    const a = document.createElement('a');
    a.href = api.files.downloadUrl(file.id);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    addToast('بدأ التنزيل', file.name);
  };

  const handleCopy = (text: string, label = 'الرابط') => {
    navigator.clipboard.writeText(text);
    addToast(`نُسخ ${label}`, text);
  };

  const handleDeleteFiles = async (ids: string[]) => {
    await Promise.all(ids.map((id) => api.files.trash(id).catch(() => {})));
    addToast('نُقل إلى السلّة', `${ids.length} عنصر`, 'warning');
    await reloadFiles();
  };

  const handleRestoreItem = async (id: string) => {
    await api.files.restore(id).catch(() => {});
    addToast('استُعيد الملف');
    await reloadFiles();
  };

  const handleShredItem = async (id: string) => {
    await api.files.remove(id).catch(() => {});
    addToast('حُذف نهائيًّا');
    await reloadFiles();
  };

  const handleEmptyAllTrash = async () => {
    const res = await api.files.emptyTrash().catch(() => ({ removed: 0 }));
    addToast('أُفرغت السلّة', `${(res as { removed: number }).removed} ملف`);
    await reloadFiles();
  };

  const handleToggleStar = async (fileId: string) => {
    const file = files.find((f) => f.id === fileId);
    const next = !file?.isStarred;
    await api.files.patch(fileId, { starred: next }).catch(() => {});
    setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, isStarred: next } : f)));
    addToast(next ? 'أُضيف للمفضّلة' : 'أُزيل من المفضّلة', file?.name);
  };

  // ===== مشاركات (زخرفيّة محليًّا) =====
  const handleLinkCreated = (newLink: ExternalLink) => {
    setExternalLinks((prev) => [newLink, ...prev]);
    addToast('أُنشئت المشاركة', newLink.vanityEndpoint);
  };
  const handleRevokeLink = (id: string) => {
    setExternalLinks((prev) => prev.map((l) => (l.id === id ? { ...l, isRevoked: true } : l)));
    addToast('أُلغيت المشاركة', undefined, 'error');
  };
  const handleZeroOut = () => {
    setClientNodes((prev) => prev.map((n) => ({ ...n, isRevoked: true })));
    setExternalLinks((prev) => prev.map((l) => ({ ...l, isRevoked: true })));
    addToast('نُفّذ المسح الطارئ', undefined, 'error');
  };

  if (authState === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-outline">
        <span className="material-symbols-outlined animate-spin text-3xl">progress_activity</span>
      </div>
    );
  }
  if (authState === 'out') {
    return (
      <Login
        onSuccess={(u) => {
          setUsername(u.username);
          setAuthState('in');
        }}
      />
    );
  }

  return (
    <div className="bg-background text-on-surface min-h-screen font-sans selection:bg-primary-container selection:text-on-primary-container flex">
      <ToastContainer toasts={toasts} onDismiss={removeToast} />

      <Sidebar
        currentView={currentView}
        onNavigate={(view) => {
          setCurrentView(view);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenUpload={() => setIsUploadOpen(true)}
        onOpenUpgrade={() => setIsUpgradeOpen(true)}
        storageUsedTB={storageUsedTB}
        storageTotalTB={storageTotalTB}
      />

      <div className="pl-72 flex-1 flex flex-col min-h-screen">
        <Header
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          viewLayout={viewLayout}
          onToggleViewLayout={setViewLayout}
          onFilterClick={(type) => addToast('تصفية', type)}
        />

        <main className="relative pt-16 w-full bg-background min-h-[calc(100vh-64px)] pb-12">
          {currentView === 'overview' && (
            <OverviewView
              files={files}
              transfers={transfers}
              onOpenUpload={() => setIsUploadOpen(true)}
              onOpenCreateShare={() => {
                setShareTargetName('مشاركة جديدة');
                setIsShareDrawerOpen(true);
              }}
              onSelectFile={(f) => setSelectedFile(f)}
              onDownloadFile={handleDownloadFile}
              onCopyFileLink={(f) => handleCopy(`${location.origin}/f/${f.id}`, f.name)}
              onNavigateToAllFiles={() => setCurrentView('all-files')}
              onNavigateToTrash={() => setCurrentView('recovery-trash')}
              storageUsedTB={storageUsedTB}
              storageTotalTB={storageTotalTB}
            />
          )}

          {currentView === 'all-files' && (
            <AllFilesView
              files={files}
              selectedFile={selectedFile}
              onSelectFile={(f) => setSelectedFile(f)}
              onDeleteFiles={handleDeleteFiles}
              onDownloadFile={handleDownloadFile}
              onOpenUpload={() => setIsUploadOpen(true)}
              onOpenCreateShare={(name) => {
                setShareTargetName(name || '');
                setIsShareDrawerOpen(true);
              }}
              onCopyChecksum={(hash) => handleCopy(hash, 'البصمة SHA-256')}
              onRestoreVersion={(v) => addToast('استُعيدت النسخة', v)}
            />
          )}

          {currentView === 'shared-vaults' && (
            <SharedVaultsView
              vaults={sharedVaults}
              links={externalLinks}
              onOpenCreateShare={() => {
                setShareTargetName('مشاركة جديدة');
                setIsShareDrawerOpen(true);
              }}
              onRevokeLink={handleRevokeLink}
              onCopyLink={(url) => handleCopy(url, 'رابط المشاركة')}
              onExportAuditCsv={() => addToast('تصدير السجلّ', 'CSV')}
            />
          )}

          {currentView === 'security-access' && (
            <SecurityAuditView
              clientNodes={clientNodes}
              onRevokeNode={(nodeId) => {
                setClientNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, isRevoked: true } : n)));
                addToast('أُلغيت الجلسة', undefined, 'warning');
              }}
              onOpenDeduplication={() => setIsDeduplicationOpen(true)}
              onEmptyStaleTrash={() => void handleEmptyAllTrash()}
              onConvertTiffs={() => addToast('تحويل', 'اكتمل')}
              onRecalculateQuotas={() => addToast('أُعيد حساب الحصص')}
              onOpenZeroOutModal={() => setIsZeroOutOpen(true)}
              onExportAuditLog={() => addToast('تصدير السجلّ')}
              storageUsedTB={storageUsedTB}
              storageTotalTB={storageTotalTB}
            />
          )}

          {currentView === 'recent-starred' && (
            <RecentStarredView
              files={files}
              onSelectFile={(f) => {
                setSelectedFile(f);
                setCurrentView('all-files');
              }}
              onToggleStar={handleToggleStar}
              onDownloadFile={handleDownloadFile}
              onOpenCreateShare={(name) => {
                setShareTargetName(name || '');
                setIsShareDrawerOpen(true);
              }}
            />
          )}

          {currentView === 'recovery-trash' && (
            <TrashView
              trashItems={trashItems}
              onRestoreItem={handleRestoreItem}
              onShredItem={handleShredItem}
              onEmptyAllTrash={handleEmptyAllTrash}
            />
          )}

          {currentView === 'workspace-settings' && (
            <SettingsView onSaved={() => addToast('حُفظت الإعدادات')} />
          )}
        </main>
      </div>

      <CreateShareDrawer
        isOpen={isShareDrawerOpen}
        onClose={() => setIsShareDrawerOpen(false)}
        onCreated={handleLinkCreated}
        defaultTarget={shareTargetName}
      />

      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        folderId={null}
        onUploaded={() => void reloadFiles()}
        onToast={addToast}
      />

      <DeduplicationModal
        isOpen={isDeduplicationOpen}
        onClose={() => setIsDeduplicationOpen(false)}
        onPurged={() => addToast('اكتملت إزالة التكرار')}
      />

      <EmergencyZeroOutModal
        isOpen={isZeroOutOpen}
        onClose={() => setIsZeroOutOpen(false)}
        onWipeExecuted={handleZeroOut}
      />

      <UpgradeModal
        isOpen={isUpgradeOpen}
        onClose={() => setIsUpgradeOpen(false)}
        onUpgraded={(q) => {
          setStorageTotalTB(q);
          addToast('حُدّثت السعة', `${q} TB`);
        }}
      />

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        files={files}
        onSelectFile={(f) => {
          setSelectedFile(f);
          setCurrentView('all-files');
        }}
        onChangeView={(v) => setCurrentView(v)}
        onOpenUpload={() => setIsUploadOpen(true)}
        onOpenCreateShare={() => setIsShareDrawerOpen(true)}
      />
    </div>
  );
}
