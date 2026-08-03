/**
 * Phần dùng chung của bộ dựng front-end dòng lệnh (bug 192).
 *
 * NGUỒN DUY NHẤT nằm trong app: `tao-card/src/lib/frontendKit/`. File này chỉ là lớp vỏ
 * cho Node đọc được — cấm chép lại logic sang đây, vì hai bản sẽ lệch nhau và lệch ở khâu
 * này thì hỏng âm thầm (giao diện vẫn hiện, chỉ là sai).
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

export const KIT_DIR = path.dirname(url.fileURLToPath(import.meta.url));
export const APP_KIT_DIR = path.resolve(KIT_DIR, '..', 'tao-card', 'src', 'lib', 'frontendKit');
export const SRC_DIR = path.join(APP_KIT_DIR, 'assets');

const rules = await import(url.pathToFileURL(path.join(APP_KIT_DIR, 'payloadRules.js')).href);

export const {
  PAYLOAD_RULES, scanPayload, scanTriggers, simulateStDelivery,
  fenceBlock, stableId, composePage,
} = rules;

/** Giữ tên cũ cho quen tay. */
export const fence = fenceBlock;

const read = (f) => fs.readFileSync(path.join(SRC_DIR, f), 'utf8');

export function buildPage(title, cssFiles, jsFiles) {
  return composePage(
    title,
    cssFiles.map(read).join('\n'),
    jsFiles.map((f) => ({ name: f, code: read(f) })),
  );
}

/**
 * Chỉ config + runtime, KHÔNG kèm màn hình nào — để test gọi thẳng vào hàm thật của
 * runtime thay vì chép tay lại logic (chép tay thì test chỉ kiểm bản chép, vô nghĩa).
 */
export function buildRuntimeOnlyJs() {
  return read('examples/eldran.config.js') + '\n' + read('runtime.js');
}

export const ELDRAN = { bootTag: 'EldranBoot', updateTag: 'UpdateVariable' };

/** Những chuỗi mà không payload nào được chứa nguyên văn (xem scanTriggers). */
export const ELDRAN_TRIGGERS = [
  `<${ELDRAN.bootTag}/>`, `<${ELDRAN.bootTag} />`, `</${ELDRAN.updateTag}>`,
];

export function buildEldranPayloads() {
  return {
    opening: buildPage('Khởi tạo — Hành Tinh Eldran', ['theme.css'],
      ['examples/eldran.config.js', 'runtime.js', 'opening.js']),
    main: buildPage('Hành Tinh Eldran', ['theme.css'],
      ['examples/eldran.config.js', 'runtime.js', 'main.js']),
  };
}

/**
 * Script regex CHỈ tác động lên hiển thị.
 *   markdownOnly = true  → chạy ở luồng hiển thị
 *   promptOnly   = false → không bao giờ lọt vào prompt gửi cho AI
 */
export function makeDisplayScript(name, findRegex, replaceString) {
  return {
    id: stableId(name),
    scriptName: name,
    findRegex,
    replaceString,
    trimStrings: [],
    placement: [2],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  };
}

/** Hai script [FE] đã sẵn sàng cắm vào đầu mảng regex_scripts. */
export function buildEldranScripts() {
  const p = buildEldranPayloads();
  return [
    makeDisplayScript('[FE] Màn Khởi Tạo', `<${ELDRAN.bootTag}\\s*/>`, fenceBlock(p.opening)),
    makeDisplayScript('[FE] Màn Chính', `</${ELDRAN.updateTag}>`,
      `</${ELDRAN.updateTag}>\n` + fenceBlock(p.main)),
  ];
}
