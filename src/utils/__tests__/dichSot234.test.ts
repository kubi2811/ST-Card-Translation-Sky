/**
 * (bug 234) DỊCH SÓT — "XONG" MÀ VẪN CÒN TIẾNG TRUNG.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "Vẫn còn tiếng trung chưa dịch hết nhưng vẫn để là dịch xong, lỗi tự động bỏ qua khi
 * trường ngắn và có xen kẽ như \"boss骇爪\" không dịch mà xem nó như đã dịch."
 *
 * Vì sao các lần fix trước (việc 80, bug 211, bug 226) chưa dứt điểm: mỗi lần chỉ THÊM một tấm
 * lưới mới ở cuối đường, mà không gỡ các NGƯỠNG DUNG THỨ nằm rải rác phía trước. Tổng cộng có
 * SÁU chỗ độc lập cùng nói một câu "còn ít chữ Hán thì coi như xong":
 *
 *   1. langDetect.detectLanguage  — 1-3 chữ Hán + chữ Latin ⇒ trả 'English'   (chưa gửi AI lần nào)
 *   2. langDetect.detectLanguage  — tiếng Việt lẫn ≤4 chữ Hán ⇒ 'Tiếng Việt'  (coi như đã dịch)
 *   3. apiClient residual check   — gốc <3 chữ Hán ⇒ miễn kiểm
 *   4. apiClient residual check   — còn ≤2 chữ Hán ⇒ tuyên bố sạch
 *   5. residualCjkScan            — chỉ soi status 'done', field 'skipped' tàng hình
 *   6. chunkAudit                 — chunk gốc ≤20 chữ Hán không bao giờ bị kiểm chữ sót
 *
 * Bộ test này khoá lại cả sáu, cộng với các chốt CHỐNG BÁO OAN đi kèm (Nhật/Hàn, link, CSS) —
 * vì siết quá tay mà báo oan thì sinh vòng dịch lại vô tận, đúng lớp lỗi đã trả giá ở bug 154.
 */
import { describe, it, expect } from 'vitest';
import { detectLanguage, shouldSkipTranslation } from '../langDetect';
import { scanFieldsForResidualCjk, countResidualHan, type ScannableField } from '../residualCjkScan';
import { collectProblemFields } from '../problemFields';
import { auditChunks } from '../chunkAudit';

const VI = 'Tiếng Việt';

/* ════════════════════════════════════════════════════════════════════════════
 * 1+2. CỔNG AUTO-SKIP — chỗ field không hề được gửi cho AI lần nào
 * ══════════════════════════════════════════════════════════════════════════ */
describe('(bug 234) cổng tự động bỏ qua', () => {
  it('"boss骇爪" KHÔNG được coi là tiếng Anh — đó là chuỗi TRỘN', () => {
    // Ngưỡng cũ: 4/6 ký tự là Latin (>30%) ⇒ 'English'. Rồi luật "ngôn ngữ thứ ba" bỏ qua nó.
    expect(detectLanguage('boss骇爪')).toBe('mixed');
  });

  it('ca user báo: source 中文 + "boss骇爪" ⇒ PHẢI DỊCH, không được bỏ qua', () => {
    expect(shouldSkipTranslation('boss骇爪', VI, '中文')).toBe(false);
  });

  it('chạy ở CẤU HÌNH MẶC ĐỊNH của app (source 中文, đích Tiếng Việt) — mọi biến thể đều phải dịch', () => {
    for (const t of [
      'boss骇爪',
      'HP:100 ATK:50 骇爪 boss level 3',
      'This is the boss weapon named 爪 and it is very strong.',
      '[[道具]] The sword of the boss is here now.',
    ]) {
      expect(shouldSkipTranslation(t, VI, '中文'), t).toBe(false);
    }
  });

  it('văn xuôi tiếng Việt còn lẫn chữ Hán ⇒ CHƯA xong, phải dịch tiếp (kể cả source=auto)', () => {
    // Ca thật: mở lại thẻ dịch dở, hoặc thẻ song ngữ. Ngưỡng cũ tha tới 4 chữ Hán.
    for (const t of [
      '<道具>Kiếm cổ<道具>',
      '<道具>\nMột thanh kiếm cũ kỹ, đã gỉ sét theo năm tháng.',
      'Thanh kiếm 骇爪剑 của boss nằm trong kho.',
    ]) {
      expect(shouldSkipTranslation(t, VI, 'auto'), `auto:${t}`).toBe(false);
      expect(shouldSkipTranslation(t, VI, '中文'), `zh:${t}`).toBe(false);
    }
  });

  it('chốt an toàn nay áp cho VĂN XUÔI, không riêng field code', () => {
    // Cùng nội dung Hán, chỉ khác cái vỏ code — trước đây cho hai kết quả trái ngược.
    expect(shouldSkipTranslation('const x = 1; boss骇爪', VI, '中文')).toBe(false);
    expect(shouldSkipTranslation('boss骇爪', VI, '中文')).toBe(false);
  });

  /* ─── CHỐNG BÁO OAN: siết quá tay là đốt tiền dịch lại thứ không cần dịch ─── */
  it('không phá hợp đồng FROM/TO (#140): entry THUẦN tiếng Anh vẫn được bỏ qua', () => {
    const en = 'Whenever using an NPC character, obtain the complete StatBlocks from the monster '
      + 'menu or similar sources for reference. You are a professional Dungeon Master.';
    expect(shouldSkipTranslation(en, VI, '中文')).toBe(true);
  });

  it('entry tiếng NHẬT vẫn được bỏ qua — kanji là chữ của chính nó, không phải "Hán còn sót"', () => {
    const ja = 'これは日本語のテキストです。彼女は静かな性格で、毎晩図書館で本を読んでいます。とても優しい人です。';
    expect(shouldSkipTranslation(ja, VI, '中文')).toBe(true);
  });

  it('văn xuôi tiếng Việt SẠCH chữ Hán vẫn được bỏ qua như cũ', () => {
    const vi = 'Anh ấy là một thám tử điềm tĩnh, sống trong một căn nhà cổ ở ngoại ô, giỏi quan sát.';
    expect(shouldSkipTranslation(vi, VI, '中文')).toBe(true);
  });

  it('chữ Hán NẰM TRONG LINK không tính là chưa dịch — nếu tính thì dịch kiểu gì cũng không thoát', () => {
    const vi = 'Đây là bản dịch tiếng Việt hoàn chỉnh, có kèm đường dẫn tới thư viện ngoài đã được giữ nguyên: '
      + 'https://cdn.example.com/骰子系统/stable.js';
    expect(countResidualHan(vi)).toBe(0);
    expect(shouldSkipTranslation(vi, VI, '中文')).toBe(true);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * 5. LƯỚI CUỐI — field 'skipped' từng tàng hình với mọi bộ dò
 * ══════════════════════════════════════════════════════════════════════════ */
const mk = (o: Partial<ScannableField>): ScannableField => ({
  path: 'lorebook[29].content', label: 'lorebook[29].content', group: 'lorebook',
  status: 'done', original: '道具规则说明', translated: '', ...o,
});

describe('(bug 234) bộ quét cuối phải thấy field bị tự động bỏ qua', () => {
  it('field skipped (bản "dịch" = nguyên văn tiếng Trung) PHẢI vào danh sách còn sót', () => {
    const hits = scanFieldsForResidualCjk([
      mk({ status: 'skipped', original: 'boss骇爪', translated: 'boss骇爪' }),
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].count).toBe(2);
  });

  it('sót ĐÚNG 2 chữ Hán (cỡ một tiêu đề "<道具>") vẫn phải bị bắt', () => {
    const hits = scanFieldsForResidualCjk([
      mk({ translated: '<道具>\nQuy tắc vật phẩm và đạo cụ: tất cả vật phẩm đều có tên riêng.' }),
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].count).toBe(2);
    expect(hits[0].samples[0]).toContain('道具');
  });

  it("'ignored' (user chủ động tick bỏ dịch) thì KHÔNG bị lôi vào — còn tiếng Trung là đúng ý họ", () => {
    const hits = scanFieldsForResidualCjk([
      mk({ status: 'ignored', original: '道具规则', translated: '道具规则' }),
    ]);
    expect(hits).toHaveLength(0);
  });

  it('bảng "mục chưa đạt" KHÔNG được đếm field skipped hai lần', () => {
    // Nó khớp cả nguồn 'skipped' lẫn nguồn 'residual' ⇒ nếu cứ push thêm thì tổng phồng gấp đôi.
    const { problems, counts } = collectProblemFields([
      { ...mk({ status: 'skipped', original: 'boss骇爪', translated: 'boss骇爪' }), keptOriginalOnPurpose: undefined },
    ]);
    expect(problems).toHaveLength(1);
    expect(counts.total).toBe(1);
    expect(problems[0].kind).toBe('skipped');
    // …nhưng vẫn phải giữ chứng cứ đoạn còn sót để lượt dịch lại được nhắc đích danh.
    expect(problems[0].residual?.count).toBe(2);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * 6. BẢNG SOI CHUNK — từng in nhãn XANH "Đủ và sạch" cho chunk còn tiếng Trung
 * ══════════════════════════════════════════════════════════════════════════ */
describe('(bug 234) bảng soi chunk', () => {
  it('chunk gốc NGẮN bị chép nguyên văn phải bị bắt (ngưỡng cũ đòi gốc >20 chữ Hán)', () => {
    const a = auditChunks(['boss骇爪 / 装备'], ['boss骇爪 / 装备']);
    expect(a.suspectIndices).toEqual([0]);
    expect(a.blockingIndices).toEqual([0]);          // chép nguyên văn ⇒ cấm ghép
    expect(a.issues[0].kind).toBe('untranslated');
  });

  it('sót LƠ THƠ (2%) vẫn phải nói ra — ngưỡng cũ là 30% nên im lặng cho qua', () => {
    const src = '道'.repeat(3000);
    const out = 'Bản dịch tiếng Việt rất dài. '.repeat(400) + '道'.repeat(60);
    const a = auditChunks([src], [out]);
    expect(a.suspectIndices).toEqual([0]);
    expect(a.issues[0].kind).toBe('untranslated');
  });

  it('…nhưng sót lơ thơ chỉ là CẢNH BÁO, không khoá nút Ghép lại', () => {
    // Chặn cứng cả hai mức thì một chunk AI chữa mãi không xong sẽ khoá luôn cả entry.
    const src = '道'.repeat(3000);
    const out = 'Bản dịch tiếng Việt rất dài. '.repeat(400) + '道'.repeat(60);
    const a = auditChunks([src], [out]);
    expect(a.issues[0].severity).toBe('warn');
    expect(a.blockingIndices).toEqual([]);
  });

  it('sót NHIỀU (>30%) thì chặn ghép như cũ', () => {
    const src = '道具规则说明书'.repeat(10);
    const a = auditChunks([src], [src.slice(0, Math.floor(src.length * 0.9))]);
    expect(a.blockingIndices).toEqual([0]);
  });

  it('chunk dịch SẠCH vẫn báo sạch — không được báo oan', () => {
    const src = '道具规则说明。'.repeat(30);
    const out = 'Quy tắc vật phẩm và đạo cụ. '.repeat(30);
    const a = auditChunks([src], [out]);
    expect(a.suspectIndices).toEqual([]);
    expect(a.okCount).toBe(1);
  });

  it('chữ Hán trong LINK không bị tính là chưa dịch', () => {
    const src = "import('https://cdn.example.com/骰子系统/stable.js');\n" + '道具规则说明。'.repeat(20);
    const out = "import('https://cdn.example.com/骰子系统/stable.js');\n"
      + 'Quy tắc vật phẩm và đạo cụ ở đây. '.repeat(20);
    const a = auditChunks([src], [out]);
    expect(a.suspectIndices).toEqual([]);
  });

  it('chunk rỗng vẫn là lỗi CHẶN như cũ (ghép là mất hẳn đoạn)', () => {
    const a = auditChunks(['道具规则'], ['']);
    expect(a.issues[0].kind).toBe('missing');
    expect(a.blockingIndices).toEqual([0]);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * 3+4. NGƯỠNG DUNG THỨ TRONG ENGINE — khoá bằng cách đọc chính mã nguồn.
 * (postTranslationResidualCheck không export được: nó gọi API thật.)
 * ══════════════════════════════════════════════════════════════════════════ */
describe('(bug 234) engine không còn tha "còn 1-2 chữ Hán"', () => {
  it('apiClient bỏ hẳn hai ngưỡng `origChineseCount < 3` và `residualCount <= 2`', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(
      new URL('../apiClient.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('origChineseCount < 3');
    expect(src).not.toContain('residualCount <= 2');
    expect(src).toContain('origChineseCount === 0');
    expect(src).toContain('residualCount === 0');
    // Lô gộp: `origChinese >= 3` bỏ sót đúng các field ngắn (tên/nhãn/comment).
    expect(src).not.toContain('origChinese >= 3');
    expect(src).toContain('origChinese > 0 && residual > 0');
  });
});
