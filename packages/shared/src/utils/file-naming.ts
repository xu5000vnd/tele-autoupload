import * as path from 'node:path';

export function sanitizeGroupTitle(input: string): string {
  return input
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
}

function resolveExt(fileName?: string, mimeType?: string, mediaType?: string): string {
  if (fileName && path.extname(fileName)) {
    return path.extname(fileName).replace('.', '');
  }

  if (mimeType) {
    if (mimeType.includes('jpeg')) return 'jpg';
    if (mimeType.includes('png')) return 'png';
    if (mimeType.includes('gif')) return 'gif';
    if (mimeType.includes('webp')) return 'webp';
    if (mimeType.includes('mp4')) return 'mp4';
    if (mimeType.includes('mov')) return 'mov';
    if (mimeType.includes('avi')) return 'avi';
    if (mimeType.includes('pdf')) return 'pdf';
    if (mimeType.includes('zip')) return 'zip';
  }

  if (mediaType === 'photo') return 'jpg';
  if (mediaType === 'video') return 'mp4';

  return 'bin';
}

export function makeDeterministicFileName(input: {
  date: Date;
  messageId: bigint;
  mediaType: 'photo' | 'video' | 'document';
  mediaIndex: number;
  fileName?: string;
  mimeType?: string;
}): string {
  const yyyy = String(input.date.getUTCFullYear());
  const mm = String(input.date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(input.date.getUTCDate()).padStart(2, '0');
  const hh = String(input.date.getUTCHours()).padStart(2, '0');
  const mi = String(input.date.getUTCMinutes()).padStart(2, '0');
  const ss = String(input.date.getUTCSeconds()).padStart(2, '0');
  const ext = resolveExt(input.fileName, input.mimeType, input.mediaType);

  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}__msg${input.messageId}__${input.mediaType}__${input.mediaIndex}.${ext}`;
}

export function dateFolderPath(date: Date): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

export function dateFolderPathDdMmYy(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

export function dateFolderPathDdMmYyBucketed(date: Date, bucketDays = 10): string {
  const safeBucketDays = Math.max(2, Math.floor(bucketDays));
  const day = date.getDate();
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();

  let anchorDay = day < safeBucketDays ? 1 : Math.floor(day / safeBucketDays) * safeBucketDays;
  if (anchorDay < 1) {
    anchorDay = 1;
  }

  // Merge tiny tail buckets into the previous bucket to reduce folder explosion.
  const tailLength = daysInMonth - anchorDay + 1;
  if (anchorDay > 1 && tailLength <= safeBucketDays / 2) {
    anchorDay = Math.max(1, anchorDay - safeBucketDays);
  }

  const dd = String(anchorDay).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}
