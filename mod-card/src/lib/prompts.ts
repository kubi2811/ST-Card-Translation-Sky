export const SYSTEM_PROMPT = `
Bạn là chuyên gia phân tích và chỉnh sửa SillyTavern character card V3. Mỗi khi nhận yêu cầu, bạn phải TƯ DUY TRƯỚC rồi mới hành động — đọc toàn bộ context, hiểu mục đích, rồi mới sửa.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHẦN A: SCHEMA CHARCARD V3
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Root Level (mirror của data.*):
  name, description, personality, scenario,
  first_mes, mes_example, creatorcomment,
  avatar (BASE64 — NEVER TOUCH),
  talkativeness, fav, tags,
  spec: "chara_card_v3", spec_version: "3.0", create_date

data.*:
  name, description, personality, scenario,
  first_mes, mes_example, creator_notes,
  system_prompt, post_history_instructions,
  tags, creator, character_version,
  alternate_greetings: string[],
  extensions:
    talkativeness, fav, world
    depth_prompt: { prompt, depth, role }
    tavern_helper:
      scripts: ScriptObject[]
      variables: {}
    regex_scripts: RegexObject[]
  character_book:
    name: string
    entries: EntryObject[]
`;

export const ANALYZE_CARD_PROMPT = `
Phân tích card SillyTavern theo 5 bước Chain-of-Thought, sau đó xuất JSON báo cáo.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THÔNG TIN INPUT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MOD RULES:
{MOD_RULES}

CARD JSON (avatar đã được thay bằng placeholder):
{CARD_JSON}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QUY TRÌNH 5 BƯỚC (thực hiện lần lượt, TRƯỚC KHI xuất JSON):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BƯỚC 1 — HIỂU MOD RULES:
  Liệt kê từng rule theo dạng:
  "Rule [ID]: Đổi/Xóa/Thay thế [X] → [Y]. Áp dụng cho: [danh sách field types]"

BƯỚC 2 — IDENTIFY CARD TYPE:
  - Thẻ 1 nhân vật hay nhiều nhân vật?
  - Thế giới loại A (bối cảnh thực), B (thế giới nhỏ), hay C (thế giới lớn)?
  - Card dùng XML tags nào? (liệt kê)
  - Card ở ngôn ngữ nào?

BƯỚC 3 — MAP SECTIONS:
  Liệt kê TẤT CẢ sections có nội dung:
  [section_id]: [label] — [content_type] — [position nếu là entry] — [is_code?]

BƯỚC 4 — RULE MATCHING:
  Với mỗi section, xác định:
  - Có match với rule nào không? Rule nào? Tại sao?
  - Mức độ match: STRONG (nhiều điểm khớp) / WEAK (vài điểm) / NONE

  ⚠️ QUÉT CẠN KIỆT — BẮT BUỘC (đây là nguyên nhân mod hay THẤT BẠI):
  Mod chỉ thành công khi XOÁ SẠCH dấu vết của thứ cần đổi. Sót MỘT chỗ là card vẫn
  chạy theo logic cũ và toàn bộ bản mod coi như hỏng.
  a) Từ MOD RULES, rút ra DANH SÁCH TỪ KHOÁ của thứ cần đổi — gồm cả biến thể:
     số + đơn vị ("7 ngày", "day 7", "Ngày 7", "第7天", "7-day"), tên mốc/sự kiện
     ("Phán Xét Cuối Cùng", "Endgame", "Game Over"), và tên biến/field liên quan.
  b) DUYỆT QUA TỪNG section MỘT (kể cả entry nằm cuối danh sách, script, HTML/UI,
     Zod schema, mvu_update rules, initvar) và tự hỏi: "section này có chứa BẤT KỲ
     từ khoá nào ở (a) không?"
  c) Chứa dù chỉ 1 từ khoá → BẮT BUỘC đánh NEEDS_MOD (không được hạ xuống WEAK/NONE
     chỉ vì section đó "chủ yếu là chuyện khác").
  d) Trong phần văn xuôi trước JSON, liệt kê rõ: "Từ khoá đã quét: [...]" và
     "Section chứa từ khoá: [danh sách]" để tự đối chiếu, tránh bỏ sót.

BƯỚC 5 — RISK ASSESSMENT:
  Với mỗi section NEEDS_MOD, đánh giá:
  - Nếu sửa sai, hậu quả là gì?
  - Có dependency với section khác không?

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT — JSON ARRAY (xuất SAU khi hoàn thành 5 bước trên):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[
  {
    "section_id": "description",
    "label": "Mô tả nhân vật (root)",
    "field_path": "description",
    "mirror_paths": ["data.description"],
    "content_type": "text_narrative",
    "xml_tags_used": ["<Character>", "<Appearance>"],
    "is_code": false,
    "entry_position": null,
    "entry_order": null,
    "importance_score": 95,
    "status": "NEEDS_MOD",
    "matched_rules": ["RULE-NTR-NTL"],
    "match_strength": "STRONG",
    "reason": "Mô tả chứa kịch bản NTR rõ ràng ở đoạn 3",
    "affected_keywords": ["bị cướp", "mất em"],
    "affected_portion": "[Đoạn 3] Anh ta bất lực nhìn em bị...",
    "preview_change": "Đổi dynamic từ bị-cướp sang chủ-động-cướp",
    "dependency": ["entry_3", "entry_7"],
    "risk_level": "MEDIUM",
    "content_length": 1240
  }
]
`;

export const MOD_SECTION_PROMPT = `
Sửa đoạn nội dung sau theo mod rules. Suy nghĩ trước khi viết.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THÔNG TIN SECTION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Section ID    : {SECTION_ID}
Tên           : {SECTION_LABEL}
Field path    : {FIELD_PATH}
Mirror paths  : {MIRROR_PATHS}
Content type  : {CONTENT_TYPE}
XML tags hiện dùng: {XML_TAGS}
Ngôn ngữ card : {CARD_LANGUAGE}
Importance    : {IMPORTANCE_SCORE}/100

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MOD RULES ÁP DỤNG:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{MOD_RULES_APPLIED}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTEXT (sections đã sửa trước — để giữ nhất quán):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{PREVIOUSLY_MODIFIED_CONTEXT}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NỘI DUNG GỐC:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{ORIGINAL_CONTENT}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT — CHỈ NỘI DUNG ĐÃ SỬA:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Trả về DUY NHẤT nội dung đã sửa hoàn chỉnh.
Không có prefix, không có hậu tố, không có giải thích.
Không có markdown code block bao ngoài.
`;

export const MOD_SCRIPT_PROMPT = `
Sửa EJS/TypeScript script theo mod rules. Cực kỳ thận trọng với code.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCRIPT INFO:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Script name : {SCRIPT_NAME}
Script path : {FIELD_PATH}

MOD RULES:
{MOD_RULES_APPLIED}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCRIPT GỐC:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{ORIGINAL_SCRIPT}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT — CHỈ xuất đúng khối XML sau (KHÔNG JSON, KHÔNG markdown). Đặt TOÀN BỘ script đã sửa
(giữ nguyên xuống dòng, dấu ngoặc, ký tự đặc biệt) vào trong tag — không cần escape:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
<modified_script>
...toàn bộ script đã sửa (hoặc giữ nguyên nếu không đổi gì)...
</modified_script>
<warnings>Cảnh báo nếu có thứ cần user review thủ công (để trống nếu không có)</warnings>
`;

export const KEYWORD_SYNC_PROMPT = `
Sau khi đã mod nội dung của các lorebook entries, kiểm tra và cập nhật keywords cho phù hợp.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BỐI CẢNH:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MOD RULES ĐÃ ÁP DỤNG:
{MOD_RULES}

ENTRIES ĐÃ MOD (chỉ các entries có status NEEDS_MOD):
{MODIFIED_ENTRIES_JSON}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT (JSON ARRAY):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[
  {
    "entry_index": 2,
    "entry_comment": "Tên Entry (để tham khảo)",
    "action": "UPDATE | KEEP | SKIP",
    "current_keys": ["zombie", "xác sống", "undead"],
    "updated_keys": ["kẻ thù", "địch quân", "quân xâm lược", "bandit"],
    "changes_detail": {
      "removed": ["zombie", "xác sống", "undead"],
      "added": ["kẻ thù", "địch quân", "quân xâm lược", "bandit"],
      "kept": []
    },
    "formatted_key_string": "kẻ thù,địch quân,quân xâm lược,bandit",
    "reason": "Entry đổi từ zombie sang kẻ thù sống, cần xóa zombie keywords và thêm từ khóa mới"
  }
]
`;

export const CONSISTENCY_AUDIT_PROMPT = `
Kiểm tra tính nhất quán nội dung giữa các sections của card đã mod.
Không kiểm tra JSON structure — chỉ kiểm tra nội dung có logic với nhau không.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MOD RULES ĐÃ ÁP DỤNG:
{MOD_RULES}

CARD ĐÃ MOD (JSON):
{MODIFIED_CARD_JSON}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT (JSON):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "consistency_score": 87,
  "inconsistencies": [
    {
      "dimension": "C2_THEME",
      "severity": "HIGH | MEDIUM | LOW",
      "affected_sections": ["entry_3", "entry_7"],
      "description": "entry_3 và entry_7 vẫn còn mô tả cảnh NTR sau khi đã mod sang NTL ở description",
      "conflicting_content": {
        "entry_3": "đoạn trích gốc vẫn có NTR...",
        "description": "đoạn trích đã được đổi sang NTL..."
      },
      "fix": "Cần mod entry_3 và entry_7 theo cùng rule NTR→NTL"
    }
  ],
  "passed_dimensions": ["C1_CHARACTER", "C3_WORLD_LORE", "C4_CHARACTER_PROFILE"],
  "summary": "Card nhất quán 87%. Cần fix 2 inconsistencies trước khi export."
}
`;

export const VALIDATE_CARD_PROMPT = `
Kiểm tra toàn diện card đã mod. Phát hiện lỗi và đề xuất fix cụ thể.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MOD RULES ĐÃ ÁP DỤNG:
{MOD_RULES}

CARD GỐC:
{ORIGINAL_CARD_JSON}

CARD ĐÃ MOD:
{MODIFIED_CARD_JSON}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT (JSON):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "status": "PASS | FAIL | PASS_WITH_WARNINGS",
  "issues": [
    {
      "severity": "CRITICAL | HIGH | MEDIUM | LOW",
      "category": "JSON_INTEGRITY | PROTECTED_MODIFIED | MIRROR_MISMATCH | MOD_INCOMPLETE | CONTENT_QUALITY",
      "field_path": "data.character_book.entries[2].extensions.depth",
      "description": "Mô tả vấn đề cụ thể",
      "original_value": "4",
      "current_value": "5",
      "fix": "Khôi phục lại giá trị gốc: 4"
    }
  ],
  "keyword_sync_needed": [],
  "stats": {
    "sections_modified": 5,
    "sections_unchanged": 12,
    "protected_fields_verified": 48,
    "mirrors_in_sync": 5,
    "entries_checked": 9,
    "issues_critical": 0,
    "issues_high": 1,
    "issues_medium": 2,
    "issues_low": 0
  },
  "summary": "Mô tả kết quả validation trong 1-2 câu"
}
`;

export const MVUZOD_DETECT_PROMPT = `
Phân tích card SillyTavern. Xác định xem có phải card MVU-ZOD không. Nếu có, trích xuất kiến trúc đầy đủ.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KIẾN THỨC: DẤU HIỆU NHẬN BIẾT MVU-ZOD CARD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Script 0 (MVU Import):
  import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js'
  → Đây là dấu hiệu CHẮC CHẮN là MVU card

Script 1 (ZOD Schema):
  import { registerMvuSchema } from 'https://.../mvu_zod.js';
  export const schema = z.object({ ... });
  $(() => { registerMvuSchema(schema); })
  → Dấu hiệu CHẮC CHẮN là MVU-ZOD card

Entry markers quan trọng:
  [mvu_update] prefix → Entries điều khiển AI viết update commands
  [initvar] prefix    → Entry khởi tạo giá trị ban đầu cho biến
  @@preprocessing     → EJS controller entry (bắt đầu bằng dòng này)
  Constant=True + pos=after_char + role=0 + "biến mvu" → Variable list entry

Variable access pattern trong EJS:
  getvar('stat_data.Đường.Dẫn.Biến')
  → Biến được lưu dưới key 'stat_data'

Update output format:
  <UpdateVariable> ... </UpdateVariable>
  → JSON Patch commands (RFC 6902 style) để cập nhật biến

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CARD CẦN PHÂN TÍCH:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCRIPTS (tóm tắt):
{SCRIPTS_SUMMARY}

ENTRIES (tóm tắt):
{ENTRIES_SUMMARY}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT (JSON):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "is_mvuzod": true,
  "confidence": "HIGH | MEDIUM | LOW",
  "variable_store_key": "stat_data",
  "update_tag": "UpdateVariable"
}
`;

export const MVUZOD_SCHEMA_READ_PROMPT = `
Parse ZOD schema sau thành cây biến (variable tree) dễ đọc.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ZOD SCHEMA (Script 1 content):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{ZOD_SCHEMA_CONTENT}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ZOD SYNTAX REFERENCE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
z.object({...})           → nested object
z.string()                → string type
z.number() / z.coerce.number() → number type
z.boolean()               → boolean type
z.enum(['A','B','C'])     → enum với fixed values
.prefault(value)          → giá trị mặc định

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT (JSON):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "variable_tree": {},
  "thematic_variables": [],
  "enum_variables": []
}
`;

export const MVUZOD_MOD_CLASSIFY_PROMPT = `
Phân tích mod request đối với MVU-ZOD card. Xác định loại mod và kế hoạch an toàn.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MOD REQUEST:
{MOD_RULES}

CARD SUMMARY:
{SCHEMA_TREE}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT (JSON):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "mod_type": "TYPE-A | TYPE-B | TYPE-C | TYPE-D | TYPE-E",
  "risk_level": "LOW | MEDIUM | HIGH",
  "summary": "Kế hoạch mod"
}
`;

export const MVUZOD_NARRATIVE_MOD_PROMPT = `
Sửa nội dung narrative entry trong MVU-ZOD card.
ĐẶC BIỆT LƯU Ý: Entry này là Layer 6 (Narrative), KHÔNG liên quan đến MVU variable system.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENTRY METADATA:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Entry index    : {ENTRY_INDEX}
Comment (tên)  : {ENTRY_COMMENT}
Position       : {POSITION}
Keys           : {ENTRY_KEYS}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MOD RULES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{MOD_RULES}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MVU VARIABLE REFERENCES — TUYỆT ĐỐI KHÔNG THAY ĐỔI CÁC PATTERN NÀY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Nếu entry có các pattern sau, KHÔNG được sửa chúng:
  • getvar('stat_data.X.Y.Z')       → variable access
  • <UpdateVariable>...</UpdateVariable> → update block
  • {{format_message_variable::stat_data}} → macro MVU
  • @@preprocessing                 → EJS controller marker
  • <StatusPlaceHolderImpl/>        → status placeholder

CHỈ SỬA: Văn xuôi thông thường, mô tả, dialog, lore text

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NỘI DUNG GỐC:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{ORIGINAL_CONTENT}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT — CHỈ xuất đúng khối XML sau (KHÔNG JSON, KHÔNG markdown). Đặt nội dung vào trong tag,
không cần escape ký tự đặc biệt:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
<modified>
...nội dung đã sửa hoàn chỉnh...
</modified>
<keys>tên NPC/keys mới nếu cần, phân tách bằng dấu phẩy (để trống nếu không đổi)</keys>
<comment>tên entry mới nếu cần (để trống nếu không đổi)</comment>
`;

export const EXPAND_SUBSECTION_PROMPT = `
Bạn cần ĐÀO SÂU / CHI TIẾT HOÁ một PHẦN NHỎ bên trong section này, GIỮ NGUYÊN toàn bộ phần còn lại.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHẦN CẦN ĐÀO SÂU: {SUB_MARKER}
(ví dụ: tag <Appearance>, hoặc mục tiêu đề "Ngoại hình", hoặc mô tả đoạn cần chi tiết hoá)

YÊU CẦU: {INSTRUCTION}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NGUYÊN TẮC:
- CHỈ mở rộng/chi tiết hoá đúng phần nêu trên (thêm chi tiết cảm quan, cụ thể, chiều sâu) — bám LORE.
- KHÔNG đổi các phần khác của section. GIỮ NGUYÊN mọi macro/biến ({{...}}, getvar) và XML tag CẤU TRÚC.
- Ngôn ngữ giữ như card.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LORE DIGEST:
{LORE_DIGEST}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION GỐC (ĐẦY ĐỦ):
{ORIGINAL_CONTENT}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT — CHỈ xuất XML (KHÔNG markdown). Trả về TOÀN BỘ section với phần đã đào sâu đặt đúng vị trí:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
<result>
...toàn bộ section (phần được nêu đã chi tiết hơn, phần còn lại y nguyên)...
</result>
`;

export const EXPAND_SECTION_PROMPT = `
Bạn đang MOD theo CHẾ ĐỘ MỞ RỘNG. Thay vì chỉ làm theo nghĩa đen của yêu cầu, hãy VIẾT CHI TIẾT & ĐÀO SÂU section này.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NGUYÊN TẮC MỞ RỘNG:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Thực hiện đúng YÊU CẦU MOD trước.
2. Sau đó BỔ SUNG 3-4 phần mở rộng HỢP LÝ (chi tiết cảm quan, chiều sâu tâm lý/động cơ, quan hệ, hệ quả, tiểu tiết bối cảnh) — làm nội dung dày và sống động hơn.
3. Bám sát LORE DIGEST — KHÔNG mâu thuẫn với thế giới/nhân vật/sự kiện đã có.
4. Mức độ đào sâu: {INTENSITY}.
5. GIỮ NGUYÊN mọi macro/biến kỹ thuật: {{...}}, getvar(...), <UpdateVariable>, <StatusPlaceHolderImpl/>, và các XML tag CẤU TRÚC hiện có (chỉ mở rộng NỘI DUNG bên trong, không phá cấu trúc). Ngôn ngữ giữ như card.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YÊU CẦU MOD:
{MOD_RULES}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LORE DIGEST (toàn cảnh card + lorebook — để match lore):
{LORE_DIGEST}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION: {SECTION_LABEL} ({CONTENT_TYPE})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{ORIGINAL_CONTENT}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTEXT (các phần đã sửa trước — giữ nhất quán):
{PREVIOUSLY_MODIFIED_CONTEXT}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT — CHỈ xuất đúng khối XML (KHÔNG markdown, KHÔNG giải thích):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
<expanded>
...nội dung đã mở rộng, chi tiết, hoàn chỉnh...
</expanded>
`;

export const MVUZOD_VAR_REMAP_PROMPT = `
Bạn đang MOD một card MVU-ZOD. Nhiệm vụ: theo YÊU CẦU người dùng, ĐỔI TÊN và/hoặc ĐỔI NGHĨA (mô tả) các BIẾN trong schema cho phù hợp.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YÊU CẦU NGƯỜI DÙNG:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{USER_REQUEST}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DANH SÁCH BIẾN HIỆN CÓ (key | type | mô tả | enum):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{VARIABLE_LIST}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QUY TẮC:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- CHỈ đổi biến THỰC SỰ cần theo yêu cầu; biến không liên quan → BỎ QUA (không liệt kê).
- Tên mới phải HỢP LỆ với code (không dấu cách/ký tự lạ; nên dùng chữ/số/gạch dưới). Giữ nguyên type.
- Nghĩa mới (describe) ngắn gọn, rõ. Nếu chỉ đổi nghĩa mà giữ tên → new_name = tên cũ.
- KHÔNG bịa biến mới không có trong danh sách.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT — CHỈ XUẤT ĐÚNG KHỐI XML dưới đây (không giải thích, KHÔNG JSON, KHÔNG markdown):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
<remap>
<var><old>ten_key_cu</old><new_name>ten_key_moi</new_name><new_desc>mô tả mới (để trống nếu không đổi nghĩa)</new_desc></var>
</remap>
`;

export const MVUZOD_VALIDATE_PROMPT = `
Kiểm tra toàn vẹn MVU-ZOD card sau khi mod. Phát hiện inconsistency giữa các layers.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MOD ĐÃ THỰC HIỆN:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{MOD_SUMMARY}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KẾT QUẢ KIỂM TRA BẰNG CODE (tin tưởng tuyệt đối — đã đo trên nội dung ĐẦY ĐỦ):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{INTEGRITY_PRECHECK}

⚠️ LUẬT BẮT BUỘC VỀ "CẮT CỤT / TRUNCATED":
- Mục trên đã được KIỂM BẰNG CODE trên nội dung ĐẦY ĐỦ (đếm cân bằng ngoặc, bỏ qua ngoặc
  trong chuỗi/comment). Nếu nó ghi "ngoặc CÂN BẰNG → KHÔNG bị cắt cụt" thì nội dung đó
  NGUYÊN VẸN — TUYỆT ĐỐI KHÔNG được báo issue kiểu "bị cắt cụt", "truncated", "thiếu dấu
  đóng ngoặc", "SyntaxError do thiếu }".
- Nếu phần CONTENT bên dưới trông như dừng giữa chừng, đó CHỈ LÀ do bị cắt bớt để vừa
  prompt (sẽ có nhãn [CẮT ĐỂ HIỂN THỊ] ở cuối) — KHÔNG PHẢI lỗi của card.
- Chỉ được báo cắt cụt khi mục KIỂM TRA BẰNG CODE ở trên ghi "ngoặc LỆCH".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTENT ĐỂ VALIDATE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Schema (Script {SCHEMA_INDEX}): {SCHEMA_CONTENT}
mvu_update Rules (Entry [{UPDATE_RULES_INDEX}]): {UPDATE_RULES_CONTENT}
EJS Controller (Entry [{EJS_INDEX}]): {EJS_CONTROLLER_PREVIEW}
initvar (Entry [{INITVAR_INDEX}]): {INITVAR_CONTENT}

LƯU Ý VỀ SỐ HIỆU: các chỉ số Entry/Script ở trên là chỉ số THẬT trong card này. Khi mô tả
issue phải trích đúng số đó, KHÔNG được bịa số khác.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT (JSON):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "validation_status": "PASS | FAIL | WARNINGS",
  "mvuzod_integrity": "INTACT | BROKEN | DEGRADED",
  "issues": [
    {
      "severity": "CRITICAL | HIGH | MEDIUM",
      "description": "...",
      "fix": "..."
    }
  ],
  "runtime_risk": "SAFE | MEDIUM | HIGH",
  "summary": "..."
}
`;
