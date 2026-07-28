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

export interface QuickPreset {
  id: string;
  title: string;
  /** Công dụng khi đưa vào card — user mới đọc cái này để chọn. */
  effect: string;
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

// ── Các preset ──────────────────────────────────────────────────────────────

export const QUICK_PRESETS: QuickPreset[] = [
  {
    id: 'save-tokens',
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

  {
    id: 'full-suite',
    title: 'Áp dụng TẤT CẢ tính năng EJS',
    icon: '🚀',
    effect:
      'Gói tổng: tối ưu token cho toàn bộ entry, mở lore theo tiến trình, chỉnh từ khoá cho NPC/địa điểm, ' +
      'chèn khối biến cho AI đọc, và đổi tính cách theo chỉ số. Nên chạy khi card đã tương đối hoàn chỉnh ' +
      'vì kế hoạch sẽ dài — bạn vẫn duyệt được từng dòng trước khi chạy.',
    build: (ctx) => {
      const ui = detectExistingStatusUi(ctx.entries, ctx.regexScripts ?? [], ctx.tavernScripts ?? []);
      const hasSchema = !!ctx.schema?.fields?.length;
      const consts = constantEntries(ctx.entries);
      const heavy = ctx.entries.reduce((s, e) => s + estimateEntryTokens(e), 0);

      const parts = [
        `Làm một lượt tổng cho card này (${ctx.entries.length} entry, ~${heavy} token lore).`,
        'Hãy tự quyết những việc dưới đây, việc nào card không cần thì bỏ và nói rõ vì sao:',
        '',
        `1. TIẾT KIỆM TOKEN: rà ${consts.length} entry đang "Luôn bật", giữ lại đúng những entry AI buộc`,
        '   phải biết mọi lượt (quy tắc xưng hô, thiết lập thế giới), còn lại hạ xuống từ khoá hoặc điều kiện.',
        '   KHÔNG đụng entry thuộc bộ máy MVU ([initvar], quy tắc cập nhật, danh sách biến, khối EJS).',
        '2. TỪ KHOÁ: entry nhân vật phụ / địa điểm / vật phẩm → kích hoạt theo từ khoá, đặt keys sát với',
        '   cách người chơi thật sự gọi tên; key của hai entry không được trùng hệt hay bao nhau.',
        '3. TÁCH ENTRY GỘP: entry nhồi nhiều phần có điều kiện kích hoạt khác nhau (chuỗi sự kiện, danh',
        '   sách địa điểm…) → tách thành entry riêng (action split_entry, khai rõ splitInto từng phần).',
        '   Nội dung luôn đi cùng nhau thì giữ chung.',
      ];
      if (hasSchema) {
        parts.push(
          `4. LORE THEO TIẾN TRÌNH: dùng biến của card (${varList(ctx, 12)}) để mở lore đúng mốc — entry tắt`,
          '   sẵn, controller bật bằng await activewi(tên, true); mỗi entry tắt phải có đúng chỗ bật nó.',
          '5. KHỐI BIẾN CHO AI ĐỌC: chèn giá trị biến hiện tại vào prompt để AI không phải đoán chỉ số,',
          '   ưu tiên DIỄN GIẢI thành văn ngắn thay vì bảng số khô.',
          '6. TÍNH CÁCH THEO CHỈ SỐ: chọn một biến làm thang, chia 3-4 mốc, mỗi mốc một giọng điệu.',
          '7. CHĂM SÓC DỮ LIỆU MVU (nếu thấy đáng làm): khối chuẩn hoá giá trị lệch schema (không sửa',
          '   schema) và/hoặc cảnh báo ngưỡng chỉ số quan trọng.',
        );
      } else {
        parts.push(
          '4. Card CHƯA có MVUZOD schema nên bỏ qua phần điều khiển theo biến — chỉ làm phần từ khoá,',
          '   tách entry và tối ưu Constant. Nêu trong ghi chú rằng nên tạo schema để mở khoá phần còn lại.',
        );
      }
      if (ui.hasStatusUi) {
        parts.push('', 'QUAN TRỌNG: card ĐÃ CÓ thanh trạng thái riêng — TUYỆT ĐỐI không tạo giao diện mới, chỉ dùng lại/sửa cái sẵn có.');
      }
      parts.push('', 'Các khối EJS tạo ra KHÔNG được trùng tên entry và không được dùng chung tên biến cho hai đường dẫn khác nhau.');

      const notes: string[] = [];
      if (!hasSchema) notes.push('Chưa có MVUZOD schema — gói tổng sẽ bỏ phần điều khiển theo biến. Tạo schema ở tab MVUZOD để dùng đủ.');
      if (ui.hasStatusUi) notes.push(`Đã phát hiện thanh trạng thái sẵn có (${ui.places[0]}) — preset đã dặn AI không tạo trùng.`);
      if (ctx.entries.length > 150) notes.push(`Card có ${ctx.entries.length} entry — kế hoạch sẽ dài và tốn nhiều call. Bạn có thể từ chối bớt dòng trước khi chạy.`);

      return {
        goal: parts.join('\n'),
        blockers: ctx.entries.length === 0 ? ['Card chưa có entry lorebook nào để làm việc.'] : [],
        notes,
      };
    },
  },
];
