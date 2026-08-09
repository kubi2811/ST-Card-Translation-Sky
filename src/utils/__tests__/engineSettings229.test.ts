/**
 * (bug 229) NÚT "DỊCH LẠI" BỎ QUÊN TOÀN BỘ PROVIDER PHỤ.
 * ─────────────────────────────────────────────────────────────────────────────
 * `apiClient` giữ BỐN thứ ở mức module, ngoài store: danh sách provider phụ, kiểu tên riêng,
 * chế độ Đồng Nhân, và con trỏ round-robin. Trước bản này chỉ HAI vòng lớn nạp chúng —
 * "Bắt đầu dịch" và vòng Mod. Mọi cửa vào khác đi thẳng vào `translateText` với module state
 * còn nguyên giá trị lúc nạp trang, tức RỖNG.
 *
 * Đo được trên máy user (lượt dịch tavernHelper[6], hai provider đều bật, tải lại trang rồi
 * bấm thẳng "Dịch lại mục này"): 31 lượt gọi API DỒN HẾT vào Provider #1; Provider #2 đứng im
 * ở 0/5 RPM, không một token nào. Bảng lane vẫn vẽ đủ hai provider vì nó đọc cấu hình trong
 * store chứ không đọc pool thật — nhìn tưởng chạy hai, thực tế chạy một.
 *
 * Kín hơn nữa: kiểu tên riêng và Đồng Nhân cũng chưa nạp ⇒ một mục dịch lại sau khi F5 ra tên
 * theo mặc định, LỆCH với phần còn lại của thẻ.
 *
 * Đọc mã nguồn để khoá: đường này gọi API thật nên không unit-test trực tiếp được.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../hooks/useTranslation.ts', import.meta.url), 'utf-8')
  .replace(/\r\n/g, '\n');

/** Cắt thân một hàm từ chỗ khai báo tới `}, [` của dep-array useCallback. */
function bodyOf(decl: string): string {
  const i = src.indexOf(decl);
  if (i < 0) throw new Error(`không tìm thấy ${decl}`);
  const end = src.indexOf('\n  }, [', i);
  return src.slice(i, end > 0 ? end : i + 20000);
}

describe('(bug 229) có một chỗ duy nhất nạp cài đặt cấp-engine', () => {
  it('tồn tại syncEngineSettings và nó nạp đủ ba thứ', () => {
    const i = src.indexOf('const syncEngineSettings = useCallback(');
    expect(i, 'chưa có bộ nạp dùng chung').toBeGreaterThan(0);
    const body = src.slice(i, i + 700);
    expect(body).toContain('setExtraProviders(');
    expect(body).toContain('setNameStyle(');
    expect(body).toContain('setFandomMode(');
  });

  it('đọc store TƯƠI (getState) chứ không dùng bản chụp của lần render trước', () => {
    const i = src.indexOf('const syncEngineSettings = useCallback(');
    const body = src.slice(i, i + 700);
    expect(body, 'phải đọc useStore.getState() — closure cũ có thể ôm cấu hình lỗi thời')
      .toContain('useStore.getState()');
  });

  it('KHÔNG tua con trỏ round-robin trong bộ nạp dùng chung', () => {
    // resetProviderPool đưa con trỏ về 0. Đúng khi mở màn một lượt lớn, SAI khi một nút lẻ
    // chen ngang giữa lượt đang chạy — nó dồn lượt kế về lane đầu.
    const i = src.indexOf('const syncEngineSettings = useCallback(');
    const body = src.slice(i, i + 700);
    expect(body).not.toContain('resetProviderPool(');
  });
});

describe('(bug 229) mọi cửa vào có gọi API đều nạp pool', () => {
  const entryPoints = [
    'const retranslateField = useCallback(',
    'const retranslateFieldsBulk = useCallback(',
  ];

  for (const decl of entryPoints) {
    it(`${decl.match(/const (\w+)/)![1]} gọi syncEngineSettings`, () => {
      expect(bodyOf(decl), 'cửa vào này chạy được mà không qua "Bắt đầu dịch" ⇒ phải tự nạp pool')
        .toContain('syncEngineSettings()');
    });
  }

  it('cả ba hàm cài đặt chỉ được GỌI đúng một chỗ — trong bộ nạp dùng chung', () => {
    // Mỗi lời gọi rời rạc là một cơ hội quên một trong ba thứ — đúng cái đã xảy ra: hai vòng
    // lớn nạp đủ, còn ba cửa vào kia không nạp gì.
    expect([...src.matchAll(/setExtraProviders\(/g)].length, 'setExtraProviders bị gọi ở nhiều nơi').toBe(1);
    expect([...src.matchAll(/setNameStyle\(/g)].length, 'setNameStyle bị gọi ở nhiều nơi').toBe(1);
    expect([...src.matchAll(/setFandomMode\(/g)].length, 'setFandomMode bị gọi ở nhiều nơi').toBe(1);
  });

  it('hai vòng lớn vẫn tua round-robin về đầu', () => {
    // syncEngineSettings cố tình không làm việc này, nên vòng lớn phải tự gọi.
    expect([...src.matchAll(/resetProviderPool\(\)/g)].length).toBeGreaterThanOrEqual(3);
  });
});

/**
 * (bug 229b) BỐN KEY MÀ CHỈ KEY #1 CHẠY.
 * Bằng chứng user gửi: bảng lane báo "4 API keys", trần RPM provider #1 là 5/15 (3 key × 5), mà
 * SÁU call đang bay đều ghi `Key #1`. Engine chỉ thấy 1 key vì `callProvider(config, …)` nhận
 * ẢNH CHỤP `store.proxy` lúc vòng dịch khởi động — lúc đó `apiKeys` còn rỗng. Bảng đọc store
 * (sống), engine đọc ảnh chụp (chết). Trần luồng vì thế đứng ở 9 thay vì ~20.
 */
describe('(bug 229b) engine đọc cấu hình provider chính ở dạng SỐNG', () => {
  const api = readFileSync(new URL('../apiClient.ts', import.meta.url), 'utf-8').replace(/\r\n/g, '\n');

  it('apiClient có ô nhận cấu hình sống và buildPool ưu tiên nó', () => {
    expect(api).toContain('export function setMainProviderConfig(');
    expect(api).toMatch(/_toPoolProvider\('default', _liveMainConfig \?\? base\)/);
  });

  it('chưa ai đẩy xuống thì vẫn dùng config của người gọi (không đổi hành vi cũ)', () => {
    expect(api).toMatch(/let _liveMainConfig[^=]*= null/);
  });

  it('React đẩy xuống mỗi khi cấu hình đổi, kể cả GIỮA lượt dịch', () => {
    const i = src.indexOf('setMainProviderConfig({');
    expect(i, 'chưa đẩy cấu hình chính xuống engine').toBeGreaterThan(0);
    // Hiệu ứng phải phụ thuộc store.proxy — nếu không thì thêm key giữa chừng vẫn vô ích.
    expect(src).toMatch(/\[syncEngineSettings, store\.proxy, store\.providers/);
  });

  it('đẩy đủ apiKeys — thiếu nó là quay lại đúng bug một key', () => {
    const body = src.slice(src.indexOf('setMainProviderConfig({'), src.indexOf('setMainProviderConfig({') + 500);
    expect(body).toContain('apiKeys: s.proxy.apiKeys');
  });
});

/**
 * (bug 229c) KEY HỎNG THÌ IM RE.
 * User: "key bị lỗi gì thì có thông báo không thì phải chạy chứ nhỉ, provider 2 im re luôn."
 */
describe('(bug 229c) lỗi key / provider phải báo ra ngoài', () => {
  const api = readFileSync(new URL('../apiClient.ts', import.meta.url), 'utf-8').replace(/\r\n/g, '\n');

  it('có kênh báo cắm được từ tầng React', () => {
    expect(api).toContain('export function setLaneIssueReporter(');
    expect(api).toContain('export interface LaneIssue');
  });

  it('báo cả lỗi TẠM (429/5xx) lẫn lỗi KEY SAI (401/403)', () => {
    // 401/403 không phải lỗi tạm nên không đi qua nhánh recordLaneFailure — dễ bị bỏ sót đúng
    // cái ca "provider im re mà không biết vì sao".
    expect([...api.matchAll(/reportLaneIssue\(/g)].length,
      'phải báo ở CẢ hai nhánh lỗi').toBeGreaterThanOrEqual(3);
    expect(api).toMatch(/!isTransient && \(status === 401 \|\| status === 403\)/);
  });

  it('có chặn spam — một entry 74 mảnh không được đẻ 74 dòng log giống nhau', () => {
    expect(api).toContain('LANE_ISSUE_QUIET_MS');
    expect(api).toMatch(/issue\.failCount > 1 && Date\.now\(\) - last < LANE_ISSUE_QUIET_MS/);
  });

  it('kênh báo hỏng thì KHÔNG được làm chết lượt dịch', () => {
    const i = api.indexOf('function reportLaneIssue(');
    expect(api.slice(i, i + 600)).toMatch(/try \{ _laneIssueReporter\(issue\); \} catch/);
  });

  it('key hiện ra dạng ĐÃ CHE, không lộ nguyên key vào log', () => {
    const i = src.indexOf('setLaneIssueReporter((issue)');
    expect(i, 'React chưa cắm kênh báo').toBeGreaterThan(0);
    const body = src.slice(i, i + 1600);
    expect(body).toContain('issue.keyMasked');
    expect(body).not.toMatch(/issue\.key\b(?!Masked|Label)/);
  });

  it('nói rõ provider nào, model nào, key nào, lỗi gì', () => {
    const body = src.slice(src.indexOf('setLaneIssueReporter((issue)'), src.indexOf('setLaneIssueReporter((issue)') + 1600);
    expect(body).toContain('issue.model');
    expect(body).toContain('issue.keyLabel');
    expect(body).toContain('KEY SAI');
    expect(body).toContain('429');
  });
});
