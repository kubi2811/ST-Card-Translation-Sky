/**
 * (bug 224) "Nghiên cứu thật kỹ việc tạo bảng trạng thái của các card MVUZOD của SillyTavern."
 * ─────────────────────────────────────────────────────────────────────────────
 * Tài liệu STATUS_BAR_PATTERNS được rút từ 25 thẻ THẬT có bảng trạng thái nằm trong repo
 * (bug/116, bug/135, bug/148, bug/153, bug/118…) — đọc regex_scripts của từng thẻ rồi đo mồi,
 * độ dài chuỗi thay thế, cờ, và luồng đặt.
 *
 * Test khoá hai điều: (1) tài liệu có đủ năm mẫu + ba mẹo cú pháp đo được, và (2) nó THẬT SỰ
 * được nhét vào prompt của Game UI Studio — tài liệu không vào prompt thì vô nghĩa.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { STATUS_BAR_PATTERNS } from '../statusBarPatterns';
import { buildGameUiSystemPrompt } from '../gameUiStudioPrompt';

describe('(bug 224) tài liệu bảng trạng thái đủ năm mẫu rút từ thẻ thật', () => {
  it('mẫu A — mồi neo tự đóng <StatusPlaceHolderImpl/>, mẫu đáng tin nhất', () => {
    expect(STATUS_BAR_PATTERNS).toContain('<StatusPlaceHolderImpl/>');
    // Phải nói RÕ điều kiện sống còn: không dạy AI nhả thẻ neo thì bảng không bao giờ hiện.
    expect(STATUS_BAR_PATTERNS).toMatch(/DẠY AI nhả thẻ neo/);
  });

  it('mẫu B/C/D/E đều có mặt', () => {
    expect(STATUS_BAR_PATTERNS).toContain('battle_panel');       // B — thẻ bọc nội dung
    expect(STATUS_BAR_PATTERNS).toMatch(/NHIỀU NHÓM BẮT/);        // C
    expect(STATUS_BAR_PATTERNS).toMatch(/THANH LỰA CHỌN/);        // D
    expect(STATUS_BAR_PATTERNS).toMatch(/think\(\?:ing\)\?/);     // E — làm đẹp khối tư duy
  });

  it('ba mẹo cú pháp đo được đều được ghi lại', () => {
    expect(STATUS_BAR_PATTERNS).toContain('(?!.*<tag>)');            // chỉ khớp lần CUỐI
    expect(STATUS_BAR_PATTERNS).toMatch(/\[\\s\\S\]\*\?/);        // không dùng .*?
    expect(STATUS_BAR_PATTERNS).toMatch(/markdownOnly=true/);         // chỉ lớp hiển thị
    expect(STATUS_BAR_PATTERNS).toMatch(/promptOnly=false/);
  });

  it('có bảng CHỌN MẪU NÀO — không để AI tự đoán', () => {
    expect(STATUS_BAR_PATTERNS).toMatch(/CHỌN MẪU NÀO/);
  });

  it('nêu số đo THẬT (độ dài chuỗi thay thế) chứ không nói chung chung', () => {
    expect(STATUS_BAR_PATTERNS).toMatch(/18\.000[–-]70\.000 ký tự/);
  });

  it('đầu file ghi rõ nguồn: rút từ thẻ thật, kèm đường dẫn bug/ cụ thể', () => {
    const src = readFileSync(new URL('../statusBarPatterns.ts', import.meta.url), 'utf-8');
    expect(src).toMatch(/25 thẻ THẬT/);
    for (const dir of ['bug/116', 'bug/135', 'bug/148', 'bug/153']) {
      expect(src, `thiếu dẫn nguồn ${dir}`).toContain(dir);
    }
  });
});

describe('(bug 224) tài liệu được nhét THẬT vào prompt Game UI', () => {
  it('buildGameUiSystemPrompt chứa nguyên khối năm mẫu', () => {
    const prompt = buildGameUiSystemPrompt(null, {}, [], '', null, []);
    expect(prompt).toContain('NĂM MẪU RÚT TỪ 25 THẺ MVUZOD THẬT');
    expect(prompt).toContain('<StatusPlaceHolderImpl/>');
  });

  it('vẫn giữ nguyên các lớp cũ (tri thức regex + giao thức XML)', () => {
    const prompt = buildGameUiSystemPrompt(null, {}, [], '', null, []);
    expect(prompt).toMatch(/TRI THỨC REGEX SILLYTAVERN/);
    expect(prompt).toMatch(/GIAO THỨC OUTPUT/);
  });

  it('có schema thì danh sách trắng tên biến vẫn được bơm cùng tài liệu', () => {
    const prompt = buildGameUiSystemPrompt(null, {}, [], '', null, ['Nhân vật.Máu']);
    expect(prompt).toContain('DANH SÁCH TRẮNG TÊN BIẾN');
    expect(prompt).toContain('Nhân vật.Máu');
    expect(prompt).toContain('NĂM MẪU RÚT TỪ 25 THẺ MVUZOD THẬT');
  });
});
