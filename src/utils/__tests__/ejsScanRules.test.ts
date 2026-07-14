import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  isValidEjsKeywordKey,
  extractEjsKeywords,
  canonicalizeEjsValue,
  enforceEjsDictConsistency,
} from '../ejsSync';
import { canonicalizeMvuVarName } from '../mvuSync';
import { ejsMarkersIntact, hasEjsMarkers } from '../apiClient';
import type { CharacterCard } from '../../types/card';

/**
 * (User 2026) "quét keywords không theo quy luật gì luôn" — dict thật của user (card Mafia Huyết Sắc,
 * bugNeedFix/6/ejs-sync-dict.json): 78/309 "keyword" là NGUYÊN ĐOẠN VĂN 90+ ký tự (value mô tả của
 * object cửa hàng), mảnh code template literal, identifier ASCII bị dịch (sfw_keywords→từ_khóa_sfw),
 * 2 key khác nhau cùng 1 bản dịch (父女/父子 → "Cha con"). Bộ test này khoá QUY LUẬT keyword.
 */

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/ejs-sync-dict.mafia.json', import.meta.url)), 'utf-8'),
) as { ejsEntryNameDict: Record<string, string>; ejsKeywordDict: Record<string, string> };

describe('isValidEjsKeywordKey — quy luật keyword (mẫu RÁC lấy từ dict thật của user)', () => {
  it('keyword hợp lệ: chuỗi ngắn kiểu định danh dùng trong logic', () => {
    for (const k of ['双胞胎', '夫妻', '军粮', '稳定', '姑嫂', 'Hệ thống chỉ điểm', 'kinh nguyệt']) {
      expect(isValidEjsKeywordKey(k), k).toBe(true);
    }
  });

  it('VĂN XUÔI (dài >32 / có dấu câu 。！？；，) → loại', () => {
    const prose = '缅甸货，空心银铃铛，里头灌了水银。给你家姑娘塞进去，走一步它就在里头滚一圈';
    expect(isValidEjsKeywordKey(prose)).toBe(false);
    expect(isValidEjsKeywordKey('主角义妹，和双胞胎妹妹栖月五年前被苏晚棠收养。性子活泼。')).toBe(false);
    expect(isValidEjsKeywordKey('ngắn nhưng, có phẩy')).toBe(false);
  });

  it('MẢNH CODE (template literal, HTML, CSS var, dấu ${}()=<>) → loại', () => {
    for (const k of [
      '${item.id === profile.id ? ',
      '}>${html(item.name)}</option>',
      'var(--map-stable,#6f8a67)',
      ',\n    ',
      'a === b',
      'x => y',
    ]) {
      expect(isValidEjsKeywordKey(k), JSON.stringify(k)).toBe(false);
    }
  });

  it('token kỹ thuật: màu #hex, số thuần, identifier ASCII (stat_data, sfw_keywords, dotted) → loại', () => {
    for (const k of ['#d4a040', '#6f8a67', '123', '3.14', 'stat_data', 'sfw_keywords', 'east_asia_1629', 'dotted']) {
      expect(isValidEjsKeywordKey(k), k).toBe(false);
    }
  });
});

describe('extractEjsKeywords — nháy bắt cặp CÙNG LOẠI, không nuốt mảnh code/văn xuôi', () => {
  const mkCard = (content: string): CharacterCard =>
    ({ spec: 'chara_card_v2', data: { name: 't', character_book: { entries: [{ content, keys: [], comment: '' }] } } }) as unknown as CharacterCard;

  it('template literal chứa ${…?…:…} không sinh keyword rác kiểu mở ` đóng \'', () => {
    const card = mkCard('<% const html = `<option ${item.id === profile.id ? \'selected\' : \'\'}>${item.name}</option>`; if (x === \'战斗\') {} %>');
    const kws = extractEjsKeywords(card).map(k => k.keyword);
    expect(kws).toContain('战斗');
    for (const k of kws) {
      expect(isValidEjsKeywordKey(k), JSON.stringify(k)).toBe(true);
      expect(k.includes('${')).toBe(false);
    }
  });

  it('object value là ĐOẠN VĂN dài → không thành keyword; key ngắn CJK vẫn bắt', () => {
    const card = mkCard("<% const shop = { '玉势': '羊脂白玉的，你摸摸。你不在家的时候它就是代你值班的，温水泡热了跟活人似的。' }; %>");
    const kws = extractEjsKeywords(card).map(k => k.keyword);
    expect(kws).toContain('玉势');
    expect(kws.some(k => k.length > 32)).toBe(false);
    expect(kws.some(k => k.includes('。'))).toBe(false);
  });

  it('mảng alias 1-ký-tự không làm match lệch pha nuốt dấu phẩy (`,\\n`)', () => {
    const card = mkCard("<% var aliases = ['甲', '乙丙丁', '战斗状态']; %>");
    const kws = extractEjsKeywords(card).map(k => k.keyword);
    expect(kws).toContain('乙丙丁');
    expect(kws).toContain('战斗状态');
    expect(kws.some(k => /,|\n/.test(k))).toBe(false);
  });
});

describe('canonicalizeEjsValue — đồng nhất separator _/- theo quy tắc TOKEN', () => {
  it('mọi mảnh đều non-ASCII → _/- là separator AI chèn bậy → về space', () => {
    expect(canonicalizeEjsValue('Thế_lực')).toBe('Thế lực');
    expect(canonicalizeEjsValue('Khái-quát_thế_lực')).toBe('Khái quát thế lực');
  });
  it('có mảnh ASCII thuần (identifier/prefix chức năng) → GIỮ NGUYÊN separator', () => {
    expect(canonicalizeEjsValue('[mvu_update] Định dạng đầu ra')).toBe('[mvu_update] Định dạng đầu ra');
    expect(canonicalizeEjsValue('từ_khóa_sfw')).toBe('từ_khóa_sfw');
    expect(canonicalizeEjsValue('stat_data')).toBe('stat_data');
  });
});

describe('canonicalizeMvuVarName — quy tắc token (biến mixed giữ separator)', () => {
  it('biến thuần chữ có dấu: _/- → space (hành vi cũ giữ nguyên)', () => {
    expect(canonicalizeMvuVarName('Họ_Tên')).toBe('Họ Tên');
  });
  it('biến MIXED chữ Hán + ASCII: GIỮ separator (đổi là vỡ getvar path)', () => {
    expect(canonicalizeMvuVarName('场景_sfw')).toBe('场景_sfw');
    expect(canonicalizeMvuVarName('隐藏_evt_01')).toBe('隐藏_evt_01');
  });
});

describe('enforceEjsDictConsistency với DICT THẬT của user (309 keyword)', () => {
  it('prune ≥70 entry rác (văn xuôi/mảnh code/identifier); mọi key còn lại đều đúng quy luật', () => {
    const { fixedDict, fixes } = enforceEjsDictConsistency(FIXTURE.ejsKeywordDict, { pruneInvalidKeywords: true });
    const before = Object.keys(FIXTURE.ejsKeywordDict).length;
    const after = Object.keys(fixedDict).length;
    expect(before).toBe(309);
    expect(before - after).toBeGreaterThanOrEqual(70);
    for (const k of Object.keys(fixedDict)) {
      expect(isValidEjsKeywordKey(k), k).toBe(true);
    }
    expect(fixedDict['sfw_keywords']).toBeUndefined();      // identifier ASCII bị dịch → loại khỏi dict
    expect(fixedDict['双胞胎']).toBe('Sinh đôi');            // keyword chuẩn giữ nguyên
    expect(fixes.length).toBeGreaterThan(0);
  });

  it('báo ĐỤNG ĐỘ khi ≥2 key cùng 1 bản dịch (父女/父子 → "Cha con")', () => {
    const { fixes } = enforceEjsDictConsistency(FIXTURE.ejsKeywordDict, { pruneInvalidKeywords: true });
    const collision = fixes.filter(f => f.includes('ĐỤNG ĐỘ'));
    expect(collision.length).toBeGreaterThanOrEqual(1);
    expect(collision.some(f => f.includes('Cha con'))).toBe(true);
  });

  it('entry NAME dict KHÔNG prune (tên dài/[prefix] hợp lệ) — không mất mục nào', () => {
    const { fixedDict } = enforceEjsDictConsistency(FIXTURE.ejsEntryNameDict);
    expect(Object.keys(fixedDict).length).toBe(Object.keys(FIXTURE.ejsEntryNameDict).length);
    // prefix chức năng [mvu_update] không bị phá separator
    expect(fixedDict['[mvu_update]变量输出格式']).toContain('[mvu_update]');
  });
});

describe('ejsMarkersIntact / hasEjsMarkers — guard toàn vẹn EJS theo CHUNK', () => {
  const orig = 'A <% if (x) { %> B <%= y %> C {{__ejs_0__}} D';
  it('bản dịch giữ đủ khối + token → intact', () => {
    expect(ejsMarkersIntact(orig, 'Á <% if (x) { %> Bê <%= y %> Xê {{__ejs_0__}} Dê')).toBe(true);
  });
  it('rơi 1 khối <%…%> → không intact', () => {
    expect(ejsMarkersIntact(orig, 'Á <% if (x) { %> Bê Xê {{__ejs_0__}} Dê')).toBe(false);
  });
  it('rơi token mask / đúp token → không intact', () => {
    expect(ejsMarkersIntact(orig, 'Á <% if (x) { %> B <%= y %> C D')).toBe(false);
    expect(ejsMarkersIntact('{{__ejs_0__}} {{__ejs_1__}}', '{{__ejs_0__}} {{__ejs_0__}}')).toBe(false);
  });
  it('hasEjsMarkers phát hiện đúng chunk cần guard', () => {
    expect(hasEjsMarkers('văn bản thường')).toBe(false);
    expect(hasEjsMarkers('có khối <% x %>')).toBe(true);
    expect(hasEjsMarkers('có token {{__ejs_3__}}')).toBe(true);
  });
});
