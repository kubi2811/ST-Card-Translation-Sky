/**
 * buildPayload — ghép giao diện front-end rồi gắn vào thẻ (bug 192).
 *
 * Nạp runtime bằng `?raw` để mã chạy trong quán rượu và mã trong repo là MỘT. Không có
 * bản chép nào cả: `frontend-kit/build.mjs` (dòng lệnh) cũng đọc đúng những file này.
 */
import type { MVUZODSchema, InitVarConfig } from '../../types/mvuzod.types';
import type { RegexScript } from '../../types';
import type { FrontendKitOptions, FrontendBuildResult, StfeConfig } from './types';
import { buildStfeConfig, serializeConfig } from './schemaToConfig';
// Một dòng CÓ CHỦ Ý: chỉ thị @ts-expect-error bám vào dòng ngay dưới nó, mà lỗi thiếu khai
// báo kiểu lại được báo ở dòng chứa tên module — tách nhiều dòng là chỉ thị trượt mục tiêu.
// @ts-expect-error — module JS thuần dùng chung với bộ dựng dòng lệnh, không có khai báo kiểu
import { scanPayload, scanTriggers, fenceBlock, stableId, composePage, openingFindRegex, mainFindRegex } from './payloadRules.js';

import runtimeSrc from './assets/runtime.js?raw';
import openingSrc from './assets/opening.js?raw';
import mainSrc from './assets/main.js?raw';
import themeCss from './assets/theme.css?raw';

export const SCRIPT_NAME_OPENING = '[FE] Màn Khởi Tạo';
export const SCRIPT_NAME_MAIN = '[FE] Màn Chính';

/** Payload không được chứa nguyên văn thẻ mồi của script kia — xem scanTriggers. */
function triggersOf(bootTag: string, updateTag: string): string[] {
  return [`<${bootTag}/>`, `<${bootTag} />`, `</${updateTag}>`];
}

/**
 * Kiểm hai cái thẻ TRƯỚC khi ghép. Sai ở đây thì không có lỗi nào hiện ra: giao diện
 * chỉ đơn giản là không bao giờ xuất hiện, hoặc xuất hiện nhầm chỗ.
 */
export function validateOptions(opts: FrontendKitOptions): string[] {
  const bad: string[] = [];
  const tagOk = (t: string) => /^[A-Za-z_][A-Za-z0-9_]{1,40}$/.test(t || '');

  if (!tagOk(opts.bootTag)) {
    bad.push('Thẻ mở màn rỗng hoặc chứa ký tự lạ — phải là tên kiểu chữ cái, không dấu, không khoảng trắng.');
  }
  if (!tagOk(opts.updateTag)) {
    bad.push('Thẻ cập nhật biến rỗng hoặc chứa ký tự lạ — dò lại trong world info của thẻ.');
  }
  if (opts.bootTag && opts.bootTag === opts.updateTag) {
    bad.push(`Thẻ mở màn và thẻ cập nhật biến trùng nhau ("${opts.bootTag}"). `
      + 'Hai màn hình sẽ tranh nhau cùng một mồi và AI cũng lẫn hai thẻ — đặt tên khác nhau.');
  }
  if (!opts.title.trim()) bad.push('Chưa đặt tên hiển thị.');
  return bad;
}

/** Thẻ mở màn đã xuất hiện sẵn trong nội dung thẻ bài thì màn khởi tạo sẽ bung ra nhầm chỗ. */
export function findBootTagClashes(bootTag: string, cardTexts: string[]): string[] {
  if (!bootTag) return [];
  const re = new RegExp('<' + bootTag + '\\s*/>');
  return cardTexts
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => re.test(String(t || '')))
    .map(({ i }) => `Thẻ mở màn "<${bootTag}/>" đã có sẵn trong nội dung thẻ (vị trí #${i}) — `
      + 'màn khởi tạo sẽ bung ra ở đúng chỗ đó. Đổi sang một tên khác.');
}

export function buildFrontend(
  schema: MVUZODSchema | null,
  initVar: InitVarConfig | null,
  opts: FrontendKitOptions,
): FrontendBuildResult {
  const config: StfeConfig = buildStfeConfig(schema, initVar, opts);
  const configSource = serializeConfig(config);

  const openingHtml = composePage(`Khởi tạo — ${opts.title}`, themeCss, [
    { name: 'config', code: configSource },
    { name: 'runtime.js', code: runtimeSrc },
    { name: 'opening.js', code: openingSrc },
  ]);
  const mainHtml = composePage(opts.title, themeCss, [
    { name: 'config', code: configSource },
    { name: 'runtime.js', code: runtimeSrc },
    { name: 'main.js', code: mainSrc },
  ]);

  const triggers = triggersOf(opts.bootTag, opts.updateTag);
  const violations: string[] = [
    ...validateOptions(opts),
    ...scanPayload(openingHtml, 'Màn Khởi Tạo'),
    ...scanTriggers(openingHtml, triggers, 'Màn Khởi Tạo'),
    ...scanPayload(mainHtml, 'Màn Chính'),
    ...scanTriggers(mainHtml, triggers, 'Màn Chính'),
  ];

  const mk = (name: string, findRegex: string, replaceString: string): RegexScript => ({
    id: stableId(name + opts.bootTag) as string,
    scriptName: name,
    findRegex,
    replaceString,
    trimStrings: [] as string[],
    placement: [2],
    disabled: false,
    // markdownOnly = chỉ chạy ở luồng hiển thị; promptOnly = false nên đống HTML này
    // KHÔNG bao giờ đi ngược vào prompt gửi cho AI.
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  });

  return {
    configSource,
    openingHtml,
    mainHtml,
    violations,
    // (bug 206) Cả hai mồi NUỐT TRỌN tin nhắn — xem openingFindRegex/mainFindRegex.
    scripts: [
      mk(SCRIPT_NAME_OPENING, openingFindRegex(opts.bootTag), fenceBlock(openingHtml)),
      mk(SCRIPT_NAME_MAIN, mainFindRegex(opts.updateTag), fenceBlock(mainHtml)),
    ],
    firstMes: `<${opts.bootTag}/>`,
    sizes: { opening: openingHtml.length, main: mainHtml.length },
  };
}

/**
 * Xếp lại mảng regex của thẻ: hai script [FE] phải đứng ĐẦU.
 *
 * SillyTavern áp regex hiển thị lần lượt trên cùng một chuỗi. Thẻ MVU thường đã có sẵn
 * script xoá khối cập nhật biến khi hiển thị; nó chạy trước thì tới lượt "[FE] Màn Chính"
 * chẳng còn gì để bắt ⇒ không bao giờ có giao diện. Đây đúng là bệnh của bug 175.
 */
export function mergeFrontendScripts(
  existing: RegexScript[],
  fresh: RegexScript[],
): RegexScript[] {
  const kept = (existing || []).filter((s) => !/^\[FE\] /.test(s.scriptName || ''));
  return [...fresh, ...kept];
}

/** Ước lượng dung lượng cho người dùng nhìn. */
export function formatKb(bytes: number): string {
  return (bytes / 1024).toFixed(1) + ' KB';
}
