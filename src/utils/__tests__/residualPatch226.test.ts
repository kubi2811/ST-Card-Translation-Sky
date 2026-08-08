/**
 * (bug 226) "Các vùng lỗi phân bố đồng đều ở 21 chunk, vì vậy AI bắt buộc phải call dịch lại
 * 21 chunk… nên có 1 quy trình quét và dò nhanh, gộp chung lại thành 1 khối, dịch cả khối rồi
 * phân phối về lại địa chỉ ban đầu."
 * ─────────────────────────────────────────────────────────────────────────────
 * Hai việc trong một bug, test tách đôi theo đúng thế:
 *
 *  A. TỰ GHÉP SAU KHI TAB BỊ GIẾT — bản vá 222 chỉ cứu ca "hậu xử lý ném lỗi"; tab bị Edge
 *     giết thì không có mã nào của tool chạy để mà cứu. Mở lại phiên phải tự ghép nốt.
 *
 *  B. VÁ GỘP THEO VÙNG — bộ dò cũ làm việc theo CELL nên 150 chữ Hán rải đều trên 21 cell là
 *     21 lượt gọi API. Ở đây đơn vị là vùng: khoanh địa chỉ, gộp một lượt, dán trả về chỗ cũ.
 *
 * Phần đáng lo nhất của (B) là ĐỊA CHỈ: bộ lọc link cũ CẮT BỎ chuỗi nên mọi offset phía sau
 * lệch — vá theo địa chỉ lệch là ghi đè vào giữa câu đang đúng, và không có đường lùi. Nên có
 * hẳn một nhóm test chỉ để canh chuyện độ dài không đổi.
 */
import { describe, it, expect } from 'vitest';
import {
  maskUrlsKeepingOffsets, maskCssKeepingOffsets, findResidualSpans, planFieldResidualPatch,
  buildPatchJob, buildResidualPatchPrompt, parseResidualPatchReply, applyResidualPatches,
  rejectReason, patchEligibility,
} from '../residualPatch';
import { planAutoJoin, joinChunks } from '../chunkAudit';

const join = (cells: string[]) => joinChunks(cells, 'văn xuôi bình thường');

/* ────────────────────────── A · tự ghép sau khi tab chết ────────────────────────── */

describe('(bug 226 A) tab bị giết giữa khâu ghép ⇒ mở lại là tự ghép nốt', () => {
  const base = {
    path: 'data.description', label: 'Mô tả',
    original: '第一段。第二段。第三段。',
    totalChunks: 3,
    completedChunks: ['Đoạn một.', 'Đoạn hai.', 'Đoạn ba.'],
  };

  it('bản dịch vẫn ĐANG LÀ bản gốc (đúng ca user tả: báo 30k chữ Hán) ⇒ ghép', () => {
    const plans = planAutoJoin([{ ...base, translated: base.original }]);
    expect(plans).toHaveLength(1);
    expect(plans[0].reason).toBe('đang là bản gốc');
    expect(plans[0].joined).toContain('Đoạn một.');
    expect(plans[0].hanAfter).toBe(0);
    expect(plans[0].hanBefore).toBeGreaterThan(0);
  });

  it('chưa có bản dịch ⇒ ghép', () => {
    expect(planAutoJoin([{ ...base, translated: '' }])[0].reason).toBe('chưa có bản dịch');
  });

  it('bản đang giữ SẠCH HƠN bản ghép ⇒ KHÔNG đụng vào', () => {
    expect(planAutoJoin([{ ...base, translated: 'Bản đã sửa tay, sạch trơn.' }])).toEqual([]);
  });

  it('còn ô chunk trống ⇒ KHÔNG ghép (ghép lúc này ra bản thiếu)', () => {
    expect(planAutoJoin([{ ...base, completedChunks: ['Đoạn một.', '', 'Đoạn ba.'], translated: base.original }])).toEqual([]);
  });

  it('mục CỐ Ý giữ nguyên bản gốc (chốt an toàn script) ⇒ KHÔNG đụng vào', () => {
    const plans = planAutoJoin([{ ...base, translated: base.original, keptOriginalOnPurpose: true }]);
    expect(plans).toEqual([]);
  });

  it('số cell không khớp totalChunks ⇒ KHÔNG ghép (lệch nhịp cắt)', () => {
    expect(planAutoJoin([{ ...base, totalChunks: 5, translated: base.original }])).toEqual([]);
  });
});

/* ─────────────────── B1 · địa chỉ phải tuyệt đối đúng ─────────────────── */

describe('(bug 226 B) che link/CSS mà KHÔNG đổi độ dài — nếu lệch là vá vào giữa câu người khác', () => {
  const cases = [
    'xem tại https://vi.dụ.com/骰子系统/stable.js nhé',
    '<img src="https://a.com/图片.png"> và 力量',
    'background: url("./tài-nguyên/nền.png"); 魔力',
    "import('https://cdn.com/骰子系统/stable.js'); 灵力",
    '[nhãn 力量](https://vi.dụ.com/trang)',
    'data:image/png;base64,AAAA 丹田',
  ];
  for (const s of cases) {
    it(`giữ nguyên độ dài: ${s.slice(0, 34)}…`, () => {
      expect(maskUrlsKeepingOffsets(s)).toHaveLength(s.length);
    });
  }

  it('CSS giữ tiếng Trung có chủ ý cũng che cùng độ dài', () => {
    const s = "font-family: '微软雅黑', sans-serif; nội dung 力量";
    expect(maskCssKeepingOffsets(s)).toHaveLength(s.length);
  });

  it('chữ Hán TRONG link không bị tính là dịch sót', () => {
    expect(findResidualSpans("import('https://cdn.com/骰子系统/stable.js');")).toEqual([]);
  });
});

describe('(bug 226 B) khoanh vùng đúng chỗ, không nong ra hai bên', () => {
  it('vùng cắt ĐÚNG từ chữ Hán đầu tới chữ Hán cuối của cụm', () => {
    const text = 'Sức mạnh của 力量值 tăng lên.';
    const [span] = findResidualSpans(text, 0);
    expect(span.text).toBe('力量值');
    expect(text.slice(span.start, span.end)).toBe('力量值');
    expect(span.chunk).toBe(0);
    expect(span.han).toBe(3);
  });

  it('hai cụm ở XA nhau tách thành hai vùng, gần nhau thì gộp một', () => {
    expect(findResidualSpans('力量' + ' '.repeat(60) + '魔力')).toHaveLength(2);
    expect(findResidualSpans('力量 và 魔力')).toHaveLength(1);
  });

  it('ngữ cảnh được lấy riêng, KHÔNG nằm trong phần bị thay', () => {
    const [span] = findResidualSpans('Trước đó rất lâu, 力量值 sau đó thì thôi.');
    expect(span.before).toContain('Trước đó');
    expect(span.after).toContain('sau đó');
    expect(span.text).toBe('力量值');
  });
});

/* ─────────────────── B2 · gộp một lượt rồi dán về chỗ cũ ─────────────────── */

describe('(bug 226 B) gom nhiều cell vào MỘT lượt gọi rồi trả về đúng địa chỉ', () => {
  const field = {
    path: 'data.script', label: 'Script',
    completedChunks: [
      'const a = "Sức mạnh";  // 力量值 ghi chú',
      'const b = "Ma lực";    // 魔力 ghi chú',
      'const c = "Đan điền";  // 丹田 ghi chú',
    ],
    rawChunks: ['x', 'y', 'z'],
  };

  it('ba cell mỗi cell sót một cụm ⇒ MỘT lượt gọi với ba mẩu, không phải ba lượt', () => {
    const plan = planFieldResidualPatch(field)!;
    expect(plan.spans).toHaveLength(3);
    expect(plan.spans.map(s => s.chunk)).toEqual([0, 1, 2]);
    const items = buildPatchJob([plan]);
    expect(items.map(i => i.id)).toEqual([1, 2, 3]);
    const prompt = buildResidualPatchPrompt(items, 'Tiếng Việt');
    // Cả ba mẩu nằm trong CÙNG một prompt — đó chính là chỗ tiết kiệm.
    for (const t of ['力量值', '魔力', '丹田']) expect(prompt).toContain(t);
  });

  it('dán trả về đúng chỗ, các phần khác không suy suyển', () => {
    const plan = planFieldResidualPatch(field)!;
    const items = buildPatchJob([plan]);
    const replies = new Map([[1, 'chỉ số sức mạnh'], [2, 'chỉ số ma lực'], [3, 'đan điền']]);
    const res = applyResidualPatches(field, items, replies, join);
    expect(res.applied).toBe(3);
    expect(res.completedChunks![0]).toBe('const a = "Sức mạnh";  // chỉ số sức mạnh ghi chú');
    expect(res.completedChunks![1]).toBe('const b = "Ma lực";    // chỉ số ma lực ghi chú');
    expect(res.completedChunks![2]).toBe('const c = "Đan điền";  // đan điền ghi chú');
    // Bản ghép cũng được cập nhật — vá mỗi bản ghép thì lần "Ghép lại" sau là mất công vá.
    expect(res.translated).not.toContain('力量值');
  });

  it('NHIỀU vùng trong CÙNG một cell: thay từ cuối lên đầu nên offset không lệch', () => {
    const f = { path: 'p', label: 'L', completedChunks: ['A 力量 B ' + ' '.repeat(40) + ' C 魔力 D'] };
    const plan = planFieldResidualPatch(f)!;
    expect(plan.spans).toHaveLength(2);
    const items = buildPatchJob([plan]);
    // Mẩu đầu dài ra gấp mấy lần — đủ để lộ ngay nếu ai đó thay từ đầu xuống.
    const res = applyResidualPatches(f, items, new Map([[1, 'SỨC MẠNH RẤT DÀI'], [2, 'MA LỰC']]), join);
    expect(res.completedChunks![0]).toContain('A SỨC MẠNH RẤT DÀI B');
    expect(res.completedChunks![0]).toContain('C MA LỰC D');
  });

  it('mục KHÔNG chia chunk thì vá thẳng trên bản dịch', () => {
    const f = { path: 'p', label: 'L', translated: 'Tên hắn là 秋青子, một kẻ lang thang.' };
    const plan = planFieldResidualPatch(f)!;
    expect(plan.spans[0].chunk).toBe(-1);
    const res = applyResidualPatches(f, buildPatchJob([plan]), new Map([[1, 'Thu Thanh Tử']]), join);
    expect(res.translated).toBe('Tên hắn là Thu Thanh Tử, một kẻ lang thang.');
  });
});

/* ─────────────────── B3 · cửa kiểm: thà vá hụt còn hơn dán bừa ─────────────────── */

describe('(bug 226 B) mảnh trả về phải qua cửa kiểm mới được dán', () => {
  it('còn nguyên chữ Hán ⇒ từ chối', () => {
    expect(rejectReason('力量值', '力量值')).toBe('vẫn còn nguyên chữ Hán');
  });
  it('rỗng ⇒ từ chối', () => {
    expect(rejectReason('力量值', '   ')).toBe('trả về rỗng');
  });
  it('dài bất thường (AI kể lể) ⇒ từ chối', () => {
    expect(rejectReason('力量值', 'x'.repeat(400))).toBe('dài bất thường');
  });
  it('cắt cụt ⇒ từ chối', () => {
    expect(rejectReason('力量值 và rất nhiều chữ khác nữa ở đây', 'sức')).toBe('ngắn bất thường');
  });
  it('bản dịch tử tế ⇒ nhận', () => {
    expect(rejectReason('力量值', 'chỉ số sức mạnh')).toBeNull();
  });

  it('AI thiếu mẩu nào thì mẩu đó GIỮ NGUYÊN, các mẩu khác vẫn được vá', () => {
    const f = { path: 'p', label: 'L', completedChunks: ['A 力量 B', 'C 魔力 D'] };
    const items = buildPatchJob([planFieldResidualPatch(f)!]);
    const res = applyResidualPatches(f, items, new Map([[1, 'SỨC MẠNH']]), join);
    expect(res.applied).toBe(1);
    expect(res.completedChunks![0]).toBe('A SỨC MẠNH B');
    expect(res.completedChunks![1]).toBe('C 魔力 D');
    expect(res.rejected[0].why).toBe('AI không trả mẩu này');
  });

  it('văn bản đã đổi kể từ lúc quét ⇒ KHÔNG dán đè', () => {
    const f = { path: 'p', label: 'L', completedChunks: ['A 力量 B'] };
    const items = buildPatchJob([planFieldResidualPatch(f)!]);
    const moved = { ...f, completedChunks: ['user vừa sửa tay xong 力量 B'] };
    const res = applyResidualPatches(moved, items, new Map([[1, 'SỨC MẠNH']]), join);
    expect(res.applied).toBe(0);
    expect(res.rejected[0].why).toBe('văn bản đã thay đổi kể từ lúc quét');
  });
});

describe('(bug 226 B) chỉ đi lối vá gộp cho lỗi NHỎ', () => {
  const mk = (han: number, spans: number) => ([{
    path: 'p', label: 'L', totalHan: han,
    spans: Array.from({ length: spans }, () => ({ chunk: 0, start: 0, end: 1, text: '力', before: '', after: '', han: 1 })),
  }]);

  it('sót ít ⇒ đi', () => expect(patchEligibility(mk(150, 21))).toBeNull());
  it('sót quá nhiều ⇒ nhường đường dịch lại từng phần', () => {
    expect(patchEligibility(mk(5000, 10))).toContain('quá 1000');
  });
  it('quá nhiều vùng rời ⇒ nhường đường cũ', () => {
    expect(patchEligibility(mk(200, 200))).toContain('vùng rời');
  });
  it('không còn gì ⇒ nói rõ', () => expect(patchEligibility([])).toBe('không còn chữ Hán nào'));
});

describe('(bug 226 B) bóc câu trả lời của AI', () => {
  it('đọc được thẻ <m id>, chịu được nháy đơn/kép và khoảng trắng thừa', () => {
    const r = parseResidualPatchReply(`lảm nhảm\n<m id="1">một</m>\n<m id='2' >hai</m>\n<m id=3>ba</m>`);
    expect([...r.entries()]).toEqual([[1, 'một'], [2, 'hai'], [3, 'ba']]);
  });
  it('mẩu chứa code có dấu nháy và chéo ngược vẫn nguyên vẹn (lý do KHÔNG dùng JSON)', () => {
    const r = parseResidualPatchReply(`<m id="1">const s = "a\\"b"; // ghi chú</m>`);
    expect(r.get(1)).toBe('const s = "a\\"b"; // ghi chú');
  });
  it('AI trả rác ⇒ map rỗng, caller quay về đường cũ', () => {
    expect(parseResidualPatchReply('xin lỗi tôi không thể').size).toBe(0);
  });
});
