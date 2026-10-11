export type ViewMode = 
  | 'overview' 
  | 'all-files' 
  | 'recent-starred' 
  | 'shared-vaults' 
  | 'recovery-trash' 
  | 'security-access' 
  | 'workspace-settings';

export type FileCategory = 'video' | 'design' | 'code' | 'doc' | 'archive' | 'bin' | 'folder';

export interface FileItem {
  id: string;
  name: string;
  type: FileCategory;
  extension?: string;
  size: string;
  sizeBytes: number;
  modified: string;
  securityTier: 'AES-256 Vault' | 'Token Encrypted' | 'Zero-Knowledge' | 'Workspace Auth' | 'Hardware Key';
  tags: { label: string; color: string }[];
  collaborators: { name: string; avatar?: string; initials: string; role: string }[];
  sha256: string;
  path: string;
  parentId?: string;
  isStarred?: boolean;
  isPinned?: boolean;
  isDeleted?: boolean;
  deletedDaysLeft?: number;
  previewUrl?: string;
  technicalSpecs?: {
    resolution?: string;
    colorSpace?: string;
    framerate?: string;
    bitDepth?: string;
    encryption?: string;
  };
  versionHistory?: {
    version: string;
    label: string;
    timeAgo: string;
    isActive: boolean;
    author: string;
  }[];
  auditLog?: {
    action: string;
    user: string;
    timeAgo: string;
    ip: string;
    verified: boolean;
  }[];
}

export interface SharedVault {
  id: string;
  title: string;
  description: string;
  badge: string;
  badgeColor: string;
  filesCount: number;
  investorsCount: number;
  watermarkEnabled: boolean;
  engagementVelocity: string;
  expires: string;
  collaboratorAvatars: { src?: string; initials?: string }[];
  bandwidth?: string;
  p2pCached?: boolean;
  drmRestricted?: boolean;
  publicCdn?: boolean;
  downloadsCount?: string;
}

export interface ExternalLink {
  id: string;
  targetName: string;
  targetPath: string;
  targetType: 'folder' | 'video' | 'doc' | 'bin';
  vanityEndpoint: string;
  safeguards: { label: string; icon: string; highlight?: boolean }[];
  quotaUsed: number;
  quotaLimit: number | 'Unlimited';
  quotaUnit?: string;
  viewsCount: number;
  telemetryNote: string;
  expiry: string;
  isRevoked: boolean;
  isExpired?: boolean;
}

export interface ActiveTransfer {
  id: string;
  name: string;
  progress: number;
  speed: string;
  currentSize: string;
  totalSize: string;
  status: 'complete' | 'uploading' | 'queued' | 'paused';
  hashVerified?: string;
}

export interface ClientNode {
  id: string;
  name: string;
  location: string;
  ip: string;
  enclaveId: string;
  activeStatus: string;
  isCurrent?: boolean;
  isRevoked: boolean;
  deviceType: 'laptop' | 'desktop' | 'tablet';
}
