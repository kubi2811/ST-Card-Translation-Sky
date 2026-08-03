/**
 * (bug 204) Entry "Tạo thẻ từ truyện" phải CHI TIẾT — không lấy số lượng bù chất lượng.
 * Ba mảnh: (1) luật độ sâu chưng cất từ tài liệu user (phép thử che tên, ngoại hình không mỹ
 * từ, quan hệ bằng tương tác cụ thể…) phải nằm trong các lượt tổng hợp entry; (2) kiến thức
 * nền wiki được nối vào các job tổng hợp với luật "truyện là chân lý"; (3) timeline sinh thêm
 * entry GIAI ĐOẠN đặt tên + keys theo ngày tháng của sự kiện.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ENTRY_DEPTH_RULE } from '../storyDeepScan';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('(bug 204) luật độ sâu entry', () => {
  it('chưng cất đủ các mặt từ tài liệu: che tên, ngoại hình, bối cảnh, quan hệ, ngữ liệu, dùng hết dữ kiện', () => {
    expect(ENTRY_DEPTH_RULE).toContain('PHÉP THỬ CHE TÊN');
    expect(ENTRY_DEPTH_RULE).toContain('NGOẠI HÌNH');
    expect(ENTRY_DEPTH_RULE).toContain('CẤM so sánh');
    expect(ENTRY_DEPTH_RULE).toContain('BẢN THÂN SỰ VIỆC');
    expect(ENTRY_DEPTH_RULE).toContain('tương tác CỤ THỂ');
    expect(ENTRY_DEPTH_RULE).toContain('NGỮ LIỆU');
    expect(ENTRY_DEPTH_RULE).toContain('DÙNG HẾT dữ kiện');
  });

  it('luật được dán vào lượt tổng hợp nhân vật + thế giới; kiến thức nền nối vào 3 job', () => {
    const SRC = read('../storyDeepScan.ts');
    expect((SRC.match(/\$\{ENTRY_DEPTH_RULE\}/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((SRC.match(/backgroundBlock/g) ?? []).length).toBeGreaterThanOrEqual(4); // khai báo + 3 job
    expect(SRC).toContain('TRUYỆN LÀ CHÂN LÝ');
    expect(SRC).toContain('backgroundInfo?: string');
  });

  it('timeline sinh entry GIAI ĐOẠN: title theo dải ngày, keys là mốc ngày + sự kiện (cat=history để có keys)', () => {
    const SRC = read('../storyDeepScan.ts');
    expect(SRC).toContain('entry GIAI ĐOẠN (cat=history');
    expect(SRC).toContain('keys = CÁC MỐC NGÀY/THÁNG/NĂM');
    expect(SRC).toContain('Dòng thời gian: [mốc đầu] – [mốc cuối]');
  });

  it('UI: có ô kiến thức nền + nút tra wiki nối cascadeSearch', () => {
    const SRC = read('../../../pages/StoryToCardPage.tsx');
    expect(SRC).toContain('fetchWikiBackground');
    expect(SRC).toContain('cascadeSearch(q)');
    expect(SRC).toContain('backgroundInfo:');
  });
});
