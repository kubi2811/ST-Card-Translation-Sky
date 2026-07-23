/**
 * src/hub/updatePlan.ts — QUYẾT ĐỊNH CHỖ NÀO CẦN `npm install` SAU KHI CẬP NHẬT.
 * ─────────────────────────────────────────────────────────────────────────
 * (User 22/07) Bug thật: nút "Cập nhật" trong app chạy
 *     git fetch && git reset --hard && npm install
 * — `npm install` đó CHỈ chạy ở thư mục GỐC. Nhưng repo này là monorepo: Tạo Card, Tạo Preset,
 * Mod Card, Crawler mỗi tool có `package.json` riêng. Vừa rồi thêm `jszip` vào
 * `tao-card/package.json`; user bấm Cập nhật xong mở Tạo Card thì Vite nổ:
 *     Failed to resolve import "jszip" from "src/lib/ai/epubParser.ts"
 * Tool con trắng màn hình, không dùng được. (`update.bat` thì lại làm ĐÚNG — nó lặp qua từng
 * tool. Hai đường cập nhật lệch nhau, đường trong app là đường user hay bấm hơn.)
 *
 * File này là phần THUẦN LOGIC, tách ra để test được: cho biết những thư mục nào cần cài lại,
 * kèm LÝ DO để in ra log cho user hiểu tại sao đang chờ.
 *
 * Không cài mù mọi nơi mỗi lần: 4 lượt `npm install` trên Windows rất lâu. Chỉ cài khi
 * `package.json`/`package-lock.json` của nơi đó ĐỔI trong lần cập nhật này, hoặc `node_modules`
 * chưa có. Không biết gì đổi (không diff được) thì cài hết — thà chậm còn hơn để app hỏng.
 */

export interface InstallTarget {
  /** Đường dẫn tương đối so với gốc repo. '.' là thư mục gốc. */
  dir: string;
  /** Vì sao phải cài lại — in thẳng ra log cập nhật. */
  reason: string;
}

export interface PlanInput {
  /**
   * Danh sách file đổi giữa bản cũ và bản mới (`git diff --name-only OLD NEW`).
   * `null` = không lấy được danh sách ⇒ coi như không biết gì, cài hết cho chắc.
   */
  changedFiles: string[] | null;
  /** Thư mục các tool con, ví dụ ['tao-card', 'preset-tool', 'mod-card', 'crawler']. */
  toolDirs: string[];
  /** Thư mục đó có `package.json` không. */
  hasPackageJson: (dir: string) => boolean;
  /** Thư mục đó đã có `node_modules` chưa. */
  hasNodeModules: (dir: string) => boolean;
}

/** Ghép đường dẫn kiểu git (luôn dùng `/`), '.' nghĩa là gốc. */
function joinRel(dir: string, file: string): string {
  return dir === '.' ? file : `${dir}/${file}`;
}

/** File khai báo phụ thuộc của một thư mục có nằm trong danh sách đổi không. */
function manifestChanged(dir: string, changedFiles: string[]): boolean {
  const pkg = joinRel(dir, 'package.json');
  const lock = joinRel(dir, 'package-lock.json');
  return changedFiles.some(f => {
    const norm = f.replace(/\\/g, '/');
    return norm === pkg || norm === lock;
  });
}

/**
 * Lên danh sách thư mục cần `npm install`. Thư mục gốc luôn được xét đầu tiên vì Hub
 * không chạy được thì chẳng mở được tool nào.
 */
export function planInstallTargets(input: PlanInput): InstallTarget[] {
  const { changedFiles, toolDirs, hasPackageJson, hasNodeModules } = input;
  const targets: InstallTarget[] = [];
  const unknown = changedFiles === null;

  for (const dir of ['.', ...toolDirs]) {
    if (!hasPackageJson(dir)) continue;

    if (!hasNodeModules(dir)) {
      targets.push({ dir, reason: 'chưa có node_modules' });
      continue;
    }
    if (unknown) {
      targets.push({ dir, reason: 'không xác định được thay đổi — cài lại cho chắc' });
      continue;
    }
    if (manifestChanged(dir, changedFiles!)) {
      targets.push({ dir, reason: 'package.json/package-lock.json vừa đổi' });
    }
  }

  return targets;
}

/**
 * Tool con nào cần cài lại thì dev server của nó phải DỪNG trước.
 * Trên Windows, `npm install` không ghi đè được file đang bị tiến trình node giữ — không dừng
 * thì cài xong vẫn thiếu/hỏng thư viện. Dừng rồi user bấm lại tab là nó tự khởi động lại.
 */
export function toolsNeedingRestart(
  targets: InstallTarget[],
  tools: { id: string; dir: string }[],
): string[] {
  const dirs = new Set(targets.map(t => t.dir));
  return tools.filter(t => dirs.has(t.dir)).map(t => t.id);
}

/** Câu tóm tắt in ra đầu bước cài — để user biết đang chờ cái gì. */
export function describeInstallPlan(targets: InstallTarget[]): string {
  if (targets.length === 0) return 'Không có thư viện nào cần cài lại — bỏ qua npm install.';
  const lines = targets.map(t => `  - ${t.dir === '.' ? '(gốc)' : t.dir}: ${t.reason}`);
  return `Cần cài lại thư viện ở ${targets.length} nơi:\n${lines.join('\n')}`;
}
