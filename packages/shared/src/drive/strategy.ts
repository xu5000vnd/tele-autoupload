export interface DestinationInfo {
  chatId: bigint;
  chatTitle: string;
  date: Date;
}

export interface DestinationRef {
  folderId: string;
  folderPath: string;
}

export interface UploadMeta {
  fileName: string;
  mimeType?: string;
}

export interface UploadResult {
  remoteRef: string;
  webUrl?: string;
  status: 'uploaded' | 'pending_sync';
  bytesUploaded: bigint;
}

export interface UploadStrategy {
  ensureDestination(dest: DestinationInfo): Promise<DestinationRef>;
  upload(localPath: string, destRef: DestinationRef, meta: UploadMeta): Promise<UploadResult>;
  verify?(result: UploadResult): Promise<boolean>;
  cleanup?(localPath: string): Promise<void>;
}
