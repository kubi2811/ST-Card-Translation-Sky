/**
 * src/utils/presetLibrary.ts — (bug 139) THƯ VIỆN PRESET MẪU nối vào khung chat Tạo Preset.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: nhập/kéo thả NHIỀU preset mẫu (.json/.txt/.yaml/.yml hoặc dán), hệ thống tự phân tích
 * cấu trúc, và MỖI lần chat model tự đọc các preset đang nạp làm ngữ cảnh — để nhờ AI "sửa
 * preset A", "gộp ba preset này", "tạo preset mới theo phong cách preset B"… bằng lời thường.
 *
 * Thiết kế mô-đun, tách khỏi store chính (yêu cầu "giữ nguyên workflow cũ" + "kiến trúc module"):
 *  • Phân tích chạy MỘT LẦN lúc nạp, kết quả (summary) cache theo chữ ký nội dung — preset
 *    không đổi thì không phân tích lại (đúng yêu cầu cache).
 *  • Ngữ cảnh bơm vào chat có NGÂN SÁCH: preset được NHẮC TÊN trong câu hỏi hoặc được GHIM thì
 *    gửi NGUYÊN VĂN; còn lại chỉ gửi tóm tắt cấu trúc — nạp 10 preset không làm nổ context.
 *  • Persist bằng localStorage riêng (st_studio_preset_lib) — không đụng dữ liệu project cũ.
 */

export interface ImportedPreset {
  id: string;
  name: string;
  format: 'json' | 'yaml' | 'text';
  raw: string;
  /** Tóm tắt cấu trúc — dựng 1 lần lúc nạp (cache theo sig). */
  summary: string;
  sig: string;
  pinned: boolean;
  addedAt: number;
}

/** Chữ ký nội dung — đổi nội dung mới phân tích lại. */
export function contentSig(raw: string): string {
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
  return `${raw.length}:${h}`;
}

const isYamlName = (n: string) => /\.(ya?ml)$/i.test(n);

/**
 * PHÂN TÍCH CẤU TRÚC một preset — tất định, không gọi AI.
 * JSON preset SillyTavern: đếm prompts (tên + vai trò), tham số sinh, prompt_order.
 * YAML/text: liệt kê các khoá/heading cấp cao.
 */
export function analyzePreset(name: string, raw: string): { format: ImportedPreset['format']; summary: string } {
  const trimmed = raw.trim();

  // JSON?
  try {
    const j = JSON.parse(trimmed) as Record<string, unknown>;
    const lines: string[] = [];
    const prompts = Array.isArray(j.prompts) ? j.prompts as Array<Record<string, unknown>> : [];
    if (prompts.length) {
      lines.push(`• ${prompts.length} prompt: ${prompts.slice(0, 12).map(p => `"${String(p.name ?? p.identifier ?? '?')}"${p.role ? ` (${p.role})` : ''}`).join(', ')}${prompts.length > 12 ? '…' : ''}`);
      const disabled = prompts.filter(p => p.enabled === false).length;
      if (disabled) lines.push(`• ${disabled} prompt đang tắt`);
    }
    const PARAM_KEYS = ['temperature', 'top_p', 'top_k', 'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'openai_max_tokens', 'max_length'];
    const params = PARAM_KEYS.filter(k => j[k] !== undefined).map(k => `${k}=${j[k]}`);
    if (params.length) lines.push(`• Tham số: ${params.join(', ')}`);
    if (Array.isArray(j.prompt_order)) lines.push('• Có prompt_order (thứ tự lắp prompt)');
    const otherKeys = Object.keys(j).filter(k => !['prompts', 'prompt_order', ...PARAM_KEYS].includes(k)).slice(0, 10);
    if (otherKeys.length) lines.push(`• Trường khác: ${otherKeys.join(', ')}${Object.keys(j).length > 12 ? '…' : ''}`);
    return { format: 'json', summary: lines.join('\n') || '• JSON hợp lệ (không nhận diện được cấu trúc preset ST)' };
  } catch { /* không phải JSON */ }

  // YAML / text: heading + khoá cấp cao.
  const topKeys = [...trimmed.matchAll(/^([A-Za-z_][\w-]{1,40}):/gm)].map(m => m[1]).slice(0, 15);
  const headings = [...trimmed.matchAll(/^#{1,3}\s+(.{2,60})$/gm)].map(m => m[1]).slice(0, 10);
  const lines: string[] = [];
  if (topKeys.length) lines.push(`• Khoá cấp cao: ${[...new Set(topKeys)].join(', ')}`);
  if (headings.length) lines.push(`• Mục: ${headings.join(' / ')}`);
  lines.push(`• ${trimmed.split('\n').length} dòng, ${trimmed.length.toLocaleString()} ký tự`);
  return { format: isYamlName(name) || topKeys.length >= 3 ? 'yaml' : 'text', summary: lines.join('\n') };
}

export function makeImportedPreset(name: string, raw: string): ImportedPreset {
  const { format, summary } = analyzePreset(name, raw);
  return {
    id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.replace(/\.(json|txt|ya?ml|md)$/i, ''),
    format, raw: raw.trim(), summary, sig: contentSig(raw.trim()),
    pinned: false, addedAt: Date.now(),
  };
}

/** Ngân sách ký tự cho khối ngữ cảnh preset (~12k ≈ 3k token). */
const CONTEXT_BUDGET = 48_000;
const FULL_PER_PRESET = 24_000;

/**
 * Dựng khối ngữ cảnh bơm vào MỖI lượt chat:
 *  • Preset được NHẮC TÊN trong câu hỏi hoặc GHIM → NGUYÊN VĂN (cắt trần từng cái).
 *  • Còn lại → tóm tắt cấu trúc (đã cache) — AI vẫn biết có gì để tự xin xem thêm.
 */
export function buildPresetLibraryContext(presets: ImportedPreset[], userText: string): string {
  if (presets.length === 0) return '';
  const ask = userText.toLowerCase();
  const parts: string[] = [
    `═══ THƯ VIỆN PRESET ĐANG NẠP (${presets.length}) ═══`,
    'Người dùng có thể yêu cầu sửa/gộp/tạo mới/chuyển định dạng dựa trên các preset này.',
    'Khi sửa: CHỈ đổi phần liên quan yêu cầu, giữ nguyên phần còn lại. Khi tạo mới: kế thừa cấu trúc tốt nhất, không bịa trường lạ, giữ tương thích SillyTavern.',
  ];
  let used = 0;
  for (const p of presets) {
    const mentioned = ask.includes(p.name.toLowerCase());
    const full = (mentioned || p.pinned) && used + Math.min(p.raw.length, FULL_PER_PRESET) < CONTEXT_BUDGET;
    if (full) {
      const body = p.raw.length > FULL_PER_PRESET ? p.raw.slice(0, FULL_PER_PRESET) + '\n…(cắt bớt)' : p.raw;
      parts.push(`\n── PRESET "${p.name}" (${p.format}${p.pinned ? ', ghim' : ''}) — NGUYÊN VĂN ──\n${body}`);
      used += body.length;
    } else {
      parts.push(`\n── PRESET "${p.name}" (${p.format}) — TÓM TẮT ──\n${p.summary}\n(Nhắc tên "${p.name}" trong câu hỏi để tôi đọc nguyên văn.)`);
      used += p.summary.length;
    }
  }
  return parts.join('\n');
}

/* ─── Persist (localStorage riêng, không đụng store chính) ─── */

const LS_KEY = 'st_studio_preset_lib';

export function loadPresetLibrary(): ImportedPreset[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function savePresetLibrary(presets: ImportedPreset[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(presets)); } catch { /* quota */ }
}

/** Thêm/cập nhật theo tên: cùng tên + nội dung đổi → thay (phân tích lại); trùng y hệt → bỏ qua. */
export function upsertPreset(list: ImportedPreset[], name: string, raw: string): ImportedPreset[] {
  const fresh = makeImportedPreset(name, raw);
  const idx = list.findIndex(p => p.name === fresh.name);
  if (idx < 0) return [...list, fresh];
  if (list[idx].sig === fresh.sig) return list;   // không đổi — giữ cache cũ
  const next = [...list];
  next[idx] = { ...fresh, id: list[idx].id, pinned: list[idx].pinned, addedAt: list[idx].addedAt };
  return next;
}
