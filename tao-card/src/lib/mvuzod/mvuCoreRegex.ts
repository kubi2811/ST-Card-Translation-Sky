/**
 * ─── BỘ REGEX LÕI CỦA MVU ───
 *
 * (User 21/07 — "MVU có 4 file mà card tui mới có 2 cái")
 *
 * Đối chiếu một card MVU THẬT đang chạy được, bộ regex lõi là 2 CẶP + 1:
 *
 *   | Vai trò                        | findRegex                  | placement | cờ           |
 *   |--------------------------------|----------------------------|-----------|--------------|
 *   | Ẩn thanh trạng thái khỏi prompt| <StatusPlaceHolderImpl/>   | [1]       | promptOnly   |
 *   | Render thanh trạng thái        | <StatusPlaceHolderImpl/>   | [2]       | markdownOnly |
 *   | Ẩn bảng khởi đầu khỏi prompt   | <OpeningFormImpl/>         | [1]       | promptOnly   |
 *   | Render bảng khởi đầu           | <OpeningFormImpl/>         | [2]       | markdownOnly |
 *   | Xoá khối <UpdateVariable>      | /<UpdateVariable>…/gm      | [2]       | cả hai       |
 *
 * MỖI GIAO DIỆN CẦN ĐỦ MỘT CẶP:
 * - Thiếu script render → user chỉ thấy mỏ neo trơ, giao diện không bao giờ hiện.
 * - Thiếu script ẩn → mỏ neo lọt vào prompt gửi AI, làm bẩn context từng lượt.
 * Card của user trước đây chỉ có 2 script "Ẩn" nên thiếu đúng 2 vế render.
 */
import type { RegexScript } from '../../types/regex.types';
import { OPENING_FORM_ANCHOR, STATUS_BAR_ANCHOR } from './regexAnchors';

/** Khối biến MVU chèn vào output — phải xoá khỏi phần hiển thị cho người đọc. */
export const UPDATE_VARIABLE_STRIP_REGEX = '/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/gm';

type CoreScript = Omit<RegexScript, 'id'>;

/** Script ẩn mỏ neo khỏi prompt (thay bằng rỗng). */
function hideScript(name: string, anchor: string): CoreScript {
  return {
    scriptName: name,
    findRegex: anchor,
    replaceString: '',
    trimStrings: [],
    placement: [1],
    disabled: false,
    markdownOnly: false,
    promptOnly: true,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  };
}

/** Script thay mỏ neo bằng HTML để hiển thị. */
function renderScript(name: string, anchor: string, html: string): CoreScript {
  return {
    scriptName: name,
    findRegex: anchor,
    replaceString: html,
    trimStrings: [],
    placement: [2],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    // (bug 72) Macro in Find Regex phải TẮT: bật lên thì SillyTavern chạy macro
    // substitution trên cả khối HTML/JS và làm hỏng mọi {{...}} nằm trong code.
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  };
}

/**
 * Dựng bộ regex lõi MVU.
 *
 * (bug 72) Khi chưa có HTML, script render vẫn được sinh nhưng để RỖNG — nó đóng vai chỗ
 * giữ chỗ: che mỏ neo khỏi màn hình (vế ẩn là promptOnly nên chỉ lọc prompt, không lọc
 * hiển thị). Bước Game UI chạy sau sẽ GHI ĐÈ đúng chỗ này theo cặp (mỏ neo + vai trò) —
 * xem `applyParsedDataToCard` case 'game_ui'. Không được để tồn tại 2 script render cùng
 * bám một mỏ neo: cái chạy trước ăn mất, cái sau không tìm thấy gì để thay.
 */
export function buildMvuCoreRegexScripts(opts?: {
  statusBarHtml?: string;
  openingFormHtml?: string;
}): CoreScript[] {
  return [
    hideScript('[AI] Ẩn StatusPlaceHolder', STATUS_BAR_ANCHOR),
    renderScript('[Render] Status Bar', STATUS_BAR_ANCHOR, opts?.statusBarHtml ?? ''),
    hideScript('[AI] Ẩn Opening Form', OPENING_FORM_ANCHOR),
    renderScript('[Render] Opening Form', OPENING_FORM_ANCHOR, opts?.openingFormHtml ?? ''),
    {
      scriptName: '[AI] Loại bỏ khối UpdateVariable',
      findRegex: UPDATE_VARIABLE_STRIP_REGEX,
      replaceString: '',
      trimStrings: [],
      placement: [2],
      disabled: false,
      markdownOnly: true,
      promptOnly: true,
      runOnEdit: false,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
    },
  ];
}
