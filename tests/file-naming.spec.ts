import { describe, expect, it } from 'vitest';
import { makeDeterministicFileName, sanitizeGroupTitle } from '@shared/utils/file-naming';

describe('file naming', () => {
  it('sanitizes group title', () => {
    expect(sanitizeGroupTitle('Design / Assets: Team')).toBe('Design_Assets_Team');
  });

  it('creates deterministic file name', () => {
    const name = makeDeterministicFileName({
      date: new Date('2026-02-23T08:14:22Z'),
      messageId: 12345n,
      mediaType: 'photo',
      mediaIndex: 0,
      fileName: 'image.jpg',
    });

    expect(name).toBe('20260223_081422__msg12345__photo__0.jpg');
  });
});
