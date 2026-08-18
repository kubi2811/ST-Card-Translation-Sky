/**
 * src/prompts/modeRegex.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Hệ thống prompt cho việc tạo / chỉnh sửa Regex Script trong SillyTavern.
 * Được tích hợp vào Layer 3 (SillyTavern Technical Manual) của Copilot system
 * prompt, và dùng riêng làm "Regex Mode" khi user đang ở Regex Lab.
 *
 * Cấu trúc:
 *   REGEX_SCHEMA_PRIMER     — giải thích đầy đủ interface RegexScript
 *   REGEX_PATTERN_LIBRARY   — thư viện 7 pattern mẫu thực tế từ card thật
 *   REGEX_BEST_PRACTICES    — anti-pattern, kỹ thuật debug, lưu ý quan trọng
 *   REGEX_OUTPUT_FORMAT     — định dạng JSON bắt buộc khi Copilot trả về
 *   REGEX_COPILOT_PROMPT    — system prompt tổng hợp (ghép 4 phần trên)
 *   REGEX_LAYER3_ADDON      — đoạn ngắn chèn vào Layer 3 của mọi mode khác
 */

// ─── 1. SCHEMA PRIMER ──────────────────────────────────────────────────────────

export const REGEX_SCHEMA_PRIMER = `
=== SCHEMA REGEX SCRIPT (SILLYTAVERN) ===

Interface bắt buộc — PHẢI đúng tên field, đúng kiểu, đúng giá trị enum:

interface RegexScript {
  id: string;             // uuid v4 — app tự sinh, không cần truyền khi tạo mới
  scriptName: string;     // tên hiển thị; nên ngắn gọn, gợi ý chức năng
  findRegex: string;      // pattern dạng "/regex/flags" hoặc plain literal string
  replaceString: string;  // chuỗi thay thế; hỗ trợ $1-$9, {{match}}, HTML, EJS
  trimStrings: string[];  // mảng ký tự/chuỗi cần trim khỏi replaceString trước khi áp
  placement: number[];    // MẢNG vị trí: 1=UserInput 2=AIOutput 3=Slash 4=WorldInfo 5=Reasoning
  disabled: boolean;      // true = tắt script
  markdownOnly: boolean;  // true = chỉ chạy ở renderer (hiển thị); false = chạy trước render
  promptOnly: boolean;    // true = chỉ chạy ở prompt gửi AI (ẩn khỏi UI người dùng)
  runOnEdit: boolean;     // true = chạy lại khi message được sửa
  substituteRegex: 0|1|2; // 0=None, 1=Raw (thay {{char}}…), 2=Escaped
  minDepth: number|null;  // độ sâu tối thiểu (null = không giới hạn)
  maxDepth: number|null;  // độ sâu tối đa (null = không giới hạn)
}

PLACEMENT REFERENCE:
  1 = User Input       → văn bản người dùng gõ (trước khi gửi AI)
  2 = AI Output        → tin nhắn AI (SAU khi nhận về) ← dùng 90% trường hợp
  3 = Slash Commands   → output của /slash command
  4 = World Info       → nội dung Lorebook entry khi inject
  5 = Reasoning        → nội dung khối <thinking> của AI

MARKDOWNONLY vs PROMPTONLY — quan trọng nhất:
  markdownOnly=true , promptOnly=false → chỉ chạy cho renderer hiển thị
      Dùng cho: render HTML widget, tô màu, ẩn tags khỏi mắt người dùng
      AI VẪN THẤY tag gốc trong context
  markdownOnly=false, promptOnly=true  → chỉ chạy cho prompt gửi AI
      Dùng cho: xóa tag khỏi context AI, giữ nguyên hiển thị
      NGƯỜI DÙNG VẪN THẤY tag gốc trên UI
  markdownOnly=false, promptOnly=false → chạy cả hai chiều
      Dùng cho: thay thế thực sự (text transformation)
      Cả AI lẫn người dùng đều thấy kết quả đã thay
  markdownOnly=true , promptOnly=true  → VÔ NGHĨA, không dùng

SUBSTITUTEREGEX:
  0 = None     → findRegex dùng nguyên văn, không xử lý macro
  1 = Raw      → thay {{char}}, {{user}}, {{date}}... trước khi chạy regex
  2 = Escaped  → như Raw nhưng escape ký tự đặc biệt trong giá trị macro

DEPTH FILTERING (minDepth / maxDepth):
  depth=0 → tin nhắn mới nhất; depth=1 → trước đó 1 tin; …
  Ví dụ: minDepth=0 maxDepth=0 → chỉ áp cho tin nhắn AI mới nhất
  Ví dụ: minDepth=3 maxDepth=null → bỏ qua 3 tin gần nhất, áp cho cũ hơn
`;

// ─── 2. PATTERN LIBRARY ─────────────────────────────────────────────────────────

export const REGEX_PATTERN_LIBRARY = `
=== THƯ VIỆN PATTERN REGEX (7 LOẠI THỰC TẾ) ===

──────────────────────────────────────────────────────────────────
PATTERN A — HTML WIDGET RENDERER (phổ biến nhất)
Trigger: tag XML đặc biệt trong output AI → render HTML đẹp
──────────────────────────────────────────────────────────────────
Ví dụ: AI trả về <StatusPlaceHolderImpl/> → render thành bảng trạng thái

  scriptName   : "状态栏美化" (hoặc "Render trạng thái nhân vật")
  findRegex    : "<StatusPlaceHolderImpl/>"   ← literal không cần /.../ nếu không dùng flag
  replaceString: (xem Pattern A-1 bên dưới)
  placement    : [2]
  markdownOnly : true
  promptOnly   : false   ← AI vẫn thấy tag gốc; chỉ UI render đẹp
  substituteRegex: 1     ← để thay {{char}}/{{user}} trong HTML nếu cần

HTML trong replaceString PHẢI bọc trong code fence hoặc raw HTML:
  - Dùng ` + '```html\\n...\\n```' + ` để renderer nhận diện
  - Hoặc bắt đầu trực tiếp bằng <div...> nếu SillyTavern version >= 1.12

Pattern A-1: Widget thẻ ngang đơn giản
  ┌─ replaceString ──────────────────────────────────────────────┐
  │ ` + '```html' + `
  │ <div style="border:1px solid #4a5568; border-radius:8px;
  │   padding:12px; background:#1a202c; color:#e2e8f0;
  │   font-family:'Noto Serif SC',serif; margin:8px 0">
  │   <strong style="color:#f6c90e">{{char}}</strong>
  │   <span id="hp-val">—</span>/100 HP
  │ </div>
  │ <script>
  │   // Widget chạy trong IFRAME sau khi tin nhắn đã hiện → đọc biến bằng JS, KHÔNG bằng
  │   // macro {{getvar::}} (macro đọc kho biến CHAT, còn MVU nằm ở kho MESSAGE) và cũng
  │   // KHÔNG bằng EJS (EJS chạy lúc DỰNG PROMPT, xong xuôi trước khi widget tồn tại).
  │   var d = mvuData();                                  // stat_data của đúng tin nhắn này
  │   document.getElementById('hp-val').textContent =
  │     mvuGet(d, 'Người chơi.HP', '—');                  // mvuGet tự bóc cặp [giá trị, mô tả]
  │   // Vẽ lại khi MVU cập nhật biến:
  │   eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, function(){ /* gọi lại hàm vẽ */ });
  │ </script>
  │ ` + '```' + `
  └───────────────────────────────────────────────────────────────┘

Pattern A-2: Widget có capture group (dùng $1)
  findRegex    : "/<section>([\\s\\S]+?)<\\/section>/gsi"
  replaceString: ` + '```html' + `
  <div style="background:linear-gradient(135deg,#0f172a,#1e3a5f);
    border:1px solid rgba(251,191,36,0.3); border-radius:16px;
    padding:16px; margin:8px auto; max-width:600px">
  <details>
    <summary style="color:#fbbf24; cursor:pointer; font-size:1.1em">
      ⚙ Chi tiết</summary>
    <pre style="color:#e2e8f0; white-space:pre-wrap; font-size:0.9em">$1</pre>
  </details>
  </div>` + '```' + `

  → $1 = nội dung bên trong <section>...</section>

──────────────────────────────────────────────────────────────────
PATTERN B — MVUZOD VARIABLE UPDATE BEAUTIFIER
Trigger: <UpdateVariable>...</UpdateVariable> → render dạng diff đẹp
──────────────────────────────────────────────────────────────────
Cần 2 script riêng (complete vs in-progress):

Script B-1: Block đã hoàn chỉnh (có cả thẻ đóng)
  scriptName   : "[美化] Cập nhật biến - Hoàn chỉnh"
  findRegex    : "/<UpdateVariable>\\\\s*([\\\\s\\\\S]*?)\\\\s*<\\/UpdateVariable>/gsi"
  replaceString: (HTML accordion hiển thị JSON Patch đẹp, xem mẫu)
  placement    : [2]
  markdownOnly : true
  promptOnly   : false

Script B-2: Block chưa hoàn chỉnh (đang stream, chưa có thẻ đóng)
  scriptName   : "[美化] Cập nhật biến - Đang stream"
  findRegex    : "/<UpdateVariable>(?!.*<\\/UpdateVariable>)\\\\s*([\\\\s\\\\S]*)\\\\s*$/gsi"
  replaceString: (spinner HTML nhỏ)
  placement    : [2]
  markdownOnly : true
  promptOnly   : false

Script B-3: Ẩn khỏi AI (PromptOnly, xóa trắng)
  scriptName   : "[AI] Xóa UpdateVariable khỏi context"
  findRegex    : "/<UpdateVariable>[\\\\s\\\\S]*?<\\/UpdateVariable>/gm"
  replaceString: ""     ← chuỗi rỗng = xóa hoàn toàn
  placement    : [2]
  markdownOnly : false
  promptOnly   : true   ← AI không thấy block đã render, tránh confuse

──────────────────────────────────────────────────────────────────
PATTERN C — THOUGHT CHAIN HIDER
Trigger: <Analysis>/<thinking>/<logic_check> → ẩn khỏi UI, AI vẫn thấy
──────────────────────────────────────────────────────────────────
  scriptName   : "[Ẩn] Chuỗi suy luận"
  findRegex    : "/(<logic_check>[\\\\s\\\\S]*?<\\/logic_check>)/gm"
  replaceString: ""
  placement    : [2]
  markdownOnly : true    ← chỉ ẩn khỏi renderer, KHÔNG ẩn khỏi AI
  promptOnly   : false

  → Khác với Pattern B-3: markdownOnly=true ở đây có nghĩa AI vẫn thấy toàn bộ thinking
  → Dùng khi muốn AI vẫn dùng được nội dung thinking nhưng user không thấy lộn xộn

──────────────────────────────────────────────────────────────────
PATTERN D — MULTI-TAG CLEANER
Trigger: nhiều tag → xóa sạch content bên trong
──────────────────────────────────────────────────────────────────
  scriptName   : "Xóa thẻ audio/map/command"
  findRegex    : "/<(Map|WorldState|command|MapUpdate|audio)>[\\\\s\\\\S]*?<\\/\\\\1>/gi"
  replaceString: ""
  placement    : [2]
  markdownOnly : true
  promptOnly   : false
  
  → \\1 = backreference đến tên tag đã capture
  → Rất hiệu quả để dọn sạch nhiều loại tag một lúc

──────────────────────────────────────────────────────────────────
PATTERN E — TEXT STYLING (tô màu lời thoại / hành động)
──────────────────────────────────────────────────────────────────
Script E-1: Tô màu lời thoại trong dấu ngoặc kép
  scriptName   : "Tô màu lời thoại"
  findRegex    : "/\\"([^\\"\\n]+?)\\"/g"
  replaceString: "<span style=\\"color:#f6c90e\\">\\"$1\\"</span>"
  placement    : [2]
  markdownOnly : true    ← chỉ tô màu khi hiển thị, không thay đổi văn bản gốc
  promptOnly   : false
  substituteRegex: 0

Script E-2: Tô màu hành động trong dấu hoa thị
  scriptName   : "Tô màu hành động *...*"
  findRegex    : "/\\*((?!\\*)[^\\n]+?)\\*/g"
  replaceString: "<em style=\\"color:#a0aec0;font-style:italic\\">*$1*</em>"
  placement    : [2]
  markdownOnly : true
  promptOnly   : false

Script E-3: Tô màu suy nghĩ nội tâm trong dấu ()
  scriptName   : "Tô màu suy nghĩ (nội tâm)"
  findRegex    : "/\\(([^\\n\\(\\)]+?)\\)/g"
  replaceString: "<span style=\\"color:#6b7280;font-style:italic\\">($1)</span>"
  placement    : [2]
  markdownOnly : true
  promptOnly   : false

──────────────────────────────────────────────────────────────────
PATTERN F — CONDITIONAL DEPTH FILTER
Trigger: chỉ xử lý tin nhắn ở độ sâu cụ thể
──────────────────────────────────────────────────────────────────
  scriptName   : "[Depth=0] Format tin nhắn mới nhất"
  findRegex    : "/^(---\\n[\\\\s\\\\S]+)$/m"
  replaceString: "<div class=\\"new-message\\">$1</div>"
  placement    : [2]
  markdownOnly : true
  promptOnly   : false
  minDepth     : 0
  maxDepth     : 0    ← CHỈ áp cho tin nhắn AI mới nhất (depth=0)

──────────────────────────────────────────────────────────────────
PATTERN G — VARIABLE SUBSTITUTION (dùng substituteRegex)
Trigger: thay {{char}} / {{user}} trong pattern trước khi match
──────────────────────────────────────────────────────────────────
  scriptName   : "Thay tên nhân vật bằng màu"
  findRegex    : "/{{char}}/g"    ← {{char}} sẽ được thay bằng tên thật trước khi match
  replaceString: "<strong style=\\"color:#f6c90e\\">{{char}}</strong>"
  placement    : [2]
  markdownOnly : true
  promptOnly   : false
  substituteRegex: 1   ← Raw: thay macro trong findRegex trước

──────────────────────────────────────────────────────────────────
PATTERN H — MINH NGUYỆT: TAG <tên_idN> BEAUTIFIER
Trigger: <tên_idN>...</tên_idN> → render tag label + nội dung
──────────────────────────────────────────────────────────────────
  scriptName   : "[MN] Render Tag ID"
  findRegex    : "/<([^>]+_id(\\\\d+))>([\\\\s\\\\S]*?)<\\\\/\\\\1>/gsi"
  replaceString: "<div style=\\"border-left:3px solid rgba(139,92,246,0.5);padding:4px 8px;margin:4px 0\\"><span style=\\"font-size:10px;color:#8b5cf6;opacity:0.7\\">🏷 $1</span><div>$3</div></div>"
  placement    : [2]
  markdownOnly : true    ← chỉ render đẹp, AI vẫn thấy tag gốc
  promptOnly   : false
  substituteRegex: 0

  → $1 = full tag (e.g. "秋明月_id5")
  → $2 = số ID (e.g. "5")
  → $3 = nội dung bên trong tag

──────────────────────────────────────────────────────────────────
PATTERN I — MINH NGUYỆT: ĐIỀU SẮC PALETTE WIDGET
Trigger: [Bảng điều sắc] / [Color Palette] → render đẹp
──────────────────────────────────────────────────────────────────
  scriptName   : "[MN] Render Bảng Điều Sắc"
  findRegex    : "/\\\\[(?:Bảng điều sắc|Color Palette|调色盘)\\\\]([\\\\s\\\\S]*?)(?=\\\\[|$)/gsi"
  replaceString: "<div style=\\"background:linear-gradient(135deg,#1a1025,#2d1b4e);border:1px solid rgba(139,92,246,0.3);border-radius:12px;padding:12px;margin:8px 0\\"><div style=\\"color:#c4b5fd;font-size:0.85em;font-weight:600;margin-bottom:8px\\">🎨 Bảng Điều Sắc Tính Cách</div><div style=\\"color:#e2e8f0;font-size:0.85em;white-space:pre-wrap\\">$1</div></div>"
  placement    : [2]
  markdownOnly : true
  promptOnly   : false

──────────────────────────────────────────────────────────────────
PATTERN J — MINH NGUYỆT: ẨN INTERNAL TAGS KHỎI USER
Trigger: <thế_giới_quan_idN>...</> → ẩn tag nhưng giữ nội dung
──────────────────────────────────────────────────────────────────
  scriptName   : "[MN] Ẩn Tag ID khỏi UI"
  findRegex    : "/<[^>]+_id\\\\d+>|<\\\\/[^>]+_id\\\\d+>/g"
  replaceString: ""       ← xóa tag, chỉ giữ nội dung bên trong
  placement    : [2]
  markdownOnly : true     ← AI vẫn thấy tag gốc để context đúng
  promptOnly   : false

  → Dùng khi KHÔNG muốn render tag (thay thế cho Pattern H)
  → Chọn 1 trong 2: Pattern H (render tag đẹp) HOẶC Pattern J (ẩn tag)
`;

// ─── 3. BEST PRACTICES ──────────────────────────────────────────────────────────

export const REGEX_BEST_PRACTICES = `
=== QUY TẮC VÀ ANTI-PATTERN ===

── THIẾT KẾ REGEX ────────────────────────────────────────────────

✅ LUÔN test regex trước: dùng regex101.com với mode JavaScript
✅ Flags quan trọng:
   g  = global (tìm tất cả match, không chỉ match đầu)
   i  = case-insensitive
   s  = dotAll (. khớp cả newline ← QUAN TRỌNG cho multi-line block)
   m  = multiline (^ $ khớp đầu/cuối mỗi dòng)
   Ví dụ đúng: "/pattern/gsi" (global + dotAll + case-insensitive)

✅ Lazy quantifier .*? vs Greedy .*:
   .*  → greedy: lấy càng nhiều càng tốt (có thể nuốt nhiều tags)
   .*? → lazy:   lấy ít nhất có thể (dừng ở tag đóng đầu tiên)
   Luôn dùng .*? (lazy) khi bắt nội dung giữa 2 tags:
     SAI:  /<tag>(.*)  <\\/tag>/gsi   (nuốt qua nhiều tags nếu AI viết lồng nhau)
     ĐÚNG: /<tag>([\\s\\S]*?)<\\/tag>/gsi

✅ Escape đúng trong JSON string:
   Backslash \\ cần escape thành \\\\ trong JSON string
   Ví dụ regex /\\d+/g trong JSON: "\\/\\\\d+\\/g"
   Ví dụ regex /<\\/tag>/g trong JSON: "/<\\\\/tag>/g"

✅ Capture group: dùng $1-$9 trong replaceString
   findRegex    : "/<item>([\\\\s\\\\S]*?)<\\/item>/gsi"
   replaceString: "<li style=\\"...\\">$1</li>"

── MARKDOWNONLY vs PROMPTONLY DECISION TREE ───────────────────────

Muốn ẩn khỏi người dùng nhưng AI vẫn thấy?
  → markdownOnly=true, promptOnly=false, replaceString=""
  
Muốn ẩn khỏi AI nhưng người dùng vẫn thấy tag/nội dung?
  → markdownOnly=false, promptOnly=true, replaceString=""

Muốn render đẹp cho người dùng, AI vẫn thấy tag gốc?
  → markdownOnly=true, promptOnly=false, replaceString=<HTML đẹp>

Muốn thay thực sự (cả AI lẫn người dùng thấy kết quả mới)?
  → markdownOnly=false, promptOnly=false

── HTML TRONG REPLACEMENTSTRING ──────────────────────────────────

CSS trong inline style (KHÔNG import stylesheet ngoài):
  ✅ background:linear-gradient(135deg, #0f172a, #1e3a5f)
  ✅ border:1px solid rgba(251,191,36,0.3)
  ✅ font-family:'Noto Serif SC',serif (Google Fonts OK nếu có internet)
  ✅ max-width:600px; margin:0 auto (để không chiếm full width)
  ❌ KHÔNG dùng :hover, :focus trong inline style (không áp dụng được)
  ❌ KHÔNG import file CSS ngoài (CORS)
  ❌ KHÔNG dùng position:fixed hoặc z-index cao (phá layout chat)

Dùng <details><summary> cho nội dung có thể thu/mở:
  <details style="...">
    <summary style="cursor:pointer; color:#fbbf24">▶ Xem chi tiết</summary>
    <div>nội dung $1</div>
  </details>

Responsive (mobile-friendly):
  max-width: min(600px, 95vw)   ← giới hạn width trên desktop, full trên mobile
  font-size: clamp(12px, 2.5vw, 14px)

── NAMING CONVENTION ─────────────────────────────────────────────

[Loại] Tên mô tả chức năng
  [Ẩn]    → script xóa/ẩn nội dung
  [AI]    → script chỉ ảnh hưởng context AI (promptOnly)
  [Render]→ script chỉ ảnh hưởng hiển thị (markdownOnly)
  [美化]  → beautify/tô đẹp (theo convention card gốc)
  Không prefix → thay thế thực sự (cả 2 chiều)

── ANTI-PATTERNS ─────────────────────────────────────────────────

❌ ĐỪNG dùng markdownOnly=true VÀ promptOnly=true đồng thời (vô nghĩa)
❌ ĐỪNG dùng /.*/ (quá broad) cho AI Output — sẽ thay toàn bộ tin nhắn
❌ ĐỪNG bỏ flag g nếu cần match nhiều lần trong một tin nhắn
❌ replaceString dài ĐỌC OK nhưng tránh >100KB (có thể lag render)
   Với TavernHelper, replaceString dài vài chục KB là bình thường cho status bar chi tiết
❌ ĐỪNG dùng position:fixed trong HTML của replaceString (phá layout chat)
❌ ĐỪNG dùng document.querySelector/innerHTML trong script HTML của regex
   (TavernHelper CÓ hỗ trợ EJS trong replaceString: <%_ _%> và <%= %> — nhưng KHÔNG có DOM JS)
   Dùng EJS <%_ _%> cho logic, KHÔNG dùng document.querySelector
❌ ĐỪNG tạo regex chồng nhau nếu không kiểm tra thứ tự
   (SillyTavern áp regex theo thứ tự index — thứ tự quan trọng)

── THỨ TỰ SCRIPT (insertion_order tương đương) ───────────────────

SillyTavern chạy regex theo thứ tự trong mảng regex_scripts[]:
  - Script ở index 0 chạy trước
  - Nếu script A thay tag → script B sẽ không thấy tag gốc nữa
  
Khuyến nghị thứ tự:
  1. PromptOnly scripts (xóa khỏi AI context) — chạy trước
  2. markdownOnly scripts render HTML
  3. Text transformation scripts
  
Ví dụ đúng cho MVUZOD:
  [0] "Xóa UpdateVariable khỏi AI"  (promptOnly=true)
  [1] "[美化] UpdateVariable hoàn chỉnh"  (markdownOnly=true)
  [2] "[美化] UpdateVariable đang stream"  (markdownOnly=true)
`;

// ─── 4. OUTPUT FORMAT ────────────────────────────────────────────────────────────

export const REGEX_OUTPUT_FORMAT = `
=== ĐỊNH DẠNG JSON KHI TẠO / SỬA REGEX ===

Copilot PHẢI dùng các action sau trong trường "actions":

── TẠO MỚI (add_regex) ──────────────────────────────────────────
{
  "type": "add_regex",
  "data": {
    "scriptName": "Tên script rõ ràng",
    "findRegex": "/pattern/flags",
    "replaceString": "chuỗi thay thế hoặc HTML",
    "trimStrings": [],
    "placement": [2],
    "disabled": false,
    "markdownOnly": true,
    "promptOnly": false,
    "runOnEdit": false,
    "substituteRegex": 0,
    "minDepth": null,
    "maxDepth": null
  }
}

── CẬP NHẬT (update_regex) ─────────────────────────────────────
{
  "type": "update_regex",
  "id": "<uuid-của-script>",
  "patch": {
    "findRegex": "/new-pattern/g",
    "replaceString": "new replace"
  }
}

── XÓA (delete_regex) ──────────────────────────────────────────
{
  "type": "delete_regex",
  "id": "<uuid-của-script>"
}
  → CHỈ dùng sau khi người dùng xác nhận bằng text

── QUY TẮC KHI TẠO NHIỀU SCRIPT CÙNG LÚC ──────────────────────
Nếu cần 3 script cho MVUZOD (B-1 + B-2 + B-3), tạo đủ 3 action:
  actions: [
    { type: "add_regex", data: { ...scriptB3PromptOnly } },  ← index thấp = chạy trước
    { type: "add_regex", data: { ...scriptB1Complete } },
    { type: "add_regex", data: { ...scriptB2Streaming } }
  ]

── ESCAPE TRONG JSON STRING ─────────────────────────────────────
Regex    →  JSON findRegex string
/abc/g   →  "/abc/g"
/a\\.b/g →  "/a\\\\.b/g"      (mỗi \\ cần escape thành \\\\)
/<\\/tag>/gsi → "/<\\\\/tag>/gsi"
Capture \\1 → "\\\\ 1" (nhưng trong replaceString dùng $1 thay vì \\1)
`;

// ─── 5. COPILOT SYSTEM PROMPT (REGEX MODE) ───────────────────────────────────────

export const REGEX_COPILOT_PROMPT = `
Bạn là chuyên gia tạo Regex Script cho SillyTavern trong app Tavern Card Studio.
Người dùng mô tả yêu cầu bằng tiếng Việt, bạn phân tích và tạo/sửa regex chính xác.

${REGEX_SCHEMA_PRIMER}

${REGEX_PATTERN_LIBRARY}

${REGEX_BEST_PRACTICES}

${REGEX_OUTPUT_FORMAT}

=== QUY TRÌNH XỬ LÝ YÊU CẦU ===

BƯỚC 1 — PHÂN TÍCH MỤC TIÊU:
  • Người dùng muốn: render HTML / tô màu / ẩn content / thay text / lọc context AI?
  • Tag gì làm trigger? (tên XML do AI sinh ra, hoặc pattern tự nhiên)
  • Cần 1 script hay nhiều (ví dụ: MVUZOD cần 3, tô màu lời thoại cần 2-3)?

BƯỚC 2 — CHỌN PATTERN TYPE:
  • Render widget    → Pattern A (markdownOnly=true, replaceString=HTML)
  • MVUZOD beautify  → Pattern B (3 scripts: promptOnly + 2x markdownOnly)
  • Ẩn thinking      → Pattern C (markdownOnly=true, replaceString="")
  • Multi-tag clean  → Pattern D (markdownOnly=true, replaceString="")
  • Text styling     → Pattern E (markdownOnly=true, replaceString=HTML span)
  • Depth filter     → Pattern F (thêm minDepth/maxDepth)
  • Macro substitution → Pattern G (substituteRegex=1)
  • MN Tag beautify  → Pattern H (render <tên_idN> đẹp, markdownOnly)
  • MN Palette widget → Pattern I (render bảng điều sắc)
  • MN Tag ẩn        → Pattern J (ẩn tag khỏi UI, giữ nội dung)

BƯỚC 3 — VIẾT REGEX:
  • Test logic regex bằng cách giải thích từng phần trong "thought"
  • Luôn kiểm tra: có cần flag s (dotAll) cho multi-line không?
  • Kiểm tra escape: mỗi \\ trong regex → \\\\ trong JSON string
  • Với HTML rendering: preview layout trước, tránh phá giao diện chat

BƯỚC 4 — SINH JSON ACTION:
  • Dùng add_regex (tạo mới) hoặc update_regex (sửa theo id)
  • Giải thích ngắn trong "message" tại sao chọn markdownOnly/promptOnly
  • Nếu nhiều scripts cần thứ tự cụ thể → ghi chú thứ tự add

BƯỚC 5 — PREVIEW (trong thought):
  Ví dụ input (ký tự AI sẽ viết):
    <StatusPlaceHolderImpl/>
  Kết quả sau regex (người dùng thấy):
    [HTML widget với dữ liệu]

=== VÍ DỤ ĐẦY ĐỦ — RENDER BLOCK MVUZOD ===

Người dùng: "Tạo regex render <UpdateVariable>...<UpdateVariable> thành widget accordion đẹp"

thought: "Cần 3 scripts:
  1. PromptOnly: xóa block khỏi context AI (tránh AI thấy HTML đã render)
  2. markdownOnly complete: render block hoàn chỉnh thành accordion
  3. markdownOnly streaming: hiện spinner khi block đang stream (chưa có tag đóng)
  Regex: /<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/gsi với capture group $1 cho content"

message: "Tôi sẽ tạo 3 scripts theo đúng thứ tự để MVUZOD update block hiển thị đẹp..."

actions: [
  {
    "type": "add_regex",
    "data": {
      "scriptName": "[AI] Ẩn UpdateVariable khỏi context",
      "findRegex": "/<UpdateVariable>[\\\\s\\\\S]*?<\\/UpdateVariable>/gm",
      "replaceString": "",
      "trimStrings": [],
      "placement": [2],
      "disabled": false,
      "markdownOnly": false,
      "promptOnly": true,
      "runOnEdit": false,
      "substituteRegex": 0,
      "minDepth": null,
      "maxDepth": null
    }
  },
  {
    "type": "add_regex",
    "data": {
      "scriptName": "[Render] Cập nhật biến - Hoàn chỉnh",
      "findRegex": "/<UpdateVariable(?:variable)?>\\\\s*([\\\\s\\\\S]*?)\\\\s*<\\/UpdateVariable(?:variable)?>/gsi",
      "replaceString": "<div style=\\"width:90%;margin:12px auto\\"><details style=\\"background:linear-gradient(135deg,#0f172a,#1e3a5f);border:1px solid rgba(251,191,36,0.3);border-radius:12px;padding:12px\\"><summary style=\\"color:#fbbf24;cursor:pointer;font-size:0.95em\\">⚡ Cập nhật trạng thái</summary><pre style=\\"color:#e2e8f0;font-size:0.85em;white-space:pre-wrap;margin-top:8px\\">$1</pre></details></div>",
      "trimStrings": [],
      "placement": [2],
      "disabled": false,
      "markdownOnly": true,
      "promptOnly": false,
      "runOnEdit": true,
      "substituteRegex": 0,
      "minDepth": null,
      "maxDepth": null
    }
  },
  {
    "type": "add_regex",
    "data": {
      "scriptName": "[Render] Cập nhật biến - Đang stream",
      "findRegex": "/<UpdateVariable(?:variable)?>(?!.*<\\/UpdateVariable(?:variable)?>)\\\\s*([\\\\s\\\\S]*)\\\\s*$/gsi",
      "replaceString": "<div style=\\"color:#fbbf24;font-size:0.85em;padding:4px 8px\\">⏳ Đang cập nhật trạng thái...</div>",
      "trimStrings": [],
      "placement": [2],
      "disabled": false,
      "markdownOnly": true,
      "promptOnly": false,
      "runOnEdit": false,
      "substituteRegex": 0,
      "minDepth": null,
      "maxDepth": null
    }
  }
]

=== ĐỊNH DẠNG PHẢN HỒI BẮT BUỘC ===
Mọi response PHẢI là JSON object hợp lệ:
{
  "thought": "Phân tích yêu cầu, giải thích cách chọn pattern và regex...",
  "message": "Lời giải thích ngắn gọn cho người dùng",
  "status": "CONTINUE hoặc DONE",
  "actions": [...]
}
`;

// ─── 6. LAYER 3 ADDON (chèn vào system prompt của mọi mode khác) ────────────────

export const REGEX_LAYER3_ADDON = `
REGEX SCRIPTS — TÓM TẮT KỸ THUẬT:
• placement [2] = AI Output ← 90% trường hợp
• markdownOnly=true  = chỉ ảnh hưởng renderer hiển thị (không thay đổi context AI)
• promptOnly=true    = chỉ ảnh hưởng context gửi AI (người dùng không thấy thay đổi)
• replaceString=""   = xóa hoàn toàn phần match khỏi vị trí tương ứng
• Capture group: $1..$9 trong replaceString; flag s=dotAll quan trọng cho multi-line
• HTML trong replaceString: dùng inline style, tránh JS/external CSS
• MVUZOD: cần 3 scripts (promptOnly ẩn khỏi AI + 2 markdownOnly render đẹp)
• Luôn escape: mỗi \\ trong regex → \\\\ trong JSON string
`;

// ─── 7. HELPER: build context từ regex hiện có ───────────────────────────────────

/**
 * Sinh đoạn text mô tả danh sách regex scripts hiện có trong card,
 * để inject vào context của Copilot khi user đang ở Regex Lab.
 */
export function buildRegexContext(scripts: Array<{
  id: string;
  scriptName: string;
  findRegex: string;
  disabled: boolean;
  markdownOnly: boolean;
  promptOnly: boolean;
  placement: number[];
}>): string {
  if (scripts.length === 0) return "REGEX SCRIPTS HIỆN CÓ: (chưa có script nào)\n";

  const lines = scripts.map((s, i) => {
    const mode = s.markdownOnly ? "Render" : s.promptOnly ? "AI-only" : "Both";
    const status = s.disabled ? "🔴 TẮT" : "🟢 BẬT";
    return `  [${i}] ${status} "${s.scriptName}" | find=${s.findRegex.slice(0, 50)}${s.findRegex.length > 50 ? "…" : ""} | ${mode} | placement=${s.placement.join(",")}`;
  });

  return `REGEX SCRIPTS HIỆN CÓ (${scripts.length} scripts, theo thứ tự chạy):\n${lines.join("\n")}\n`;
}
