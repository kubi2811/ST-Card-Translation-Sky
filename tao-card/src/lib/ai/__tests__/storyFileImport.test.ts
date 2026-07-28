// (bug 136) Nhập nhiều file truyện — thứ tự tự nhiên, mốc ranh giới, báo file bị bỏ.
import { describe, it, expect } from 'vitest';
import { naturalCompare, readStoryFiles, isStoryTextFile, fileMarker } from '../storyFileImport';

const mkFile = (name: string, content: string) => new File([content], name, { type: 'text/plain' });

describe('(bug 136) naturalCompare — "chương 2" phải đứng trước "chương 10"', () => {
  it('so cụm số theo GIÁ TRỊ, không theo chuỗi', () => {
    const names = ['chương 10.txt', 'chương 2.txt', 'chương 1.txt'];
    expect([...names].sort(naturalCompare)).toEqual(['chương 1.txt', 'chương 2.txt', 'chương 10.txt']);
  });
  it('tên không số so như chuỗi thường', () => {
    expect(['b.txt', 'a.txt'].sort(naturalCompare)).toEqual(['a.txt', 'b.txt']);
  });
});

describe('(bug 136) readStoryFiles', () => {
  it('nhiều file → ghép ĐÚNG thứ tự chương kèm mốc [FILE: …]; một file → giữ nguyên không mốc', async () => {
    const r = await readStoryFiles([
      mkFile('chương 10.txt', 'Nội dung hồi mười.'),
      mkFile('chương 2.txt', 'Nội dung hồi hai.'),
    ]);
    expect(r.parts.map(p => p.name)).toEqual(['chương 2.txt', 'chương 10.txt']);
    expect(r.text.indexOf('hồi hai')).toBeLessThan(r.text.indexOf('hồi mười'));
    expect(r.text).toContain(fileMarker('chương 2.txt'));

    const single = await readStoryFiles([mkFile('truyện.txt', 'Chỉ một quyển.')]);
    expect(single.text).toBe('Chỉ một quyển.');
    expect(single.text).not.toContain('[FILE:');
  });

  it('file lạ / rỗng bị BÁO chứ không nuốt im lặng; file hợp lệ vẫn vào', async () => {
    const r = await readStoryFiles([
      mkFile('truyện.txt', 'Nội dung thật.'),
      mkFile('ảnh.png', 'binary'),
      mkFile('rỗng.txt', '   '),
    ]);
    expect(r.parts).toHaveLength(1);
    expect(r.skipped.map(s => s.name).sort()).toEqual(['rỗng.txt', 'ảnh.png']);
    expect(r.skipped.find(s => s.name === 'ảnh.png')!.reason).toContain('không hỗ trợ');
  });

  it('isStoryTextFile nhận .txt/.md/.text, từ chối .png/.json', () => {
    expect(isStoryTextFile('a.txt')).toBe(true);
    expect(isStoryTextFile('a.md')).toBe(true);
    expect(isStoryTextFile('a.json')).toBe(false);
    expect(isStoryTextFile('a.png')).toBe(false);
  });

  it('BOM đầu file bị gỡ', async () => {
    const r = await readStoryFiles([mkFile('bom.txt', '﻿Nội dung sau BOM.')]);
    expect(r.text.startsWith('Nội dung')).toBe(true);
  });
});
