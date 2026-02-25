export interface IncomingMedia {
  type: 'photo' | 'video' | 'document';
  fileId: string;
  uniqueId?: string;
  fileName?: string;
  mimeType?: string;
  size?: bigint;
  mediaIndex: number;
}

export interface IncomingMessage {
  chatId: bigint;
  chatTitle: string;
  chatType: 'group' | 'supergroup' | 'channel';
  messageId: bigint;
  groupedId?: bigint;
  senderId?: bigint;
  senderUsername?: string;
  date: Date;
  media: IncomingMedia[];
}

export type MessageHandler = (msg: IncomingMessage) => Promise<void>;
