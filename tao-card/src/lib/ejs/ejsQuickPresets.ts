/**
 * src/lib/ejs/ejsQuickPresets.ts — (bug 126) PRESET NHANH cho người mới chưa biết EJS là gì.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "Nên có thêm 1 số Preset Nhanh ở 'Bạn muốn EJS làm gì?' khi người mới chưa biết gì về
 * EJS. Mỗi Preset thì nêu công dụng của nó khi đưa vào Card, thêm cả Preset áp dụng hết tính
 * năng EJS vào Card. Các Preset Nhanh bạn cần làm kỹ để thích nghi với từng Card và tránh bị lỗi."
 *
 * Chỗ dễ làm ẩu: nhét vài câu mẫu cứng rồi gọi là preset. Câu cứng đưa cho card không có
 * MVUZOD schema, hoặc card đã có sẵn thanh trạng thái, là ra kế hoạch sai ngay — đúng thứ user
 * dặn phải tránh. Nên mỗi preset ở đây là một HÀM DỰNG YÊU CẦU: nó đọc ngữ cảnh card thật
 * (có schema không, biến nào, bao nhiêu entry Constant, đã có UI chưa) rồi viết ra câu yêu cầu
 * bám đúng card đó, và tự nêu điều kiện khi card không đủ dữ kiện để chạy preset.
 */
import type { LorebookEntry } from '../../types';
import type { MVUZODSchema } from '../../types/mvuzod.types';
import { detectActivationMode, detectExistingStatusUi, suggestReclassification, estimateEntryTokens, isMvuCriticalEntry } from './ejsPlanModel';

export interface PresetCardContext {
  schema: MVUZODSchema | null;
  entries: LorebookEntry[];
  regexScripts?: Array<{ scriptName?: string; replaceString?: string }>;
  tavernScripts?: Array<{ name?: string; content?: string }>;
}

export interface QuickPresetResult {
  /** Câu yêu cầu bơm vào ô "Bạn muốn EJS làm gì?" — đã bám ngữ cảnh card thật. */
  goal: string;
  /** Vì sao preset này KHÔNG chạy được với card hiện tại (rỗng = chạy được). */
  blockers: string[];
  /** Điều cần lưu ý nhưng không chặn. */
  notes: string[];
}

/**
 * (bugNeedFix/147) Nhóm chức năng — dùng để xếp preset thành từng cụm trong UI.
 * User: "rút gọn hiển thị mặc định chỉ còn icon + tiêu đề ngắn + 1 dòng mô tả ngắn; phần mô tả
 * chi tiết đưa vào tooltip/expand… bố cục dạng lưới thẻ nhỏ gọn, dễ quét mắt."
 */
export type PresetGroup =
  | 'condition'   // Nội dung theo giai đoạn/điều kiện
  | 'mvu'         // Dữ liệu MVU & hiển thị trạng thái
  | 'ui'          // Giao diện trực quan
  | 'bigdata'     // Xử lý dữ liệu lớn
  | 'dynamic'     // Nội dung động không phụ thuộc chỉ số
  | 'orchestrate' // Điều phối cấp cao
  | 'all';        // Gói tổng

export const PRESET_GROUP_LABEL: Record<PresetGroup, string> = {
  condition: 'Nội dung theo điều kiện',
  mvu: 'Dữ liệu MVU & trạng thái',
  ui: 'Giao diện cho người chơi',
  bigdata: 'Dữ liệu lớn',
  dynamic: 'Nội dung động',
  orchestrate: 'Điều phối cấp cao',
  all: 'Gói tổng',
};

export interface QuickPreset {
  id: string;
  title: string;
  /** Công dụng khi đưa vào card — user mới đọc cái này để chọn (hiện trong tooltip/mở rộng). */
  effect: string;
  /** (bugNeedFix/147) MỘT DÒNG cực ngắn hiện mặc định trên thẻ, để quét mắt nhanh. */
  short: string;
  group: PresetGroup;
  icon: string;
  build: (ctx: PresetCardContext) => QuickPresetResult;
}

// ── Trợ giúp đọc ngữ cảnh ───────────────────────────────────────────────────

function leafPaths(schema: MVUZODSchema | null): string[] {
  const out: string[] = [];
  const walk = (fields: MVUZODSchema['fields'], prefix: string) => {
    for (const f of fields) {
      const name = f.path.split('/').pop() ?? f.path;
      const p = prefix ? `${prefix}.${name}` : name;
      if (f.children?.length) walk(f.children, p);
      else out.push(p);
    }
  };
  if (schema?.fields?.length) walk(schema.fields, '');
  return out;
}

function constantEntries(entries: LorebookEntry[]): LorebookEntry[] {
  return entries.filter(e => detectActivationMode(e) === 'constant');
}

/**
 * (bug 173) Regex nào THẬT SỰ bật được bằng activateRegex().
 * SillyTavern chặn regex ở chế độ cơ bản mà không có giá trị thay thế: "Basic mode regexes must have
 * a string replace value". Gọi activateRegex lên một regex như thế là ném lỗi đỏ ở MỌI lượt chat.
 * Đây là NGUỒN DUY NHẤT cho câu hỏi đó — preset dùng để chặn, và bộ kiểm của agent dùng để bắt lỗi
 * nếu AI vẫn bịa ra tên khác.
 */
export function activatableRegexNames(scripts: PresetCardContext['regexScripts']): string[] {
  return (scripts ?? [])
    .filter((s) => String(s?.scriptName ?? '').trim() && String(s?.replaceString ?? '').length > 0)
    .map((s) => String(s.scriptName).trim());
}

function needSchema(ctx: PresetCardContext): string[] {
  return ctx.schema?.fields?.length
    ? []
    : ['Card chưa có MVUZOD schema — preset này cần biến để chạy. Hãy tạo schema ở tab MVUZOD trước.'];
}

function varList(ctx: PresetCardContext, max = 20): string {
  const l = leafPaths(ctx.schema);
  const head = l.slice(0, max).map(p => `stat_data.${p}`);
  return head.length
    ? head.join(', ') + (l.length > max ? `, … (còn ${l.length - max} biến nữa)` : '')
    : '(chưa có biến nào)';
}

/**
 * (bug 162 mục 3.3–3.6) QUY ƯỚC CHUNG CHO MỌI KHỐI EJS — áp cho CẢ preset chạy lẻ.
 * ─────────────────────────────────────────────────────────────────────────────
 * Bốn mục user nêu sau khi soi kết quả trên card thật đều là MỘT loại lỗi: hai entry EJS trong cùng
 * một card không thống nhất với nhau. Chúng vô hại khi đọc riêng từng entry, nhưng đặt cạnh nhau là
 * so sánh sai giá trị → kích hoạt sai → không có lỗi nào báo.
 *   3.3 tạo dư entry điều khiển gần trùng tên ("Bộ điều khiển EJS" và "… - Mapping Ngữ cảnh").
 *   3.4 ba kiểu default khác nhau cho biến cùng vai trò ('' / 'Chưa rõ' / 'Chưa xác định').
 *   3.5 default '100' dạng CHUỖI cho biến số học, trong khi entry khác đã ép Number() đúng.
 *   3.6 tách entry không đồng đều — dồn phần còn lại vào một entry "Khác" chung, làm loãng chi tiết.
 * Đây là hợp đồng dạng chữ đưa thẳng vào prompt, nên preset lẻ hay gói tổng đều bị ràng như nhau.
 */
export const EJS_HOUSE_RULES: string[] = [
  '• MỘT bộ điều khiển cho MỘT việc: không tạo hai entry điều khiển gần trùng tên (ví dụ "Bộ điều khiển EJS" và "Bộ điều khiển EJS - Mapping Ngữ cảnh"). Cần thêm logic thì SỬA entry điều khiển đã có, không tạo entry mới cạnh nó. Trước khi tạo, kiểm tên đã tồn tại chưa — kể cả trùng gần.',
  '• GIÁ TRỊ MẶC ĐỊNH phải thống nhất trong toàn card, không mỗi entry một kiểu:',
  '   – biến CHỮ: dùng đúng một chuỗi "Chưa rõ" (không dùng \'\' rỗng, không "Chưa xác định", không "N/A" lẫn lộn);',
  '   – biến SỐ : mặc định 0;',
  '   – biến ĐÚNG/SAI: mặc định false.',
  '   Lý do: entry này so sánh với \'\' còn entry kia so với "Chưa rõ" thì điều kiện sai âm thầm, kích hoạt lệch mà không báo lỗi.',
  '• BIẾN SỐ HỌC luôn ép kiểu: Number(getvar(...) ?? 0) — không bao giờ để default dạng chuỗi kiểu \'100\'. So chuỗi với số ("100" > 90 là false) là lỗi im lặng kinh điển.',
  '• TÁCH ENTRY thì tách ĐỀU: mỗi mục có mô tả riêng đủ dày trong bản gốc thì được một entry riêng. Không dồn phần còn lại vào một entry "Khác"/"Còn lại" chung, vì làm vậy là mất chi tiết riêng của từng mục. Chỉ gộp những mục thật sự chỉ có một hai dòng lặt vặt, và khi gộp phải giữ NGUYÊN VĂN nội dung của từng mục, không rút gọn.',
  '• Không dùng chung một tên biến cho hai đường dẫn khác nhau, và không trùng tên entry.',
];

/** Dấu nhận biết bộ quy ước đã được nối vào goal — để không nối hai lần. */
const HOUSE_RULES_MARK = 'QUY ƯỚC CHUNG CHO MỌI KHỐI EJS';

/** Nối bộ quy ước vào goal của preset lẻ (idempotent). */
function withHouseRules(r: QuickPresetResult): QuickPresetResult {
  if (r.goal.includes(HOUSE_RULES_MARK)) return r;
  return { ...r, goal: `${r.goal}\n\n━━ ${HOUSE_RULES_MARK} ━━\n${EJS_HOUSE_RULES.join('\n')}` };
}

// ── Các preset ──────────────────────────────────────────────────────────────

/** Bản GỐC — gói tổng ghép từ danh sách này để bộ quy ước không bị nối lồng 19 lần. */
const RAW_PRESETS: QuickPreset[] = [
  {
    id: 'save-tokens',
    group: 'condition',
    short: 'Hạ bớt entry luôn-bật để đỡ tốn token mỗi lượt.',
    title: 'Tiết kiệm token',
    icon: '💰',
    effect:
      'Rà các entry đang "Luôn bật" — thứ bị nhồi vào MỌI lượt chat và ăn token nhiều nhất — rồi hạ ' +
      'những cái không bắt buộc xuống kích hoạt theo từ khoá hoặc theo biến. Quy tắc xưng hô và thiết ' +
      'lập thế giới cố định vẫn giữ nguyên. Card càng nhiều entry thì càng đáng làm.',
    build: (ctx) => {
      const consts = constantEntries(ctx.entries);
      const sugg = suggestReclassification(ctx.entries, leafPaths(ctx.schema).map(p => p.split('.').pop() ?? p));
      const saved = sugg.reduce((s, r) => s + r.tokensSaved, 0);
      if (consts.length === 0) {
        return {
          goal: '', blockers: ['Card không có entry nào đang để "Luôn bật (Constant)" — không có gì để tiết kiệm.'], notes: [],
        };
      }
      return {
        goal: [
          `Rà soát TOÀN BỘ ${ctx.entries.length} entry của card và tối ưu chế độ kích hoạt để tiết kiệm token.`,
          `Hiện có ${consts.length} entry đang để "Luôn bật (Constant)", tức bị nhồi vào mọi lượt chat.`,
          '',
          'Phân loại theo đúng ba nhóm:',
          '- Entry AI buộc phải biết mọi lượt (quy tắc xưng hô, thiết lập thế giới cố định) → GIỮ Constant.',
          '- Entry chỉ đúng khi một biến MVU đạt điều kiện → chuyển sang kích hoạt theo điều kiện, và',
          '  tạo controller EJS bật entry đó bằng await activewi(tên, true) khi điều kiện đúng.',
          '- Entry chỉ liên quan khi hội thoại nhắc tới (nhân vật phụ, địa điểm, vật phẩm) → chuyển sang',
          '  kích hoạt theo từ khoá, đặt keys sát với cách người chơi thật sẽ gọi tên nó.',
          '',
          'KHÔNG đụng vào entry thuộc bộ máy MVU ([initvar], quy tắc cập nhật biến, danh sách biến,',
          'khối EJS) — đổi chế độ kích hoạt của chúng là phá hệ biến của card.',
          'Liệt kê TỪNG entry một, nêu rõ lý do vì sao hạ cấp được hoặc vì sao phải giữ.',
        ].join('\n'),
        blockers: [],
        notes: sugg.length
          ? [`Máy đã rà sẵn ${sugg.length} entry có thể hạ cấp, ước tính tiết kiệm ~${saved} token mỗi lượt.`]
          : ['Máy chưa tự tìm được entry nào rõ ràng hạ cấp được — AI sẽ soát lại theo nội dung.'],
      };
    },
  },

  {
    id: 'conditional-lore',
    group: 'condition',
    short: 'Lore chỉ mở khi người chơi đạt tới mốc.',
    title: 'Lore hiện theo tiến trình',
    icon: '🔓',
    effect:
      'Tạo bộ điều khiển để lore chỉ mở ra khi người chơi đạt tới mốc tương ứng (cảnh giới, giai đoạn ' +
      'quan hệ, khu vực đang ở…). Người chơi không bị spoil nội dung chưa tới, và AI không phải đọc ' +
      'phần chưa liên quan. Cần card đã có biến MVU.',
    build: (ctx) => {
      const b = needSchema(ctx);
      return {
        goal: b.length ? '' : [
          'Tạo bộ điều khiển EJS mở lore theo tiến trình của người chơi.',
          `Các biến có sẵn của card: ${varList(ctx)}.`,
          '',
          'Hãy tự chọn những biến nào thật sự đánh dấu tiến trình (cảnh giới, giai đoạn quan hệ, khu vực,',
          'chương truyện…), rồi với mỗi mốc: các entry lore thuộc mốc đó để TẮT sẵn, và controller bật',
          'chúng bằng await activewi(tên entry, true) khi biến đạt điều kiện.',
          'BẮT BUỘC: mỗi entry bị tắt phải có ĐÚNG một chỗ trong controller bật nó — entry tắt mà không',
          'ai bật là lore biến mất vĩnh viễn khỏi mọi lượt chat.',
          'Nêu rõ từng entry sẽ bị đổi và mốc tương ứng.',
        ].join('\n'),
        blockers: b,
        notes: [],
      };
    },
  },

  {
    id: 'keyword-npc',
    group: 'condition',
    short: 'NPC/địa điểm hiện đúng lúc được nhắc tới.',
    title: 'NPC/địa điểm theo từ khoá',
    icon: '🔑',
    effect:
      'Chuyển các entry nhân vật phụ, địa điểm, vật phẩm sang kích hoạt theo từ khoá và đặt bộ keys sát ' +
      'với cách người chơi thật sự gọi tên chúng (kể cả tên gọi tắt, biệt danh). Giúp entry hiện đúng lúc ' +
      'thay vì hiện suốt hoặc không bao giờ hiện.',
    build: (ctx) => {
      const cands = ctx.entries.filter(e => {
        const m = detectActivationMode(e);
        return m === 'constant' || (m === 'keyword' && (e.keys ?? []).filter(Boolean).length <= 1);
      });
      if (!cands.length) {
        return { goal: '', blockers: ['Không tìm thấy entry nào cần chỉnh từ khoá — mọi entry đã có bộ keys ổn.'], notes: [] };
      }
      return {
        goal: [
          'Rà các entry mô tả nhân vật phụ, địa điểm, vật phẩm, tổ chức trong card này.',
          'Với mỗi entry loại đó: chuyển sang kích hoạt theo từ khoá (bỏ Constant) và đề xuất bộ keys',
          'đầy đủ — gồm tên chính, tên gọi tắt, biệt danh, và cách gọi mà người chơi Việt hay dùng.',
          'Đừng đặt key quá chung (ví dụ "anh", "cô") vì sẽ kích hoạt bừa. Key của hai entry khác nhau',
          'KHÔNG được trùng hệt hay bao nhau (key "kiếm" của A nằm trong "kiếm khí" của B là nhắc B',
          'cả hai cùng bật) — máy có bộ rà sẽ báo lại các cặp key chồng chéo.',
          `Có ${cands.length} entry đang thuộc diện cần xem lại.`,
        ].join('\n'),
        blockers: [],
        notes: [],
      };
    },
  },

  {
    id: 'status-display',
    group: 'mvu',
    short: 'Chèn khối biến gọn cho AI đọc mỗi lượt.',
    title: 'Hiển thị biến cho AI đọc',
    icon: '📊',
    effect:
      'Chèn một khối gọn liệt kê giá trị biến hiện tại vào prompt, để AI luôn biết chỉ số mới nhất mà ' +
      'không phải đoán. Đây là khối cho AI ĐỌC, khác với thanh trạng thái hiển thị cho người chơi xem.',
    build: (ctx) => {
      const b = needSchema(ctx);
      const ui = detectExistingStatusUi(ctx.entries, ctx.regexScripts ?? [], ctx.tavernScripts ?? []);
      return {
        goal: b.length ? '' : [
          'Tạo một khối EJS chèn giá trị biến hiện tại vào prompt để AI đọc mỗi lượt.',
          `Biến của card: ${varList(ctx, 30)}.`,
          '',
          'Chỉ đưa những biến thật sự ảnh hưởng tới cách AI viết (chỉ số quan hệ, trạng thái, vị trí…),',
          'bỏ qua biến nội bộ. Trình bày ngắn gọn, mỗi biến một dòng.',
          ui.hasStatusUi
            ? 'LƯU Ý: card ĐÃ CÓ giao diện thanh trạng thái cho người chơi — TUYỆT ĐỐI không tạo thêm giao diện mới, khối này chỉ là text cho AI đọc.'
            : '',
        ].filter(Boolean).join('\n'),
        blockers: b,
        notes: ui.hasStatusUi
          ? [`Card đã có thanh trạng thái sẵn (${ui.places[0]}) — preset này chỉ tạo khối text cho AI, không đụng vào giao diện đó.`]
          : [],
      };
    },
  },

  {
    id: 'persona-phase',
    group: 'condition',
    short: 'Tính cách đổi theo mốc chỉ số.',
    title: 'Tính cách đổi theo chỉ số',
    icon: '🎭',
    effect:
      'Nhân vật cư xử khác nhau theo mốc chỉ số — lạnh nhạt khi mới quen, cởi mở khi thân thiết. ' +
      'Thay vì viết cứng một tính cách, khối EJS sẽ chọn đoạn mô tả phù hợp với chỉ số hiện tại.',
    build: (ctx) => {
      const b = needSchema(ctx);
      const nums = leafPaths(ctx.schema);
      if (!b.length && nums.length === 0) {
        b.push('Schema chưa có biến nào để làm mốc.');
      }
      return {
        goal: b.length ? '' : [
          'Tạo khối EJS đổi cách hành xử của nhân vật theo mốc chỉ số.',
          `Biến của card: ${varList(ctx)}.`,
          '',
          'Tự chọn biến số phù hợp nhất làm thang (thiện cảm, tin tưởng, cảnh giới…), chia thành 3-4 mốc,',
          'mỗi mốc một đoạn chỉ dẫn ngắn về giọng điệu và mức độ cởi mở. Chỉ chèn đoạn của mốc hiện tại.',
        ].join('\n'),
        blockers: b,
        notes: [],
      };
    },
  },

  {
    id: 'split-bloated',
    group: 'condition',
    short: 'Tách entry gộp nhiều phần khác điều kiện.',
    title: 'Tách entry gộp',
    icon: '🪓',
    effect:
      'Rà các entry đang nhồi nhiều phần có ĐIỀU KIỆN KÍCH HOẠT KHÁC NHAU (15 sự kiện trong năm chung ' +
      '1 entry, mọi địa điểm chung 1 entry…) và tách thành entry riêng — mỗi phần kích hoạt đúng thời ' +
      'điểm của nó. Kế hoạch tách hiện đầy đủ tên từng phần để duyệt trước; tham chiếu getwi được máy tự vá.',
    build: (ctx) => {
      // Ứng viên đo tất định: entry dài, nhiều dòng, không thuộc bộ máy MVU.
      const cands = ctx.entries.filter(e =>
        !isMvuCriticalEntry(e)
        && estimateEntryTokens(e) >= 300
        && String(e.content ?? '').split('\n').filter(l => l.trim()).length >= 5);
      if (!cands.length) {
        return { goal: '', blockers: ['Không thấy entry nào đủ dài/nhiều phần để đáng tách — card đang gọn.'], notes: [] };
      }
      return {
        goal: [
          'Rà các entry đang GỘP nhiều phần có điều kiện kích hoạt khác nhau và đề xuất TÁCH (action split_entry).',
          `Ứng viên máy đo được (dài ≥ ~300 token, nhiều đoạn): ${cands.slice(0, 8).map(e => `"${e.comment || `#${e.id}`}"`).join(', ')}${cands.length > 8 ? ` … và ${cands.length - 8} entry nữa` : ''}.`,
          '',
          'Luật tách:',
          '- CHỈ tách khi các phần có điều kiện kích hoạt khác nhau và độc lập (mốc thời gian, địa điểm,',
          '  giai đoạn…). Nội dung luôn đi cùng nhau thì GIỮ CHUNG — không chia vụn.',
          '- Khai rõ splitInto: tên từng entry con + chế độ kích hoạt + điều kiện của phần đó.',
          '- Phần chuyển sang kích hoạt theo điều kiện biến thì phải có controller bật nó.',
          'Entry không đáng tách thì bỏ qua và không cần nêu.',
        ].join('\n'),
        blockers: [],
        notes: [`Máy đo được ${cands.length} entry đủ dài để xem xét — AI sẽ tự quyết cái nào thật sự đáng tách.`],
      };
    },
  },

  // ── (Goal 28/07) Nhóm tính năng MVU ──────────────────────────────────────

  {
    id: 'mvu-sanitize',
    group: 'mvu',
    short: 'Nắn giá trị biến lệch về đúng khuôn mỗi lượt.',
    title: 'Chuẩn hoá dữ liệu MVU',
    icon: '🧹',
    effect:
      'Khối EJS kiểm tra giá trị biến mỗi lượt và sửa GIÁ TRỊ đang lệch: số vượt miền cho phép, ' +
      'enum sai chính tả, kiểu bị đổi (số thành chữ). KHÔNG sửa schema — chỉ nắn giá trị về đúng ' +
      'khuôn đã khai, để lỗi AI viết bậy không tích luỹ qua các lượt.',
    build: (ctx) => {
      const b = needSchema(ctx);
      return {
        goal: b.length ? '' : [
          'Tạo khối EJS "chuẩn hoá dữ liệu MVU" chạy mỗi lượt (@@preprocessing):',
          `Biến của card: ${varList(ctx, 30)}.`,
          '',
          '- Với biến SỐ có miền (min/max/enum đã khai trong schema): giá trị vượt miền thì setvar về',
          '  đúng biên gần nhất; NaN/chuỗi thì đưa về giá trị hợp lệ gần nhất có thể suy ra.',
          '- Với biến ENUM: giá trị không nằm trong danh sách thì đối chiếu gần đúng (sai hoa thường,',
          '  thừa khoảng trắng) rồi setvar về giá trị chuẩn; không suy ra được thì GIỮ NGUYÊN và bỏ qua.',
          '- TUYỆT ĐỐI không đổi schema, không đổi tên biến, không đụng biến đang hợp lệ.',
          '- Khối chạy im lặng, không chèn chữ nào vào prompt.',
        ].join('\n'),
        blockers: b,
        notes: ['Chỉ sửa giá trị lệch — schema và biến hợp lệ không bị đụng.'],
      };
    },
  },

  {
    id: 'mvu-summary',
    group: 'mvu',
    short: 'Diễn giải trạng thái thành vài câu cho AI.',
    title: 'Tóm tắt trạng thái cho AI',
    icon: '📝',
    effect:
      'Thay vì đổ nguyên cây biến vào prompt, khối EJS diễn giải trạng thái thành vài câu tự nhiên ' +
      '("đang kiệt sức", "quan hệ ở mức thân thiết") — AI đọc hiểu nhanh hơn và tốn ít token hơn ' +
      'so với bảng số khô.',
    build: (ctx) => {
      const b = needSchema(ctx);
      return {
        goal: b.length ? '' : [
          'Tạo khối EJS tóm tắt trạng thái nhân vật thành VĂN cho AI đọc mỗi lượt:',
          `Biến của card: ${varList(ctx, 30)}.`,
          '',
          '- Chọn các biến ảnh hưởng nhất tới cách viết (quan hệ, trạng thái cơ thể, vị trí, giai đoạn).',
          '- Diễn giải thành 2-4 câu tự nhiên theo MỨC (ví dụ HP thấp → "đang bị thương nặng"),',
          '  không liệt kê con số khô trừ khi con số tự nó có nghĩa (tiền, ngày).',
          '- Chèn qua injectPrompt ở vị trí phù hợp, ngắn gọn tối đa.',
        ].join('\n'),
        blockers: b,
        notes: [],
      };
    },
  },

  {
    id: 'mvu-watchdog',
    group: 'mvu',
    short: 'Nhắc AI khi chỉ số vượt/tụt qua ngưỡng.',
    title: 'Cảnh báo ngưỡng chỉ số',
    icon: '🚨',
    effect:
      'Khi một chỉ số vượt/tụt qua ngưỡng đáng chú ý (HP sắp cạn, thiện cảm chạm mốc mới, hết tiền), ' +
      'khối EJS nhắc AI đúng một câu chỉ dẫn để cảnh đó được phản ánh trong lời kể — thay vì AI ' +
      'bỏ qua con số.',
    build: (ctx) => {
      const b = needSchema(ctx);
      return {
        goal: b.length ? '' : [
          'Tạo khối EJS "cảnh báo ngưỡng" cho các chỉ số quan trọng:',
          `Biến của card: ${varList(ctx, 30)}.`,
          '',
          '- Tự chọn 3-5 ngưỡng đáng kể dựa trên miền giá trị trong schema (cạn máu, chạm mốc quan hệ,',
          '  hết tài nguyên…). Mỗi ngưỡng một câu chỉ dẫn NGẮN chèn vào prompt chỉ KHI điều kiện đúng.',
          '- Không ngưỡng nào đúng thì khối không chèn gì cả.',
        ].join('\n'),
        blockers: b,
        notes: [],
      };
    },
  },

  {
    id: 'mvu-delta',
    group: 'mvu',
    short: 'Cho AI biết cái gì vừa tăng/giảm so lượt trước.',
    title: 'Diễn giải thay đổi chỉ số',
    icon: '📈',
    effect:
      'So giá trị hiện tại với lượt trước (lưu bản chụp bằng biến message) và nói cho AI biết cái gì ' +
      'vừa TĂNG/GIẢM — AI phản ánh được diễn biến ("vừa mất nhiều máu", "thiện cảm tăng vọt") thay vì ' +
      'chỉ thấy con số tĩnh.',
    build: (ctx) => {
      const b = needSchema(ctx);
      return {
        goal: b.length ? '' : [
          'Tạo khối EJS "diễn giải thay đổi chỉ số giữa các lượt":',
          `Biến của card: ${varList(ctx, 20)}.`,
          '',
          '- Mỗi lượt: đọc giá trị hiện tại của 3-6 biến số quan trọng, so với bản chụp lượt trước',
          '  (lưu bằng setMessageVar/getMessageVar), rồi chèn 1-2 câu nêu thay đổi đáng kể',
          '  ("HP giảm mạnh từ 80 xuống 35"). Thay đổi nhỏ hoặc không đổi thì im lặng.',
          '- Sau khi so xong, cập nhật bản chụp bằng giá trị hiện tại.',
        ].join('\n'),
        blockers: b,
        notes: [],
      };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // (bugNeedFix/147) NHÓM 3-6 — bổ sung theo bản đặc tả user gửi.
  // Mỗi preset vẫn tự đo ngữ cảnh card thật (có schema chưa, đã có UI chưa, dữ liệu có phình
  // không) rồi mới dựng yêu cầu — không phải chuỗi cứng.
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Nhóm 3: Giao diện trực quan ──
  {
    id: 'ui-hud',
    group: 'ui',
    short: 'Thanh máu/mana có màu cho NGƯỜI CHƠI xem.',
    title: 'Thanh trạng thái đồ hoạ (HUD)',
    effect: 'Dựng thanh trạng thái dạng đồ hoạ thật (thanh máu/mana/thiện cảm có màu, badge trạng thái) bằng @@iframe + HTML/CSS, đọc trực tiếp giá trị biến MVU. Khác hẳn "Hiển thị biến cho AI đọc" — cái này CHO NGƯỜI CHƠI XEM, không gửi cho AI, dùng @@render_after nên không tốn token của AI.',
    icon: '🖥️',
    build: (ctx) => {
      const hasSchema = !!ctx.schema?.fields?.length;
      const ui = detectExistingStatusUi(ctx.entries, ctx.regexScripts ?? [], ctx.tavernScripts ?? []);
      const nums = leafPaths(ctx.schema).slice(0, 6);
      const blockers: string[] = [];
      if (!hasSchema) blockers.push('Chưa có MVUZOD schema — HUD không biết đọc biến nào.');
      const notes: string[] = [];
      if (ui.hasStatusUi) notes.push(`Thẻ ĐÃ có thanh trạng thái (${ui.places[0]}) — preset sẽ dặn AI bổ sung phần Regex không làm được (tính %, đổi màu theo ngưỡng) thay vì dựng cái mới đè lên.`);
      return {
        goal: [
          'Dựng THANH TRẠNG THÁI ĐỒ HOẠ cho NGƯỜI CHƠI xem (không gửi cho AI).',
          '- Dùng @@render_after + @@iframe, HTML/CSS nhúng trong entry; đọc giá trị bằng getvar.',
          nums.length ? `- Chỉ số nên vẽ thành thanh: ${nums.join(', ')}.` : '',
          '- Thanh có màu đổi theo ngưỡng (đầy → xanh, thấp → đỏ); kèm badge cho trạng thái dạng chữ.',
          '- KHÔNG ghi ngược vào biến MVU, chỉ đọc để hiển thị.',
          ui.hasStatusUi
            ? `- LƯU Ý: thẻ đã có thanh trạng thái sẵn (${ui.places.join(', ')}). KHÔNG tạo cái mới hiển thị cùng dữ liệu — chỉ bổ sung phần Regex không làm được.`
            : '',
        ].filter(Boolean).join('\n'),
        blockers, notes,
      };
    },
  },
  {
    id: 'ui-panel',
    group: 'ui',
    short: 'Thêm nút bấm/tab ngay trong thanh trạng thái.',
    title: 'Bảng điều khiển tương tác',
    effect: 'Thêm nút bấm/toggle ngay trong thanh trạng thái (thu gọn chi tiết, chuyển tab xem nhiều nhân vật) bằng JS nhúng trong iframe — vẫn chỉ ĐỌC dữ liệu qua biến, không ghi ngược vào MVU.',
    icon: '🎛️',
    build: (ctx) => {
      const ui = detectExistingStatusUi(ctx.entries, ctx.regexScripts ?? [], ctx.tavernScripts ?? []);
      // (bug 162 phần 2) TỰ CHẠY ĐƯỢC MỘT MÌNH.
      // Bản cũ chặn thẳng: 'Thẻ chưa có thanh trạng thái nào để gắn nút — chạy preset "Thanh trạng
      // thái đồ hoạ" trước.' Đó đúng là thứ user cấm: "19 preset phải hoàn toàn độc lập, mỗi cái tự
      // chạy được từ đầu đến cuối một mình, không phụ thuộc phải chạy chung với preset khác".
      // Thẻ chưa có thanh trạng thái thì preset này TỰ dựng một thanh tối giản rồi gắn nút lên,
      // chứ không đẩy việc sang preset khác. Vẫn chặn nếu thiếu schema — cái đó là thiếu DỮ LIỆU
      // đầu vào, không phải phụ thuộc preset khác, và không có biến thì chẳng có gì để hiện.
      const goal = [
        'Thêm BẢNG ĐIỀU KHIỂN TƯƠNG TÁC vào thanh trạng thái:',
        '- Nút thu gọn/mở rộng phần chi tiết; nếu có nhiều nhân vật thì thêm tab chuyển qua lại.',
        '- JS nhúng trong @@iframe, chỉ thao tác DOM bên trong iframe.',
        '- KHÔNG ghi ngược vào biến MVU (trừ khi có cơ chế sendPrompt rõ ràng) — tránh làm lệch dữ liệu.',
      ];
      if (ui.hasStatusUi) {
        goal.push(`- Thẻ ĐÃ CÓ thanh trạng thái (${ui.places[0]}) — gắn nút vào CHÍNH cái đó, tuyệt đối không tạo thanh mới song song.`);
      } else {
        goal.push(
          '- Thẻ CHƯA có thanh trạng thái: preset này tự dựng luôn một thanh tối giản (chỉ khung + vài',
          `  chỉ số chính từ ${varList(ctx, 6)}) rồi gắn nút lên đó. Không đòi người dùng chạy preset khác trước.`,
          '- Thanh tự dựng phải để sẵn chỗ mở rộng, để sau này chạy preset "Thanh trạng thái đồ hoạ" thì',
          '  nó SỬA cái này chứ không tạo thêm cái thứ hai.',
        );
      }
      return {
        goal: goal.join('\n'),
        blockers: needSchema(ctx),
        notes: ui.hasStatusUi ? [] : ['Thẻ chưa có thanh trạng thái — preset sẽ tự dựng một thanh tối giản để gắn nút.'],
      };
    },
  },

  // ── Nhóm 4: Xử lý dữ liệu lớn ──
  {
    id: 'ctx-compress',
    group: 'bigdata',
    short: 'Nhánh dữ liệu phình to chỉ tả kỹ phần đang liên quan.',
    title: 'Lọc / nén ngữ cảnh động',
    effect: 'Với các nhánh dữ liệu có thể phình to (danh sách NPC phụ, sự kiện, vật phẩm, tổ chức), khối EJS tự chọn nhóm "đang liên quan" để mô tả đầy đủ, nhóm còn lại chỉ tóm tắt một dòng — AI vẫn nhận biết thực thể cũ mà không tốn token mô tả lại toàn bộ.',
    icon: '🗂️',
    build: (ctx) => {
      const hasSchema = !!ctx.schema?.fields?.length;
      return {
        goal: [
          'Tạo khối EJS LỌC/NÉN NGỮ CẢNH cho các nhánh dữ liệu có thể phình to:',
          '- Chọn ra nhóm "đang liên quan" (được nhắc trong vài tin nhắn gần nhất, hoặc đang ở cùng khu vực) → mô tả đầy đủ.',
          '- Nhóm còn lại chỉ in một dòng: mã + tên + tóm tắt ngắn, để AI vẫn biết thực thể đó tồn tại.',
          '- Dùng matchChatMessages để biết cái gì đang được nhắc tới.',
        ].join('\n'),
        blockers: hasSchema ? [] : ['Chưa có MVUZOD schema — không biết nhánh dữ liệu nào để nén.'],
        notes: [],
      };
    },
  },
  {
    id: 'data-cleanup',
    group: 'bigdata',
    short: 'Nhắc AI dọn dữ liệu khi danh sách vượt ngưỡng.',
    title: 'Tự động dọn dẹp khi vượt ngưỡng',
    effect: 'Tạo entry chỉ tự kích hoạt khi một nhánh dữ liệu vượt số lượng cho phép (ví dụ quá 20 sự kiện đang hoạt động), chứa quy tắc: cái gì bắt buộc giữ, cái gì có thể gộp, cái gì nên xoá — tránh biến MVU phình vô hạn qua hàng trăm lượt chat.',
    icon: '🧹',
    build: (ctx) => {
      const hasSchema = !!ctx.schema?.fields?.length;
      return {
        goal: [
          'Tạo khối EJS TỰ ĐỘNG DỌN DẸP dữ liệu lớn:',
          '- Chỉ kích hoạt khi một nhánh vượt ngưỡng số lượng (tự chọn ngưỡng hợp lý theo schema).',
          '- Nội dung là QUY TẮC cho AI: cái gì bắt buộc giữ, cái gì gộp được, cái gì nên xoá.',
          '- TRƯỚC khi bảo xoá một thực thể, phải dặn AI quét và dọn mọi tham chiếu tới nó — xoá trống tay sẽ để lại tham chiếu gãy.',
        ].join('\n'),
        blockers: hasSchema ? [] : ['Chưa có MVUZOD schema — không biết nhánh nào có thể phình to.'],
        notes: [],
      };
    },
  },

  // ── Nhóm 5: Nội dung động ──
  {
    id: 'dyn-random',
    group: 'dynamic',
    short: 'Thời tiết/sự kiện bất ngờ sinh ngay lúc chạy.',
    title: 'Sinh giá trị động',
    effect: 'Chèn thời gian thực, số ngẫu nhiên, hoặc lựa chọn ngẫu nhiên có trọng số vào prompt (thời tiết đổi ngẫu nhiên, sự kiện bất ngờ theo xác suất) — nội dung không tồn tại sẵn ở đâu, được tạo ngay lúc chạy.',
    icon: '🎲',
    build: () => ({
      goal: [
        'Tạo khối EJS SINH GIÁ TRỊ ĐỘNG:',
        '- Dùng _.random / _.sample để chọn ngẫu nhiên có trọng số (thời tiết, sự kiện nhỏ, tin đồn).',
        '- Có thể lấy thời gian thực để đổi không khí theo giờ.',
        '- In ra dạng gợi ý ngắn cho AI, KHÔNG ép AI phải dùng.',
      ].join('\n'),
      blockers: [], notes: [],
    }),
  },
  {
    id: 'dyn-timing',
    group: 'dynamic',
    short: 'Entry chỉ hiện sau N lượt hoặc khi chat nhắc tới.',
    title: 'Kích hoạt theo thời gian / số lượt',
    effect: 'Entry chỉ xuất hiện sau N lượt chat, sau một giờ nhất định (thời gian thật), hoặc khi quét thấy từ khoá/mẫu trong vài tin nhắn gần nhất — thông minh hơn cơ chế đèn xanh lá gốc.',
    icon: '🕓',
    build: () => ({
      goal: [
        'Tạo bộ điều khiển KÍCH HOẠT THEO THỜI GIAN / SỐ LƯỢT:',
        '- Đếm số lượt bằng getChatMessages, bật entry khi vượt mốc.',
        '- Hoặc quét từ khoá trong 2-3 tin gần nhất bằng matchChatMessages rồi bật entry tương ứng.',
        '- Entry được bật phải để TẮT SẴN trong cấu hình; bật bằng await activewi(tên, true).',
      ].join('\n'),
      blockers: [], notes: [],
    }),
  },

  // ── Nhóm 6: Điều phối cấp cao ──
  {
    id: 'orch-dynkeys',
    group: 'orchestrate',
    short: 'Sinh từ khoá theo biến để mồi entry đèn xanh.',
    title: 'Từ khoá động',
    effect: 'Entry tự sinh chuỗi từ khoá dựa trên biến số, dùng chuỗi đó làm "mồi" kích hoạt entry đèn xanh lá khác có từ khoá trùng — kết hợp được cơ chế EJS với cơ chế keyword gốc thay vì phải chọn một trong hai.',
    icon: '🔑',
    build: (ctx) => ({
      goal: [
        'Tạo khối @@preprocessing SINH TỪ KHOÁ ĐỘNG:',
        '- Đọc biến hiện tại rồi in ra chuỗi từ khoá tương ứng, làm mồi cho entry đèn xanh lá khớp key.',
        '- Entry được mồi KHÔNG được đồng thời bị getwi gọi trực tiếp ở nơi khác — tránh kích hoạt hai đường cùng lúc.',
      ].join('\n'),
      blockers: ctx.schema?.fields?.length ? [] : ['Chưa có MVUZOD schema — không có biến để sinh từ khoá.'],
      notes: [],
    }),
  },
  {
    id: 'orch-inject',
    group: 'orchestrate',
    short: 'Soạn nội dung ở Worldbook, hút vào đúng chỗ trong Preset.',
    title: 'Đồng bộ Worldbook ↔ Preset',
    effect: 'Dùng injectPrompt() để soạn nội dung (ví dụ khối chuỗi suy luận) trong Worldbook rồi "hút" đúng vào vị trí đã định trong Preset — khỏi phải sửa Preset mỗi lần đổi nội dung Worldbook.',
    icon: '🔗',
    build: () => ({
      goal: [
        'Tạo khối EJS ĐỒNG BỘ WORLDBOOK → PRESET:',
        '- Soạn nội dung trong entry worldbook, đẩy vào prompt bằng injectPrompt({ text, position, depth }).',
        '- Ghi rõ vị trí/độ sâu để nội dung rơi đúng chỗ mong muốn trong preset.',
      ].join('\n'),
      blockers: [], notes: [],
    }),
  },
  {
    id: 'orch-postfix',
    group: 'orchestrate',
    short: 'Dọn output SAU khi AI trả lời (xoá khối thừa, sửa link).',
    title: 'Sửa output sau khi AI trả lời',
    effect: 'Dùng activateRegex() để xử lý HẬU KỲ: xoá khối suy luận thừa, thay link ảnh hỏng, chuẩn hoá định dạng — chạy SAU khi AI đã trả lời, khác hẳn mọi preset khác vốn chỉ xử lý TRƯỚC khi gửi.',
    icon: '🩹',
    // (bug 173) Chốt chặn cũ chỉ hỏi "thẻ CÓ regex nào không", không hỏi "regex đó có BẬT ĐƯỢC
    // không". SillyTavern từ chối bật regex chế độ cơ bản mà replaceString rỗng — nên khối EJS sinh
    // ra chạy là ném đỏ "Basic mode regexes must have a string replace value", mỗi lượt chat một
    // lần. Nay chỉ chạy khi có regex thật sự bật được, và nêu ĐÍCH DANH tên hợp lệ cho AI.
    build: (ctx) => {
      const ok = activatableRegexNames(ctx.regexScripts);
      const all = (ctx.regexScripts ?? []).length;
      return {
        goal: [
          'Tạo khối EJS XỬ LÝ HẬU KỲ output của AI:',
          `- Dùng activateRegex() để bật regex sau khi AI trả lời. CHỈ được bật đúng các tên sau: ${ok.map((n) => `"${n}"`).join(', ')}.`,
          '- KHÔNG bịa tên regex, không đoán tên khác: gọi activateRegex với tên không có thật (hoặc regex chưa có giá trị thay thế) sẽ ném lỗi đỏ ở MỌI lượt chat.',
          '- Mục tiêu: xoá khối suy luận thừa, chuẩn hoá định dạng, sửa link hỏng.',
          '- KHÔNG đụng tới nội dung kể chuyện của AI.',
        ].join('\n'),
        blockers: ok.length ? [] : [
          all
            ? `Thẻ có ${all} regex nhưng không cái nào bật được — regex ở chế độ cơ bản phải có giá trị thay thế (replaceString) thì SillyTavern mới cho bật. Điền replaceString ở tab Regex Lab trước.`
            : 'Thẻ chưa có regex nào để bật — tạo regex ở tab Regex Lab trước.',
        ],
        notes: all > ok.length
          ? [`${all - ok.length} regex bị bỏ qua vì chưa có giá trị thay thế (replaceString rỗng) — bật chúng sẽ lỗi.`]
          : [],
      };
    },
  },

  {
    id: 'full-suite',
    group: 'all',
    short: 'Rà cả thẻ và áp mọi tính năng EJS theo đúng thứ tự.',
    title: 'Áp dụng TẤT CẢ tính năng EJS',
    icon: '🚀',
    effect:
      'Gói tổng: tối ưu token cho toàn bộ entry, mở lore theo tiến trình, chỉnh từ khoá cho NPC/địa điểm, ' +
      'chèn khối biến cho AI đọc, và đổi tính cách theo chỉ số. Nên chạy khi card đã tương đối hoàn chỉnh ' +
      'vì kế hoạch sẽ dài — bạn vẫn duyệt được từng dòng trước khi chạy.',
    // (bug 162 phần 2) DỰNG TỪ CHÍNH 19 PRESET CON, KHÔNG VIẾT TAY SONG SONG.
    // Bản cũ liệt kê tay đúng 7 mục (user đếm ra "7/19" — đếm đúng): thiếu hẳn status-display,
    // mvu-delta, ui-hud, ui-panel, ctx-compress, data-cleanup, dyn-random, dyn-timing,
    // orch-dynkeys, orch-postfix. Đó là hệ quả tất yếu của việc có HAI nguồn sự thật: mỗi lần thêm
    // preset con thì phải nhớ sửa cả gói tổng, và không ai nhớ.
    // Nay gói tổng gọi build() của từng preset con rồi ghép lại → thêm preset thứ 20 là nó tự có
    // mặt, không thể lệch lại được. Preset nào KHÔNG áp được cho card này (blockers) thì bỏ và nói
    // rõ vì sao — đúng yêu cầu "việc nào card không cần thì bỏ và giải thích".
    build: (ctx) => buildFullSuite(ctx),
  },
];

/** Vì sao một preset bị bỏ khỏi gói tổng — hiện thẳng cho user, không im lặng. */
export interface SkippedPreset { id: string; title: string; reason: string }

export interface FullSuiteBreakdown {
  applied: QuickPreset[];
  skipped: SkippedPreset[];
}

/**
 * Danh sách preset dùng cho UI — mỗi preset lẻ đã được nối bộ quy ước chung.
 * Phải nối ở đây chứ không nối trong từng build(): yêu cầu của user là "19 preset phải hoàn toàn
 * độc lập, mỗi cái tự chạy được một mình mà không lỗi", nên preset chạy LẺ cũng phải chịu đúng
 * những ràng buộc mà gói tổng áp — không thì chạy lẻ ra kết quả lệch chuẩn so với chạy gói.
 */
export const QUICK_PRESETS: QuickPreset[] = RAW_PRESETS.map((p) =>
  p.group === 'all' ? p : { ...p, build: (ctx: PresetCardContext) => withHouseRules(p.build(ctx)) },
);

/** 19 preset riêng lẻ — mọi thứ trừ gói tổng. Một nguồn sự thật duy nhất. */
export function individualPresets(): QuickPreset[] {
  return RAW_PRESETS.filter((p) => p.group !== 'all');
}

/**
 * (bug 162 phần 2) Preset nào áp được cho card này, preset nào không.
 * Dùng CHÍNH blockers của từng preset con làm điều kiện — không đoán lại lần thứ hai, nên gói tổng
 * và preset lẻ luôn nói cùng một điều về cùng một card.
 */
export function fullSuiteBreakdown(ctx: PresetCardContext): FullSuiteBreakdown {
  const applied: QuickPreset[] = [];
  const skipped: SkippedPreset[] = [];
  for (const p of individualPresets()) {
    let r: QuickPresetResult | null = null;
    try { r = p.build(ctx); } catch (e) {
      skipped.push({ id: p.id, title: p.title, reason: `lỗi khi dựng: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    if (r.blockers.length) skipped.push({ id: p.id, title: p.title, reason: r.blockers[0] });
    else applied.push(p);
  }
  return { applied, skipped };
}

function buildFullSuite(ctx: PresetCardContext): QuickPresetResult {
  const uiFound = detectExistingStatusUi(ctx.entries, ctx.regexScripts ?? [], ctx.tavernScripts ?? []);
  const heavy = ctx.entries.reduce((s, e) => s + estimateEntryTokens(e), 0);
  const { applied, skipped } = fullSuiteBreakdown(ctx);

  const parts: string[] = [
    `Làm một lượt tổng cho card này (${ctx.entries.length} entry, ~${heavy} token lore).`,
    `Gói tổng gồm ${applied.length} việc dưới đây — làm HẾT, việc nào xét thấy card này thật sự không cần thì vẫn phải nói rõ lý do trong ghi chú thay vì im lặng bỏ.`,
    '',
  ];
  applied.forEach((p, i) => {
    const r = p.build(ctx);
    // Giữ nguyên văn goal của preset con: đó chính là thứ đã được viết và kiểm cho preset lẻ, nên
    // gói tổng làm y hệt preset lẻ chứ không phải một bản diễn giải khác dễ lệch.
    parts.push(`━━ ${i + 1}. ${p.title.toUpperCase()} [preset: ${p.id}] ━━`, r.goal, '');
  });

  // (bug 168 mục 3) KHAI LUÔN PHẦN BỎ, NGAY TRONG YÊU CẦU.
  // Trước đây preset bị chặn biến mất hẳn khỏi goal: lời giải thích chỉ nằm trong notes của
  // preset, còn bảng kế hoạch thì không hề biết là đã từng có 19 mục. Cộng lại thành đúng thứ
  // user đếm được — "chỉ thấy 13/19" mà không chỗ nào nói 6 cái kia đi đâu.
  // Nay dấu [preset-skip: mã] nằm ngay trong yêu cầu, nên bộ đối chiếu tính đủ 19 và mọi mục
  // vắng mặt đều có sẵn lý do — máy đọc được, user cũng đọc được.
  if (skipped.length) {
    parts.push(
      '━━ CÁC MỤC KHÔNG ÁP CHO CARD NÀY (đã xét, không phải bỏ sót) ━━',
      ...skipped.map(s => `[preset-skip: ${s.id}] ${s.title} — bỏ vì ${s.reason}`),
      'Không cần làm các mục trên. Liệt kê ở đây để bạn biết chúng ĐÃ được xét.',
      '',
    );
  }

  // (bug 162 mục 3.2) Bao phủ TOÀN BỘ entry, trừ đúng bộ máy MVU.
  parts.push(
    '━━ PHẠM VI RÀ SOÁT (bắt buộc) ━━',
    `Card có ${ctx.entries.length} entry. Phải XEM XÉT TỪNG entry một, không được chỉ chạm vào vài entry liên quan tới nhân vật chính.`,
    'CHỈ được miễn trừ nhóm bộ máy MVU: [initvar], entry quy tắc cập nhật biến, entry danh sách biến cho AI đọc — nhóm này giữ nguyên tuyệt đối, không đụng.',
    'Mọi entry lore / nhân vật phụ / địa điểm / vật phẩm / cơ chế khác đều phải được cân nhắc. Entry nào xét rồi mà quyết định giữ nguyên thì ghi vào ghi chú kèm lý do — để người dùng biết nó ĐÃ được xét, chứ không phải bị bỏ sót.',
    '',
    '━━ QUY ƯỚC CHUNG CHO MỌI KHỐI EJS TẠO RA ━━',
    ...EJS_HOUSE_RULES,
  );
  if (uiFound.hasStatusUi) {
    parts.push('', 'QUAN TRỌNG: card ĐÃ CÓ thanh trạng thái riêng — TUYỆT ĐỐI không tạo giao diện mới, chỉ dùng lại/sửa cái sẵn có.');
  }

  const notes: string[] = [];
  notes.push(`Gói tổng áp ${applied.length}/${individualPresets().length} preset con.`);
  for (const s of skipped) notes.push(`Bỏ "${s.title}": ${s.reason}`);
  if (uiFound.hasStatusUi) notes.push(`Đã phát hiện thanh trạng thái sẵn có (${uiFound.places[0]}) — preset đã dặn AI không tạo trùng.`);
  if (ctx.entries.length > 150) notes.push(`Card có ${ctx.entries.length} entry — kế hoạch sẽ dài và tốn nhiều call. Bạn có thể từ chối bớt dòng trước khi chạy.`);

  return {
    goal: parts.join('\n'),
    // Gói tổng chỉ bị chặn khi KHÔNG preset con nào chạy được — còn một cái chạy được thì vẫn có
    // việc để làm, chặn cả gói là làm mất luôn phần dùng được.
    blockers: ctx.entries.length === 0
      ? ['Card chưa có entry lorebook nào để làm việc.']
      : applied.length === 0
        ? ['Không preset nào áp được cho card này — xem lý do từng cái ở phần ghi chú.']
        : [],
    notes,
  };
}
