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
  modifiedTs: number;
  sha256: string;
  parentId?: string;
  isStarred?: boolean;
  isPinned?: boolean;
  isDeleted?: boolean;
  deletedDaysLeft?: number;
  trashedAt?: number;
  previewUrl?: string;
  technicalSpecs?: {
    resolution?: string;
    colorSpace?: string;
    framerate?: string;
    bitDepth?: string;
    encryption?: string;
  };
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
  ipAllow?: string | null;
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
