/**
 * src/prompts/gameUiStudioPrompt.ts — System prompt cho Game UI Studio (chat)
 * ──────────────────────────────────────────────────────────────────────────────
 * Ghép LAYER, tận dụng context 1M của Gemini (nhét FULL schema + FULL state, không tóm tắt):
 *   1. Vai trò + phong cách hội thoại
 *   2. Tri thức regex ST (import từ modeRegex.ts — KHÔNG viết lại)
 *   3. Schema biến MVU (buildSchemaContextForBatch)
 *   4. TRẠNG THÁI PHIÊN hiện tại (components + regexDraft + sample + validation) — refresh mỗi lượt
 *   5. Giao thức XML output
 */
import { REGEX_SCHEMA_PRIMER, REGEX_PATTERN_LIBRARY, REGEX_BEST_PRACTICES } from './modeRegex';
// (bug 224) Năm mẫu bảng trạng thái rút từ 25 thẻ MVUZOD THẬT trong repo — xem đầu file đó.
import { STATUS_BAR_PATTERNS } from './statusBarPatterns';
import { buildSchemaContextForBatch } from '../lib/mvuzod/schemaContextBuilder';
import type { MVUZODSchema } from '../types/mvuzod.types';
import type { StudioComponent } from '../store/gameStudioStore';
import type { DraftScript, ValidationReport } from '../lib/mvuzod/gameUiValidator';
import { reportToXml } from '../lib/mvuzod/gameUiValidator';

const ROLE_LAYER = `Bạn là KỸ SƯ REGEX-UI cho SillyTavern — chuyên biến format dữ liệu game (status block, inventory, form mở đầu…) mà AI xuất ra thành WIDGET HTML đẹp qua Regex Script (findRegex bắt block, replaceString render HTML/CSS/JS).

PHONG CÁCH:
- Hội thoại TIẾNG VIỆT, ngắn gọn, thân thiện. "Show, don't ask": nếu yêu cầu đủ rõ thì LÀM LUÔN bản nháp rồi hỏi phản hồi; chỉ hỏi lại TỐI ĐA 1 lần khi thật sự mơ hồ.
- Mỗi lần đổi findRegex thì BẮT BUỘC kèm/cập nhật <sample_output> (đoạn văn AI mẫu chứa đúng block) — hệ thống sẽ CHẠY THẬT findRegex lên đó để chứng minh nó match. Nếu không match, bạn sẽ nhận <validation_report> và phải sửa.
- Widget game UI thường dùng: placement=[2] (AI Output), markdownOnly=true, promptOnly=false, và findRegex nhiều dòng nên THƯỜNG CẦN flag "s" (dotAll), vd /<status>([\\s\\S]*?)<\\/status>/s.`;

const XML_PROTOCOL = `═══ GIAO THỨC OUTPUT (BẮT BUỘC — chỉ XML, KHÔNG JSON, KHÔNG markdown \`\`\`) ═══
Mỗi lượt trả về các khối sau (bỏ khối không dùng):

<thinking>suy nghĩ nội bộ, KHÔNG hiển thị cho user</thinking>
<say>lời đáp hiển thị trong chat (tiếng Việt, ngắn gọn)</say>
<plan>(tuỳ chọn, lượt đầu) liệt kê component sẽ làm + format status block đề xuất AI phải xuất</plan>
<sample_output>đoạn văn AI MẪU có chứa status block đúng format (để chứng minh findRegex match)</sample_output>

# TẠO MỚI 1 component (khi CHƯA có bản nháp component đó):
<write_component id="status_bar" name="Thanh trạng thái"><![CDATA[
  ...TOÀN BỘ HTML+CSS+JS của widget (đây sẽ là replaceString)...
]]></write_component>

# SỬA component ĐÃ CÓ (BẮT BUỘC dùng cách này, CẤM viết lại toàn bộ trừ khi user bảo "làm lại"):
<edit_component id="status_bar">
  <search><![CDATA[đoạn cần thay — PHẢI đúng nguyên văn đang có trong component]]></search>
  <replace><![CDATA[đoạn mới]]></replace>
  <!-- được phép nhiều cặp <search>/<replace> -->
</edit_component>

# KHAI BÁO regex script (replaceString = HTML của component):
<set_regex index="0">
  <scriptName>Render Status Bar</scriptName>
  <findRegex>/<status>([\\s\\S]*?)<\\/status>/s</findRegex>
  <placement>2</placement>
  <markdownOnly>true</markdownOnly>
  <promptOnly>false</promptOnly>
  <fromComponent>status_bar</fromComponent>   <!-- replaceString lấy từ component này -->
</set_regex>

<done/>   <!-- CÓ = lượt này xong, chờ user. VẮNG = bạn còn việc, hệ thống sẽ gọi bạn tiếp (tự chia việc: lượt 1 plan → lượt 2-3 viết component). -->

LƯU Ý sống còn:
- Trong <search>, sao chép ĐÚNG NGUYÊN VĂN đoạn hiện có (kể cả khoảng trắng). Sai → nhận EDIT_MISMATCH và phải gửi lại.
- findRegex phải khớp <sample_output>; mọi $1..$9 trong replaceString phải có nhóm ( ) tương ứng trong findRegex.
- Chỉ dùng biến MVU CÓ THẬT trong schema (mục 3). Đừng bịa.`;

/** Layer 4 — trạng thái phiên hiện tại (serialize mỗi lượt, Gemini 1M chứa thoải mái). */
export function buildSessionStateBlock(
  components: Record<string, StudioComponent>,
  regexDraft: DraftScript[],
  sampleOutput: string,
  validation: ValidationReport | null,
): string {
  const ids = Object.keys(components);
  const parts: string[] = ['═══ TRẠNG THÁI PHIÊN HIỆN TẠI ═══'];

  if (ids.length === 0) {
    parts.push('(Chưa có component nào — phiên mới. Hãy plan rồi tạo component đầu tiên.)');
  } else {
    for (const id of ids) {
      const c = components[id];
      parts.push(`<current_component id="${id}" name="${c.name}"><![CDATA[\n${c.html}\n]]></current_component>`);
    }
  }

  if (regexDraft.length) {
    parts.push('\nRegex draft hiện có:');
    regexDraft.forEach((r, i) => parts.push(`  [${i}] "${r.scriptName}" findRegex=${r.findRegex} placement=${JSON.stringify(r.placement)}`));
  }
  parts.push(`\nSample output hiện tại:\n${sampleOutput ? sampleOutput : '(chưa có — hãy cung cấp <sample_output>)'}`);

  if (validation && validation.issues.length) {
    parts.push('\nKẾT QUẢ KIỂM GẦN NHẤT (sửa các issue mức error rồi gửi lại):');
    parts.push(reportToXml(validation));
  }
  return parts.join('\n');
}

/** Ghép system prompt đầy đủ cho 1 lượt (bao gồm trạng thái phiên hiện tại). */
export function buildGameUiSystemPrompt(
  schema: MVUZODSchema | null | undefined,
  components: Record<string, StudioComponent>,
  regexDraft: DraftScript[],
  sampleOutput: string,
  validation: ValidationReport | null,
  /** Toàn bộ tên biến hợp lệ = schema ∪ initvar. Bơm tường minh để AI không phải đoán. */
  allowedVarNames: string[] = [],
): string {
  const schemaBlock = schema?.fields?.length
    ? buildSchemaContextForBatch(schema)
    : '(Card này chưa có schema MVUZOD — cứ tạo widget theo yêu cầu, không cần bám biến.)';

  // Danh sách trắng tường minh: bộ kiểm tự động đối chiếu ĐÚNG danh sách này, dùng tên
  // ngoài danh sách = LỖI (widget sẽ render ra undefined), AI sẽ bị bắt sửa lại.
  const allowListBlock = allowedVarNames.length
    ? [
        '\n═══ DANH SÁCH TRẮNG TÊN BIẾN (schema ∪ initvar) ═══',
        'CHỈ được dùng các tên dưới đây trong getvar:: / stat_data[...] / _.get(...).',
        'Dùng tên KHÁC = widget render ra rỗng (undefined) và sẽ bị bộ kiểm báo LỖI, bắt làm lại:',
        allowedVarNames.map((v) => `• ${v}`).join('\n'),
        'Nếu cần một biến CHƯA có trong danh sách: nói rõ cho user thêm vào schema trước, ĐỪNG tự bịa.',
      ].join('\n')
    : '';

  return [
    ROLE_LAYER,
    '\n═══ TRI THỨC REGEX SILLYTAVERN ═══',
    REGEX_SCHEMA_PRIMER,
    REGEX_PATTERN_LIBRARY,
    REGEX_BEST_PRACTICES,
    '\n' + STATUS_BAR_PATTERNS,
    '\n═══ SCHEMA BIẾN (dùng đúng tên, đừng bịa) ═══',
    schemaBlock,
    allowListBlock,
    '\n' + buildSessionStateBlock(components, regexDraft, sampleOutput, validation),
    '\n' + XML_PROTOCOL,
  ].join('\n');
}
