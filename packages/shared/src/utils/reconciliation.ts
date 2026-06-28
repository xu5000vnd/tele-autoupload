export function rewindMessageCursor(lastMessageId: bigint, lookbackMessages: bigint): bigint {
  if (lastMessageId <= 0n || lookbackMessages <= 0n) {
    return lastMessageId;
  }

  return lastMessageId > lookbackMessages ? lastMessageId - lookbackMessages : 0n;
}
