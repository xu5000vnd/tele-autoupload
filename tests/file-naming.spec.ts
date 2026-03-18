import { describe, expect, it } from 'vitest';
import { dateFolderPathDdMmYyBucketed, makeDeterministicFileName, sanitizeGroupTitle } from '@shared/utils/file-naming';

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

  it('groups into 10-day bucket folders', () => {
    expect(dateFolderPathDdMmYyBucketed(new Date('2026-01-01T10:00:00+07:00'), 10)).toBe('01.01.26');
    expect(dateFolderPathDdMmYyBucketed(new Date('2026-01-05T10:00:00+07:00'), 10)).toBe('01.01.26');
    expect(dateFolderPathDdMmYyBucketed(new Date('2026-01-12T10:00:00+07:00'), 10)).toBe('10.01.26');
    expect(dateFolderPathDdMmYyBucketed(new Date('2026-01-17T10:00:00+07:00'), 10)).toBe('10.01.26');
    expect(dateFolderPathDdMmYyBucketed(new Date('2026-01-25T10:00:00+07:00'), 10)).toBe('20.01.26');
    expect(dateFolderPathDdMmYyBucketed(new Date('2026-01-30T10:00:00+07:00'), 10)).toBe('20.01.26');
  });

  it('supports configurable bucket days', () => {
    expect(dateFolderPathDdMmYyBucketed(new Date('2026-01-11T10:00:00+07:00'), 5)).toBe('10.01.26');
    expect(dateFolderPathDdMmYyBucketed(new Date('2026-01-31T10:00:00+07:00'), 7)).toBe('28.01.26');
  });
});
