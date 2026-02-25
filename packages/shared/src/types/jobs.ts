export interface UploadJobPayload {
  mediaItemId: string;
  localPath: string;
  chatId: string;
  messageId: string;
  mediaType: 'photo' | 'video' | 'document';
  sizeBytes: string;
}
