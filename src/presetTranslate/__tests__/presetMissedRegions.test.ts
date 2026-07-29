// (bug 153) Ba VÙNG bị bỏ sót hoàn toàn khi dịch preset — không phải dịch kém, mà là
// pipeline không bao giờ đi tới đó.
//
// Đối chiếu trên chính cặp preset user gửi (bug/153): 57.841 → 2.729 ký tự Hán, nhưng phần
// còn lại dồn vào đúng ba chỗ mà `collectUnits` không nhìn:
//   1. extensions.SPreset.RegexBinding.regexes — bản sao thứ hai của 23 regex, 775 ký tự Hán,
//      giống bản gốc TỪNG BYTE sau khi dịch. User mở ra thấy scriptName tiếng Trung và báo
//      "chưa dịch scriptname" — họ nhìn đúng, chỉ là nhìn vào bản sao tool không biết có.
//   2. new_chat_prompt  ('这是一个故事的开始')
//   3. assistant_prefill ('思考已结束。')
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectUnits, hasResidualCjk } from '../presetPipeline';
import { getPresetExtras, topProseKeys } from '../inventory';
import { parsePresetJSON } from '../../utils/presetParser';
import type { STPreset } from '../../types/card';

const SRC = resolve(__dirname, '../../../bug/153/双人成行 V4.0 泥中花can改自用2.4.json');
const load = () => parsePresetJSON(JSON.parse(readFileSync(SRC, 'utf-8'))) as STPreset;

// Dịch Card có vòng quét lại chữ Hán sót từ bug 80; Dịch Preset thì chưa có — mỗi đơn vị chỉ
// được dịch đúng một lần. Ngưỡng phải theo TỶ LỆ, nếu theo số tuyệt đối thì mấy mục cố tình
// giữ tên riêng tiếng Trung sẽ bị dịch lại mãi không dừng.
describe('(bug 153) nhận diện bản dịch bỏ dở giữa chừng', () => {
  const HAN = '这是一个很长的中文段落用来测试翻译是否被中途放弃了内容';   // 26 chữ Hán

  it('dịch trọn vẹn → không đòi dịch lại', () => {
    expect(hasResidualCjk(HAN, 'Đây là một đoạn văn dài dùng để kiểm tra')).toBe(false);
  });

  it('bỏ dở giữa chừng (còn hơn nửa) → phải dịch lại', () => {
    expect(hasResidualCjk(HAN, 'Đây là một đoạn văn 用来测试翻译是否被中途放弃了内容')).toBe(true);
  });

  it('giữ lại vài chữ cho tên riêng → KHÔNG dịch lại (chống lặp vô hạn)', () => {
    expect(hasResidualCjk(HAN, 'Đây là đoạn văn dài kiểm tra bản dịch của 秋青子 nhé')).toBe(false);
  });

  it('đơn vị quá ngắn → không xét (một cái tên đã chiếm hết)', () => {
    expect(hasResidualCjk('秋青子', '秋青子')).toBe(false);
  });
});

describe.skipIf(!existsSync(SRC))('(bug 153) preset thật của user', () => {
  it('gom được CẢ bản sao regex lồng trong SPreset.RegexBinding', () => {
    const { regexScripts, primaryRegexCount } = getPresetExtras(load());
    expect(primaryRegexCount, 'extensions.regex_scripts').toBe(23);
    expect(regexScripts.length, 'phải thấy cả bản sao trong SPreset').toBeGreaterThan(primaryRegexCount);
  });

  it('trường prompt cấp cao nhất được nhận diện', () => {
    const keys = topProseKeys(load());
    expect(keys).toContain('new_chat_prompt');
    expect(keys).toContain('assistant_prefill');
  });

  it('KHÔNG nhận nhầm khoá kỹ thuật (tên model…) là văn xuôi', () => {
    const keys = topProseKeys(load());
    for (const k of ['claude_model', 'openrouter_model', 'chat_completion_source']) {
      expect(keys, `${k} không phải văn xuôi`).not.toContain(k);
    }
  });

  it('collectUnits phủ hết ba vùng từng bị bỏ sót', () => {
    const ids = collectUnits(load()).map((u) => u.id);
    expect(ids).toContain('top:new_chat_prompt');
    expect(ids).toContain('top:assistant_prefill');
    // 23 tên gốc + 23 tên trong bản sao = phải nhiều hơn 23 đơn vị rxname
    expect(ids.filter((i) => i.startsWith('rxname:')).length).toBeGreaterThan(23);
  });

  it('scriptName trùng nhau ở hai bản sao → gộp lại chỉ còn một chuỗi gốc cần dịch', () => {
    const units = collectUnits(load()).filter((u) => u.id.startsWith('rxname:'));
    const distinct = new Set(units.map((u) => u.original));
    expect(units.length, 'có bản sao nên số đơn vị phải lớn hơn số chuỗi khác nhau')
      .toBeGreaterThan(distinct.size);
  });
});
