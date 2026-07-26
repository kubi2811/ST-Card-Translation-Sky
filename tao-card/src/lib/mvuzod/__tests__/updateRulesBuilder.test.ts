// (bugNeedFix/112) "Auto Creator khi tạo Entry MVU Quy tắc cập nhật biến còn hơi chán, nên có cái
// cập nhật được vào thanh trạng thái, có cái không."
// Gốc: pipeline dùng NGUYÊN VĂN bài AI viết — văn xuôi chỉ nhắc tay đôi ba biến. Biến không được
// nhắc thì AI trong game chẳng có cớ gì đụng tới ⇒ đứng im cả ván.
import { describe, it, expect } from 'vitest';
import { buildUpdateRulesEntry, parseAiUpdateRules, findVarsMissingRules } from '../updateRulesBuilder';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

/** Schema rút gọn từ đúng thẻ trong bằng chứng của user. */
const SCHEMA: MVUZODSchema = {
  version: '1.0',
  fields: [
    {
      path: 'Thế Giới', type: 'object', label: 'Thế Giới', defaultValue: {}, constraints: {},
      children: [
        { path: 'Thế Giới/Ngày', type: 'number', label: 'Ngày', defaultValue: 1, constraints: { min: 1 } },
        { path: 'Thế Giới/Khung Giờ', type: 'string', label: 'Khung Giờ', defaultValue: 'Sáng', constraints: { enumValues: ['Sáng', 'Trưa', 'Chiều', 'Tối', 'Đêm'] } },
        { path: 'Thế Giới/Thời Tiết', type: 'string', label: 'Thời Tiết', defaultValue: '', constraints: {} },
      ],
    },
    {
      path: 'Chiến Đấu', type: 'object', label: 'Chiến Đấu', defaultValue: {}, constraints: {},
      children: [
        { path: 'Chiến Đấu/VP Hiện Tại', type: 'number', label: 'VP Hiện Tại', defaultValue: 120, constraints: { min: 0, max: 120 } },
        { path: 'Chiến Đấu/Shard Collapse', type: 'boolean', label: 'Shard Collapse', defaultValue: false, constraints: {} },
      ],
    },
    // Biến readonly/ẩn — MVU quy ước AI không được ghi, nên KHÔNG cần quy tắc.
    { path: '_Nội Bộ', type: 'string', label: 'Nội bộ', defaultValue: '', constraints: {} },
  ],
} as unknown as MVUZODSchema;

/** Đúng kiểu bài Auto Creator đang sinh: văn xuôi, chỉ nhắc vài biến. */
const BAI_VAN_XUOI = `Vai trò của bạn là Game Master. Cuối MỖI LƯỢT, cập nhật chỉ số bằng khối <UpdateVariable>.
- Điểm '/Chiến Đấu/VP Hiện Tại': DÙNG op 'delta' để trừ MẠNH mỗi khi dùng kỹ năng Shard.
- '/Thế Giới/Ngày' & Khung Giờ: op 'replace' sau mỗi lần chuyển cảnh.`;

/** Đúng kiểu bài tự làm trong MVUZOD Studio: cây YAML phủ từng biến. */
const BAI_CAY_YAML = `Quy tắc cập nhật biến:
  Thế Giới:
    Ngày:
      type: number
      range: 1~Infinity
      check:
        - Tăng thêm 1 mỗi khi nhân vật bước qua giấc ngủ
        - Đồng bộ với tiến triển sinh tồn của cốt truyện
    Khung Giờ:
      format: "Enum: Sáng, Trưa, Chiều, Tối, Đêm"
      check:
        - Chuyển đổi tuần tự theo thời gian diễn ra hành động
  Chiến Đấu:
    VP Hiện Tại:
      type: number
      range: 0~VP Tối Đa
      check:
        - Trừ trực tiếp khi dùng ma thuật hoặc chịu sát thương
        - Hồi phục khi thiền định hoặc dùng Tinh Chất Veil`;

describe('Bóc cây quy tắc của AI', () => {
  const map = parseAiUpdateRules(BAI_CAY_YAML);

  it('nhận đúng từng biến lá kèm check/type/range', () => {
    expect([...map.keys()].sort()).toEqual(
      ['Chiến Đấu.VP Hiện Tại', 'Thế Giới.Khung Giờ', 'Thế Giới.Ngày'].sort(),
    );
    const ngay = map.get('Thế Giới.Ngày')!;
    expect(ngay.type).toBe('number');
    expect(ngay.range).toBe('1~Infinity');
    expect(ngay.check.length).toBe(2);
  });

  it('bài văn xuôi thì không bóc ra biến nào (đúng — nó không có cấu trúc)', () => {
    expect(parseAiUpdateRules(BAI_VAN_XUOI).size).toBe(0);
  });
});

describe('CHÍNH CA: dựng entry phải phủ ĐỦ mọi biến', () => {
  it('bài văn xuôi → máy sinh bù toàn bộ, không biến nào thiếu quy tắc', () => {
    const r = buildUpdateRulesEntry(SCHEMA, BAI_VAN_XUOI);
    expect(r.stats.total).toBe(5);            // 5 lá; biến `_Nội Bộ` readonly bị loại
    expect(r.stats.synthesized).toBe(5);
    expect(findVarsMissingRules(SCHEMA, r.content)).toEqual([]);
  });

  it('bài cây YAML → giữ nguyên chữ AI viết, chỉ bù biến AI bỏ quên', () => {
    const r = buildUpdateRulesEntry(SCHEMA, BAI_CAY_YAML);
    expect(r.stats.fromAi).toBe(3);
    expect(r.stats.synthesized).toBe(2);
    expect(r.stats.missingFromAi.sort()).toEqual(
      ['Chiến Đấu.Shard Collapse', 'Thế Giới.Thời Tiết'].sort(),
    );
    // Chữ của AI được giữ nguyên vẹn
    expect(r.content).toContain('Tăng thêm 1 mỗi khi nhân vật bước qua giấc ngủ');
    expect(findVarsMissingRules(SCHEMA, r.content)).toEqual([]);
  });

  it('không có bài AI → vẫn ra entry đầy đủ (không bao giờ để trống)', () => {
    const r = buildUpdateRulesEntry(SCHEMA);
    expect(r.stats.total).toBe(5);
    expect(findVarsMissingRules(SCHEMA, r.content)).toEqual([]);
  });

  it('biến readonly (_) không bị đòi quy tắc — MVU cấm AI ghi vào', () => {
    const r = buildUpdateRulesEntry(SCHEMA);
    expect(r.content).not.toContain('_Nội Bộ');
  });
});

describe('Chất lượng nội dung sinh bù', () => {
  const r = buildUpdateRulesEntry(SCHEMA);

  it('đúng khung YAML như bản tự làm trong MVUZOD', () => {
    expect(r.content.startsWith('---\nQuy tắc cập nhật biến:')).toBe(true);
    expect(r.content).toContain('  Thế Giới:');
    expect(r.content).toContain('    Ngày:');
    expect(r.content).toContain('      check:');
  });

  it('số có type + range suy từ ràng buộc schema', () => {
    expect(r.content).toMatch(/Ngày:\n\s+type: number\n\s+range: 1~Infinity/);
    expect(r.content).toMatch(/VP Hiện Tại:\n\s+type: number\n\s+range: 0~120/);
  });

  it('biến enum có format liệt kê đủ giá trị + dặn dùng op replace', () => {
    expect(r.content).toContain('format: Enum: Sáng, Trưa, Chiều, Tối, Đêm');
    expect(r.content).toContain("CHỈ chọn một trong các giá trị");
  });

  it('boolean được dặn dùng op replace true/false', () => {
    expect(r.content).toMatch(/Shard Collapse:[\s\S]*?true\/false/);
  });
});

describe('Soi thẻ CŨ xem thiếu quy tắc biến nào', () => {
  it('bài văn xuôi kiểu Auto Creator cũ → chỉ ra đúng biến bị bỏ quên', () => {
    const missing = findVarsMissingRules(SCHEMA, BAI_VAN_XUOI);
    expect(missing).toContain('Thế Giới.Thời Tiết');
    expect(missing).toContain('Chiến Đấu.Shard Collapse');
    // Hai biến CÓ được nhắc trong bài thì không bị kể là thiếu
    expect(missing).not.toContain('Thế Giới.Ngày');
    expect(missing).not.toContain('Chiến Đấu.VP Hiện Tại');
  });
});
