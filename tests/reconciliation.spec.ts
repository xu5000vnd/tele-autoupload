import { describe, expect, it } from 'vitest';
import { rewindMessageCursor } from '@shared/utils/reconciliation';

describe('reconciliation cursor', () => {
  it('rewinds by the configured lookback window', () => {
    expect(rewindMessageCursor(1000n, 200n)).toBe(800n);
  });

  it('does not rewind below zero', () => {
    expect(rewindMessageCursor(50n, 200n)).toBe(0n);
  });

  it('keeps the current cursor when lookback is disabled', () => {
    expect(rewindMessageCursor(1000n, 0n)).toBe(1000n);
  });
});
