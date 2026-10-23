/**
 * Tdrive — جذر التطبيق. يحافظ على تصميم Vaulta ويربطه بالـ API الحقيقيّ:
 * مصادقة، ملفّات/سلّة حقيقية، رفع مجزّأ، تحميل من الروابط، وتقدّم لحظيّ عبر SSE.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ViewMode, FileItem, ExternalLink, ActiveTransfer, ClientNode } from './types';
import * as api from './api';
import { Login } from './components/Login';
import { PublicShare } from './components/PublicShare';
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
  // مسار المشاركة العامّة لا يتطلّب تسجيل دخول
  const pathname = window.location.pathname;
  if (pathname.startsWith('/s/')) {
    return <PublicShare token={decodeURIComponent(pathname.slice(3))} />;
  }

  const [authState, setAuthState] = useState<AuthState>('checking');
  const [username, setUsername] = useState('المالك');

  const [currentView, setCurrentView] = useState<ViewMode>('overview');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [trashItems, setTrashItems] = useState<FileItem[]>([]);
  const [sharedVaults, setSharedVaults] = useState<api.ApiVault[]>([]);
  const [vaultMeta, setVaultMeta] = useState<{ activeSessions: number; shares: number }>({ activeSessions: 0, shares: 0 });
  const [externalLinks, setExternalLinks] = useState<ExternalLink[]>([]);
  const [transfers, setTransfers] = useState<ActiveTransfer[]>([]);
  const [clientNodes, setClientNodes] = useState<ClientNode[]>([]);
  const [overviewStats, setOverviewStats] = useState<api.OverviewStats | null>(null);
  const [securityStats, setSecurityStats] = useState<api.SecurityStats | null>(null);
  const [activityItems, setActivityItems] = useState<api.ApiActivity[]>([]);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [shareRevision, setShareRevision] = useState(0);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<api.ApiFolder[]>([]);
  const [childFolders, setChildFolders] = useState<api.ApiFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [foldersError, setFoldersError] = useState<string | null>(null);
  const [folderRevision, setFolderRevision] = useState(0);
  const [fileSelectionRevision, setFileSelectionRevision] = useState(0);
  const folderPathsRef = useRef(new Map<string, api.ApiFolder[]>());
  const folderNavigationRef = useRef(0);
  const currentFolder = folderPath.at(-1);
  const currentFolderId = currentFolder?.id ?? null;

  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [storageUsedTB, setStorageUsedTB] = useState<number>(0);
  const [storageTotalTB, setStorageTotalTB] = useState<number>(0);
  const [viewLayout, setViewLayout] = useState<'grid' | 'list'>('grid');

  const [isShareDrawerOpen, setIsShareDrawerOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<{ fileId?: string; name?: string }>({});
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isDeduplicationOpen, setIsDeduplicationOpen] = useState(false);
  const [isZeroOutOpen, setIsZeroOutOpen] = useState(false);
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const jobsRef = useRef<Map<string, api.ApiJob>>(new Map());

  const addToast = useCallback(
    (title: string, message?: string, type: ToastMessage['type'] = 'success') => {
      const id = `toast-${crypto.randomUUID()}`;
      setToasts((prev) => [...prev, { id, title, message, type }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
    },
    [],
  );
  const removeToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const handleSetViewLayout = useCallback((mode: 'grid' | 'list') => {
    const previous = viewLayout;
    setViewLayout(mode);
    void api.settings.save({ defaultView: mode }).catch((error: unknown) => {
      setViewLayout(previous);
      addToast('تعذّر حفظ طريقة العرض', error instanceof Error ? error.message : undefined, 'error');
    });
  }, [viewLayout, addToast]);

  // ===== تحميل البيانات =====
  const reloadFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      const [all, trash] = await Promise.all([api.files.list({ view: 'all' }), api.files.list({ view: 'trash' })]);
      setFiles(all.files.map((f) => api.toFileItem(f, overviewStats?.retentionDays)));
      setTrashItems(trash.files.map((f) => api.toFileItem(f, overviewStats?.retentionDays)));
      const usedTB = all.usage.usedBytes / 1e12;
      setStorageUsedTB(Number(usedTB.toFixed(3)));
      setFilesError(null);
      setDashboardError(null);
    } catch (error) {
      setFilesError(error instanceof Error ? error.message : 'تعذّر تحميل الملفات.');
      throw error;
    } finally {
      setFilesLoading(false);
    }
  }, [overviewStats?.retentionDays]);

  const reloadWorkspace = useCallback(async () => {
    try {
      const [overview, security, vaultResult, activityResult, shareResult, sessionResult] = await Promise.all([
        api.stats.overview(),
        api.stats.security(),
        api.vaults.list(),
        api.activity.list({ limit: 20 }),
        api.shares.list(),
        api.sessions.list(),
      ]);
      setOverviewStats(overview);
      setSecurityStats(security);
      setSharedVaults(vaultResult.vaults);
      setVaultMeta(vaultResult.meta);
      setActivityItems(activityResult.items);
      setExternalLinks(shareResult.links);
      setClientNodes(sessionResult.nodes);
      setStorageUsedTB(Number((overview.usedBytes / 1e12).toFixed(3)));
      setStorageTotalTB(overview.quotaBytes / 1e12);
      setViewLayout(overview.defaultView);
      setDashboardError(null);
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : 'تعذّر تحميل بيانات مساحة العمل.');
      addToast('تعذّر تحميل البيانات', error instanceof Error ? error.message : undefined, 'error');
    }
  }, [addToast]);

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

  useEffect(() => {
    const expireSession = () => setAuthState('out');
    window.addEventListener('tdrive:unauthorized', expireSession);
    return () => window.removeEventListener('tdrive:unauthorized', expireSession);
  }, []);

  useEffect(() => {
    if (authState !== 'in') return;
    let active = true;
    setFoldersLoading(true);
    setFoldersError(null);
    setChildFolders([]);
    api.folders.list(currentFolderId)
      .then(({ folders }) => {
        if (!active) return;
        setChildFolders(folders);
        for (const folder of folders) folderPathsRef.current.set(folder.id, [...folderPath, folder]);
      })
      .catch((error: unknown) => {
        if (active) setFoldersError(error instanceof Error ? error.message : 'Unable to load folders.');
      })
      .finally(() => { if (active) setFoldersLoading(false); });
    return () => { active = false; };
  }, [authState, folderPath, currentFolderId, folderRevision]);

  // بعد الدخول: حمّل الملفّات والمهام واشترك في SSE
  useEffect(() => {
    if (authState !== 'in') return;
    void reloadFiles().catch(() => {});
    void reloadWorkspace();
    (async () => {
      try {
        const { jobs } = await api.downloads.jobs('active');
        for (const j of jobs) jobsRef.current.set(j.id, j);
        refreshTransfers();
      } catch {
        addToast('تعذّر تحميل التحويلات', 'أعد تحميل الصفحة للمحاولة مجددًا.', 'error');
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
  }, [authState, reloadFiles, reloadWorkspace, refreshTransfers, addToast]);

  const navigateFolder = (path: api.ApiFolder[]) => {
    folderNavigationRef.current++;
    setFolderPath(path);
    setSelectedFile(null);
    setCurrentView('all-files');
  };

  const handleCreateFolder = async (name: string) => {
    const { folder } = await api.folders.create(name, currentFolderId);
    folderPathsRef.current.set(folder.id, [...folderPath, folder]);
    setFolderRevision((revision) => revision + 1);
    addToast('Folder created', folder.name);
  };

  const openFileLocation = async (file: FileItem) => {
    const navigation = ++folderNavigationRef.current;
    try {
      let path = file.parentId ? folderPathsRef.current.get(file.parentId) : [];
      if (!path) {
        // The folders API lists children only; resolve uncached ancestors from the root.
        const queue: api.ApiFolder[][] = [[]];
        const visited = new Set<string>();
        while (queue.length && !path) {
          const parentPath = queue.shift()!;
          const { folders } = await api.folders.list(parentPath.at(-1)?.id ?? null);
          if (navigation !== folderNavigationRef.current) return;
          for (const folder of folders) {
            if (visited.has(folder.id)) continue;
            visited.add(folder.id);
            const nextPath = [...parentPath, folder];
            folderPathsRef.current.set(folder.id, nextPath);
            if (folder.id === file.parentId) path = nextPath;
            queue.push(nextPath);
          }
        }
        if (!path) throw new Error('The containing folder could not be found. Refresh files and try again.');
      }
      if (navigation !== folderNavigationRef.current) return;
      setFolderPath(path);
      setSelectedFile(file);
      setFileSelectionRevision((revision) => revision + 1);
      setCurrentView('all-files');
    } catch (error) {
      if (navigation === folderNavigationRef.current) addToast('Unable to open file location', error instanceof Error ? error.message : undefined, 'error');
    }
  };

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

  const handleCopy = async (text: string, label = 'الرابط') => {
    try {
      await navigator.clipboard.writeText(text);
      addToast(`نُسخ ${label}`, text);
    } catch (error) {
      addToast('تعذّر النسخ', error instanceof Error ? error.message : 'تحقّق من أذونات الحافظة.', 'error');
    }
  };

  const handleDeleteFiles = async (ids: string[]) => {
    if (!ids.length || !window.confirm(`Move ${ids.length} selected item${ids.length === 1 ? '' : 's'} to Trash?`)) return;
    try {
      await Promise.all(ids.map((id) => api.files.trash(id)));
      addToast('نُقل إلى السلّة', `${ids.length} عنصر`, 'warning');
      await Promise.all([reloadFiles(), reloadWorkspace()]);
    } catch (error) {
      addToast('تعذّر حذف الملفّات', error instanceof Error ? error.message : undefined, 'error');
    }
  };

  const handleRestoreItem = async (id: string) => {
    try {
      await api.files.restore(id);
      addToast('استُعيد الملف');
      await Promise.all([reloadFiles(), reloadWorkspace()]);
    } catch (error) {
      addToast('تعذّرت الاستعادة', error instanceof Error ? error.message : undefined, 'error');
    }
  };

  const handleShredItem = async (id: string) => {
    if (!window.confirm('سيُحذف الملف نهائيًا ولا يمكن استعادته. هل تريد المتابعة؟')) return;
    try {
      await api.files.remove(id);
      addToast('حُذف نهائيًّا');
      await Promise.all([reloadFiles(), reloadWorkspace()]);
    } catch (error) {
      addToast('تعذّر الحذف النهائي', error instanceof Error ? error.message : undefined, 'error');
    }
  };

  const handleEmptyAllTrash = async () => {
    if (!window.confirm('سيُحذف كل ما في سلّة المهملات نهائيًا. هل تريد المتابعة؟')) return;
    try {
      const res = await api.files.emptyTrash();
      addToast('أُفرغت السلّة', `${res.removed} ملف`);
      await Promise.all([reloadFiles(), reloadWorkspace()]);
    } catch (error) {
      addToast('تعذّر إفراغ السلّة', error instanceof Error ? error.message : undefined, 'error');
    }
  };

  const handlePurgeExpiredTrash = async () => {
    try {
      const res = await api.files.purgeExpiredTrash();
      addToast('اكتمل حذف العناصر المنتهية', `${res.removed} ملف · ${api.formatSize(res.freedBytes)}`);
      await Promise.all([reloadFiles(), reloadWorkspace()]);
    } catch (error) {
      addToast('تعذّر حذف العناصر المنتهية', error instanceof Error ? error.message : undefined, 'error');
    }
  };

  const handleToggleStar = async (fileId: string) => {
    const file = files.find((f) => f.id === fileId);
    const next = !file?.isStarred;
    try {
      await api.files.patch(fileId, { starred: next });
      setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, isStarred: next } : f)));
      addToast(next ? 'أُضيف للمفضّلة' : 'أُزيل من المفضّلة', file?.name);
    } catch (error) {
      addToast('تعذّر تحديث المفضّلة', error instanceof Error ? error.message : undefined, 'error');
    }
  };

  // ===== المشاركات (حقيقية عبر الـ API) =====
  const openShare = (target?: { fileId?: string; name?: string }) => {
    setShareTarget(target ?? {});
    setIsShareDrawerOpen(true);
  };
  const handleLinkCreated = (newLink: ExternalLink) => {
    setExternalLinks((prev) => [newLink, ...prev]);
    setShareRevision((revision) => revision + 1);
    addToast('أُنشئت المشاركة', newLink.vanityEndpoint);
    void reloadWorkspace();
  };
  const handleRevokeLink = async (id: string) => {
    if (!window.confirm('إلغاء هذا الرابط سيمنع الوصول إليه. هل تريد المتابعة؟')) return;
    try {
      await api.shares.revoke(id);
      setExternalLinks((prev) => prev.map((l) => (l.id === id ? { ...l, isRevoked: true } : l)));
      addToast('أُلغيت المشاركة', undefined, 'warning');
      await reloadWorkspace();
    } catch (error) {
      addToast('تعذّر إلغاء المشاركة', error instanceof Error ? error.message : undefined, 'error');
    }
  };
  const handleZeroOut = async () => {
    try {
      const result = await api.security.wipePeers();
      addToast('أُلغيت الجلسات والمشاركات', `${result.revokedSessions} جلسة · ${result.revokedShares} مشاركة`, 'warning');
      await reloadWorkspace();
    } catch (error) {
      addToast('فشل المسح الطارئ', error instanceof Error ? error.message : undefined, 'error');
      throw error;
    }
  };

  const handleCancelTransfer = async (id: string) => {
    try {
      await api.downloads.cancel(id);
      const { jobs } = await api.downloads.jobs('active');
      jobsRef.current = new Map(jobs.map((job) => [job.id, job]));
      refreshTransfers();
    } catch (error) {
      addToast('تعذّر إلغاء التحويل', error instanceof Error ? error.message : undefined, 'error');
    }
  };

  const handleExportActivity = (fileId?: string) => {
    const link = document.createElement('a');
    link.href = api.activity.exportUrl(fileId);
    link.download = 'tdrive-activity.csv';
    document.body.append(link);
    link.click();
    link.remove();
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
        username={username}
        onNavigate={(view) => {
          setCurrentView(view);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenUpload={() => setIsUploadOpen(true)}
        onOpenUpgrade={() => setIsUpgradeOpen(true)}
        storageUsedTB={storageUsedTB}
        storageTotalTB={storageTotalTB}
      />

      <div className="md:pl-72 min-w-0 flex-1 flex flex-col min-h-screen">
        <Header
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          viewLayout={viewLayout}
          onToggleViewLayout={handleSetViewLayout}
          username={username}
          notifications={activityItems}
          onFilterClick={(type) => {
            if (type === 'Type') setCurrentView('all-files');
            else if (type === 'Shares') setCurrentView('shared-vaults');
            else setCurrentView('recent-starred');
          }}
        />

        <main className="relative pt-16 w-full bg-background min-h-[calc(100vh-64px)] pb-12">
          {currentView === 'overview' && (
            <OverviewView
              transfers={transfers}
              stats={overviewStats}
              loadError={dashboardError}
              onRetry={() => void reloadWorkspace()}
              onOpenUpload={() => setIsUploadOpen(true)}
              onOpenCreateShare={() => openShare()}
              onSelectFile={(f) => void openFileLocation(f)}
              onDownloadFile={handleDownloadFile}
              onNavigateToAllFiles={() => setCurrentView('all-files')}
              onNavigateToTrash={() => setCurrentView('recovery-trash')}
              onCancelTransfer={handleCancelTransfer}
            />
          )}

          {currentView === 'all-files' && (
            <AllFilesView
              key={`${currentFolderId ?? 'root'}:${fileSelectionRevision}`}
              files={files.filter((file) => (file.parentId ?? null) === currentFolderId)}
              folders={childFolders}
              folderPath={folderPath}
              foldersLoading={foldersLoading}
              foldersError={foldersError}
              onNavigateFolder={navigateFolder}
              onCreateFolder={handleCreateFolder}
              onRetryFolders={() => setFolderRevision((revision) => revision + 1)}
              viewLayout={viewLayout}
              shareRevision={shareRevision}
              isLoading={filesLoading}
              loadError={filesError}
              onRetry={() => { void reloadFiles().catch(() => {}); }}
              selectedFile={selectedFile}
              onSelectFile={(f) => setSelectedFile(f)}
              onDeleteFiles={handleDeleteFiles}
              onDownloadFile={handleDownloadFile}
              onOpenUpload={() => setIsUploadOpen(true)}
              onOpenCreateShare={(t) => openShare(t)}
              onCopyChecksum={(hash) => handleCopy(hash, 'البصمة SHA-256')}
              onExportAuditLogs={() => handleExportActivity(selectedFile?.id)}
            />
          )}

          {currentView === 'shared-vaults' && (
            <SharedVaultsView
              vaults={sharedVaults}
              links={externalLinks}
              activityItems={activityItems}
              meta={vaultMeta}
              onOpenCreateShare={() => openShare()}
              onRevokeLink={handleRevokeLink}
              onCopyLink={(url) => handleCopy(url, 'رابط المشاركة')}
              onExportAuditCsv={() => handleExportActivity()}
              onRetry={() => void reloadWorkspace()}
            />
          )}

          {currentView === 'security-access' && (
            <SecurityAuditView
              clientNodes={clientNodes}
              stats={securityStats}
              loadError={dashboardError}
              onRetry={() => void reloadWorkspace()}
              onRevokeNode={async (nodeId) => {
                try {
                  await api.sessions.revoke(nodeId);
                  setClientNodes((prev) => prev.filter((n) => n.id !== nodeId));
                  addToast('أُلغيت الجلسة', undefined, 'warning');
                } catch (error) {
                  addToast('تعذّر إلغاء الجلسة', error instanceof Error ? error.message : undefined, 'error');
                }
              }}
              onOpenDeduplication={() => setIsDeduplicationOpen(true)}
              onEmptyStaleTrash={handlePurgeExpiredTrash}
              onRecalculateQuotas={async () => {
                try {
                  setSecurityStats(await api.stats.security());
                } catch (error) {
                  addToast('تعذّر تحديث التحليلات', error instanceof Error ? error.message : undefined, 'error');
                }
              }}
              onOpenZeroOutModal={() => setIsZeroOutOpen(true)}
              onExportAuditLog={() => handleExportActivity()}
            />
          )}

          {currentView === 'recent-starred' && (
            <RecentStarredView
              files={files}
              onSelectFile={(f) => void openFileLocation(f)}
              onToggleStar={handleToggleStar}
              onDownloadFile={handleDownloadFile}
              onOpenCreateShare={(t) => openShare(t)}
              isLoading={filesLoading}
              loadError={filesError}
              onRetry={() => { void reloadFiles().catch(() => {}); }}
            />
          )}

          {currentView === 'recovery-trash' && (
            <TrashView
              trashItems={trashItems}
              isLoading={filesLoading}
              loadError={filesError}
              onRetry={() => { void reloadFiles().catch(() => {}); }}
              onRestoreItem={handleRestoreItem}
              onShredItem={handleShredItem}
              onEmptyAllTrash={handleEmptyAllTrash}
              retentionDays={overviewStats?.retentionDays ?? 30}
            />
          )}

          {currentView === 'workspace-settings' && (
            <SettingsView onSaved={() => { addToast('حُفظت الإعدادات'); void reloadWorkspace(); }} />
          )}
        </main>
      </div>

      <CreateShareDrawer
        isOpen={isShareDrawerOpen}
        onClose={() => setIsShareDrawerOpen(false)}
        onCreated={handleLinkCreated}
        target={shareTarget}
      />

      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        folderId={currentFolderId}
        folderName={currentFolder?.path ?? '/'}
        onUploaded={() => { void reloadFiles().catch(() => {}); void reloadWorkspace(); }}
        onToast={addToast}
      />

      <DeduplicationModal
        isOpen={isDeduplicationOpen}
        onClose={() => setIsDeduplicationOpen(false)}
        onPurged={() => { addToast('اكتملت إزالة التكرار'); void Promise.all([reloadFiles(), reloadWorkspace()]); }}
      />

      <EmergencyZeroOutModal
        isOpen={isZeroOutOpen}
        onClose={() => setIsZeroOutOpen(false)}
        onWipeExecuted={handleZeroOut}
      />

      <UpgradeModal
        isOpen={isUpgradeOpen}
        onClose={() => setIsUpgradeOpen(false)}
        currentQuotaTB={storageTotalTB}
        usedBytes={overviewStats?.usedBytes ?? storageUsedTB * 1e12}
        onUpgraded={(q) => {
          setStorageTotalTB(q);
          addToast('حُدّثت السعة', `${q} TB`);
        }}
      />

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        files={files}
        onSelectFile={(f) => void openFileLocation(f)}
        onChangeView={(v) => setCurrentView(v)}
        onOpenUpload={() => setIsUploadOpen(true)}
        onOpenCreateShare={() => openShare()}
      />
    </div>
  );
}
