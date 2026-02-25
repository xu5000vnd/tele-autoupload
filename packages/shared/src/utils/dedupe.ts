export function dedupeKey(input: {
  chatId: bigint;
  messageId: bigint;
  tgFileUniqueId?: string;
  mediaIndex: number;
}): string {
  const base = `${input.chatId}:${input.messageId}`;
  if (input.tgFileUniqueId) {
    return `${base}:${input.tgFileUniqueId}`;
  }
  return `${base}:idx:${input.mediaIndex}`;
}
