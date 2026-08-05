/**
 * (bug 217) "Import avatar vào app Tạo card, xong export ra lại thì ảnh hoặc file JSON dung lượng
 * lên tới ~30-40MB."
 *
 * File mẫu user gửi (`bug/217/New_Character_v3.json`) nói hết: file 3.35 MB thì riêng field
 * `avatar` đã 3.35 MB — tức 100% dung lượng là base64 của tấm ảnh.
 *
 * Hai nguồn phình:
 *   1. Ảnh vào nguyên xi, không thu nhỏ, lại nở thêm 33% vì base64.
 *   2. NẶNG HƠN NHIỀU — vòng lồng nhau: đường import PNG đọc TOÀN BỘ file (`readAsDataURL`), mà
 *      file đó chứa sẵn hai chunk `ccv3`/`chara` mang base64 ảnh của vòng trước. Export lại ghi
 *      base64 mới ấy vào HAI chunk, mỗi chunk lại base64 thêm một tầng (4/3) ⇒ ~3.56 lần mỗi vòng.
 *      Ba vòng là từ 0.4 MB lên ~39 MB, khớp con số user báo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exportCardV3, exportCardV2Compat } from '../lorebookConvert';
import { dataUrlBytes, fitWithin, AVATAR_MAX_EDGE } from '../avatarImage';
import { createEmptyCard } from '../cardDefaults';

/* ═══════ Bằng chứng từ chính file user gửi ═══════ */

const SAMPLE = fileURLToPath(new URL('../../../../bug/217/New_Character_v3.json', import.meta.url));

describe.skipIf(!existsSync(SAMPLE))('file mẫu user gửi ở bug/217', () => {
  it('xác nhận: avatar chiếm gần như toàn bộ dung lượng file', () => {
    const raw = readFileSync(SAMPLE, 'utf-8');
    const json = JSON.parse(raw) as { avatar?: string };
    expect(typeof json.avatar).toBe('string');
    expect(json.avatar!.startsWith('data:image/')).toBe(true);
    // avatar chiếm > 95% file
    expect(json.avatar!.length / raw.length).toBeGreaterThan(0.95);
  });

  it('và sau bản vá, xuất lại chính thẻ đó thì nhẹ đi hai bậc', () => {
    const json = JSON.parse(readFileSync(SAMPLE, 'utf-8')) as Record<string, unknown>;
    const card = { ...createEmptyCard(), ...json } as never;
    const out = exportCardV3(card);
    expect(out.length).toBeLessThan(readFileSync(SAMPLE, 'utf-8').length / 10);
    expect(out).not.toContain('data:image/');
  });
});

/* ═══════ Gỡ base64 khỏi JSON nhúng ═══════ */

describe('exportCardV3 / exportCardV2Compat — không nhúng base64 ảnh', () => {
  const withAvatar = () => {
    const c = createEmptyCard();
    (c as unknown as { avatar: string }).avatar = 'data:image/png;base64,' + 'A'.repeat(400_000);
    c.data.name = 'Test';
    return c;
  };

  it('V3: base64 bị gỡ, thay bằng "none"', () => {
    const out = exportCardV3(withAvatar());
    expect(out).not.toContain('data:image/png;base64');
    expect(JSON.parse(out).avatar).toBe('none');
  });

  it('V2 (chunk `chara` của PNG): cũng bị gỡ', () => {
    const out = exportCardV2Compat(withAvatar());
    expect(out).not.toContain('data:image/png;base64');
    expect(JSON.parse(out).avatar).toBe('none');
  });

  it('ĐỘ LỚN: JSON xuất ra không còn cõng tấm ảnh', () => {
    const card = withAvatar();
    const out = exportCardV3(card);
    // avatar 400KB base64 — bản xuất phải nhỏ hơn nhiều lần
    expect(out.length).toBeLessThan(50_000);
  });

  it('avatar là TÊN FILE (đúng đặc tả) thì giữ nguyên, không đụng', () => {
    const c = createEmptyCard();
    (c as unknown as { avatar: string }).avatar = 'my-char.png';
    expect(JSON.parse(exportCardV3(c)).avatar).toBe('my-char.png');
  });

  it('avatar mặc định "none" vẫn là "none"', () => {
    expect(JSON.parse(exportCardV3(createEmptyCard())).avatar).toBe('none');
  });
});

/* ═══════ Thu nhỏ ảnh ═══════ */

describe('fitWithin — thu ảnh về kích thước hiển thị thật', () => {
  it('ảnh 4K co về đúng cạnh dài tối đa, giữ tỉ lệ', () => {
    const r = fitWithin(3840, 2160);
    expect(Math.max(r.w, r.h)).toBe(AVATAR_MAX_EDGE);
    expect(r.resized).toBe(true);
    expect(Math.abs(r.w / r.h - 3840 / 2160)).toBeLessThan(0.01);
  });

  it('ảnh dọc (avatar thẻ nhân vật hay gặp) cũng đúng', () => {
    const r = fitWithin(1200, 1800);
    expect(r.h).toBe(AVATAR_MAX_EDGE);
    expect(r.w).toBe(683);
  });

  it('ảnh đã nhỏ thì GIỮ NGUYÊN, không phóng to', () => {
    const r = fitWithin(400, 600);
    expect(r).toEqual({ w: 400, h: 600, resized: false });
  });

  it('kích thước 0 không làm vỡ phép tính', () => {
    expect(() => fitWithin(0, 0)).not.toThrow();
    expect(fitWithin(0, 0).resized).toBe(false);
  });
});

describe('dataUrlBytes — đo đúng số byte thật', () => {
  it('bỏ phần tiền tố và phần đệm =', () => {
    // "hello" → aGVsbG8= (8 ký tự base64, 1 dấu đệm) = 5 byte
    expect(dataUrlBytes('data:image/png;base64,aGVsbG8=')).toBe(5);
  });
  it('chuỗi không phải data URL cũng không nổ', () => {
    expect(() => dataUrlBytes('abc')).not.toThrow();
  });
});

/* ═══════ Nối dây: cắt đứt vòng lồng nhau ═══════ */

describe('nối dây — không còn đường nào đọc cả metadata làm avatar', () => {
  const topBar = readFileSync(new URL('../../../components/layout/TopBar.tsx', import.meta.url), 'utf-8');
  const editor = readFileSync(new URL('../../../pages/CardEditorPage.tsx', import.meta.url), 'utf-8');

  it('import PNG KHÔNG còn readAsDataURL(file) — đó chính là chỗ sinh ra vòng lồng nhau', () => {
    // Soi CODE thôi — comment của chính bản vá có nhắc tên hàm cũ để giải thích vì sao bỏ nó.
    const block = topBar
      .slice(topBar.indexOf("endsWith('.png')"), topBar.indexOf('const result = importCard'))
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    expect(block).not.toMatch(/readAsDataURL\(file\)/);
    expect(block).toMatch(/normalizeAvatarFile\(file\)/);
  });

  it('chọn ảnh trong Card Editor đi qua bộ chuẩn hoá', () => {
    expect(editor).toMatch(/normalizeAvatarFile\(file\)/);
  });

  it('vẫn có đường lui khi ảnh định dạng lạ (không mất chức năng)', () => {
    const at = editor.indexOf('normalizeAvatarFile', editor.indexOf('input.onchange'));   // bỏ qua dòng import
    const block = editor.slice(at, at + 900);
    expect(block).toMatch(/catch/);
    expect(block).toMatch(/readAsDataURL/);
  });
});
