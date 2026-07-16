import { describe, it, expect } from 'vitest';
import { resolveLocale, UI_LANGS, loadI18n, getT, getUi, type UiLang } from '../index';
import en from '../locales/en';
import vi from '../locales/vi';
import zh from '../locales/zh';
import uiEn from '../ui/en';
import uiVi from '../ui/vi';
import uiZh from '../ui/zh';

const placeholders = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) || []).sort();

describe('i18n — mỗi ngôn ngữ dùng đúng bộ chuỗi của mình', () => {
  // (User 2026-07) TRƯỚC ĐÂY map vi→en cố ý (giữ bộ mặt tiếng Anh cho user cũ). User phản ánh
  // "chọn tiếng Việt mà giao diện còn nhiều chỗ tiếng Anh" → đổi để VI dùng locales/vi.ts.
  it("resolveLocale trả ĐÚNG ngôn ngữ đang chọn (vi→vi, en→en, zh→zh)", () => {
    expect(resolveLocale('vi')).toBe('vi');
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('zh')).toBe('zh');
  });
  it('nút đổi ngôn ngữ có đúng 3 lựa chọn, mặc định vi đứng đầu', () => {
    expect(UI_LANGS.map((l) => l.id)).toEqual<UiLang[]>(['vi', 'en', 'zh']);
  });
});

describe('i18n — boot thật: loadI18n() rồi getT()/getUi()', () => {
  // Chạy đúng chuỗi khởi động của main.tsx: dynamic import phải resolve được, nếu không app
  // sẽ TRẮNG MÀN HÌNH. Test này chặn kiểu hỏng đó.
  it("uiLang 'vi' → nạp bộ locales TIẾNG VIỆT + ui tiếng Việt", async () => {
    await loadI18n('vi');
    expect(getT().apiConfiguration).toBe(vi.apiConfiguration); // dùng đúng vi.ts, không phải en
    expect(getT().characterCard).toBe(vi.characterCard);
    expect(getUi().toolbarReload).toBe('Tải lại');
    expect(getUi().railTranslate).toBe('Dịch Card');
  });

  it("uiLang 'zh' → nạp bộ tiếng Trung ở cả 2 từ điển", async () => {
    await loadI18n('zh');
    expect(getT().apiConfiguration).toBe('API 配置');
    expect(getUi().toolbarReload).toBe('重新载入');
  });

  it("uiLang 'en' → nạp bộ locales tiếng Anh + ui tiếng Anh", async () => {
    await loadI18n('en');
    expect(getT().apiConfiguration).toBe('API Configuration');
    expect(getUi().toolbarReload).toBe('Reload');
  });
});

describe('i18n — key parity (không bao giờ render undefined)', () => {
  const keys = (o: object) => Object.keys(o).sort();

  it('locales: en / vi / zh cùng tập key', () => {
    expect(keys(vi)).toEqual(keys(en));
    expect(keys(zh)).toEqual(keys(en));
  });
  it('ui: en / vi / zh cùng tập key', () => {
    expect(keys(uiVi)).toEqual(keys(uiEn));
    expect(keys(uiZh)).toEqual(keys(uiEn));
  });

  it('không bộ nào có value rỗng', () => {
    for (const [name, dict] of Object.entries({ en, vi, zh, uiEn, uiVi, uiZh })) {
      for (const [k, v] of Object.entries(dict as Record<string, string>)) {
        expect(typeof v, `${name}.${k}`).toBe('string');
        expect(v.trim().length, `${name}.${k} bị rỗng`).toBeGreaterThan(0);
      }
    }
  });
});

describe('i18n — placeholder {count} {name}… phải khớp giữa các ngôn ngữ', () => {
  it('zh giữ đúng placeholder như en', () => {
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(zh[k]), `zh.${String(k)}`).toEqual(placeholders(en[k]));
    }
  });
  it('ui zh + vi giữ đúng placeholder như ui en', () => {
    for (const k of Object.keys(uiEn) as (keyof typeof uiEn)[]) {
      expect(placeholders(uiZh[k]), `uiZh.${String(k)}`).toEqual(placeholders(uiEn[k]));
      expect(placeholders(uiVi[k]), `uiVi.${String(k)}`).toEqual(placeholders(uiEn[k]));
    }
  });
});
