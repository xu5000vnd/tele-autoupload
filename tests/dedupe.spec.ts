import { describe, expect, it } from 'vitest';
import { dedupeKey } from '@shared/utils/dedupe';

describe('dedupe key', () => {
  it('prefers tg file unique id', () => {
    expect(dedupeKey({ chatId: 1n, messageId: 2n, tgFileUniqueId: 'abc', mediaIndex: 0 })).toBe('1:2:abc');
  });

  it('falls back to media index', () => {
    expect(dedupeKey({ chatId: 1n, messageId: 2n, mediaIndex: 3 })).toBe('1:2:idx:3');
  });
});
