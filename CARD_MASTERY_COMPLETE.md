# 📖 TÀI LIỆU TỔNG HỢP: THÀNH THẠO XÂY DỰNG THẺ SILLYTAVERN

> **Mục đích:** File này là bộ quy chuẩn DUY NHẤT và ĐẦY ĐỦ NHẤT để AI (hoặc người) tham chiếu khi build thẻ nhân vật SillyTavern nâng cao.
> Tổng hợp từ: `World Book Tạo Thẻ TMN.json` (31 entries), `CARD_BUILDING_GUIDE.md`, `LOREBOOK_CARD_PROMPT.md`, `MVUZOD_TUTORIAL.md`, `FRONTEND_TUTORIAL.md`, và thẻ mẫu `chuyển sinh thành slimev5.42.json`.

---

## MỤC LỤC

1. [TỔNG QUAN KIẾN TRÚC](#1-tổng-quan-kiến-trúc)
2. [CẤU TRÚC FILE JSON](#2-cấu-trúc-file-json)
3. [HAI MÔ HÌNH CARD](#3-hai-mô-hình-card)
4. [TAVERNHELPER API — TOÀN BỘ 20 NHÓM](#4-tavernhelper-api)
5. [MVU/ZOD — FRAMEWORK BIẾN](#5-mvuzod-framework-biến)
6. [EJS — TEMPLATE PROMPT ĐỘNG](#6-ejs-template-prompt-động)
7. [REGEX SCRIPTS — ENGINE RENDER](#7-regex-scripts)
8. [FRONTEND UI — KIẾN TRÚC SPA](#8-frontend-ui)
9. [LOREBOOK — NÃO CỦA CARD](#9-lorebook)
10. [SYSTEM PROMPT (description)](#10-system-prompt)
11. [first_mes — SPLASH SCREEN](#11-first_mes)
12. [CHECKLIST TỰ KIỂM TRA](#12-checklist-tự-kiểm-tra)
13. [LỖI THƯỜNG GẶP & KHẮC PHỤC](#13-lỗi-thường-gặp)
14. [CÂU LỆNH MẪU (PROMPT TEMPLATES)](#14-câu-lệnh-mẫu)
15. [KẾ HOẠCH THỰC HIỆN TỔNG THỂ](#15-kế-hoạch-thực-hiện)

---

# 1. TỔNG QUAN KIẾN TRÚC

```
┌──────────────────────────────────────────────────────────────┐
│                  SillyTavern Chat Window                      │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ System Prompt (description)                            │   │
│  │  → Quy tắc nhập vai, hành vi AI, format output        │   │
│  │  → Bắt AI luôn trả về keyword trigger cho UI          │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ Lorebook (character_book) — N entries                  │   │
│  │  → Kích hoạt theo keywords trong hội thoại             │   │
│  │  → Cung cấp context cho AI về thế giới                 │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                              │
│  AI Response: "...nội dung truyện... [KEYWORD_TRIGGER]"      │
│       ↓ regex match findRegex                                │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ Regex Script (markdownOnly: true, placement: [2])      │   │
│  │  → replaceString = ```html ... ``` (toàn bộ UI)        │   │
│  │                                                        │   │
│  │  ┌──────────┬───────────────┬──────────┐               │   │
│  │  │  LEFT    │    CENTER     │  RIGHT   │  ← Frontend   │   │
│  │  │  Stats   │    Game Log   │  Actions │               │   │
│  │  │  Items   │    Map View   │  Quests  │               │   │
│  │  └──────────┴───────────────┴──────────┘               │   │
│  │                                                        │   │
│  │  State: MVU/Zod ← getAllVariables()                    │   │
│  │         hoặc localStorage + Dexie (self-contained)     │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                              │
│  first_mes → Splash screen + form chọn xuất phát điểm       │
└──────────────────────────────────────────────────────────────┘
```

Card hoàn chỉnh gồm **6 thành phần**:

| # | Thành phần | Field JSON | Vai trò |
|---|-----------|------------|---------|
| 1 | **Lorebook** | `character_book` | World data, quy tắc, chủng tộc — não của card |
| 2 | **System Prompt** | `description` | Chỉ dẫn hành vi AI, format output, keyword trigger |
| 3 | **first_mes** | `first_mes` | Splash screen HTML + form khởi tạo |
| 4 | **Regex Scripts** | `extensions.regex_scripts` | Engine render UI vào chat window |
| 5 | **Frontend UI** | trong `replaceString` | HTML/CSS/JS dashboard tự chứa |
| 6 | **MVU/Zod Schema** | Script nhân vật + Worldbook | Quản lý biến trạng thái game |

---

# 2. CẤU TRÚC FILE JSON

```json
{
  "spec": "chara_card_v3",
  "data": {
    "name": "tên card",
    "first_mes": "...",           // ← Splash screen HTML
    "description": "...",         // ← System prompt
    "mes_example": "...",         // ← Ví dụ chat (có thể rỗng)
    "extensions": {
      "regex_scripts": [          // ← Script render UI
        {
          "scriptName": "...",
          "findRegex": "keyword",
          "replaceString": "```html\n<!DOCTYPE html>\n...\n```",
          "markdownOnly": true,
          "placement": [2]
        }
      ]
    },
    "character_book": {           // ← Lorebook
      "entries": [ ... ]
    }
  }
}
```

| Trường | Vai trò | Ghi chú |
|--------|---------|---------|
| `name` | Tên hiển thị | Chuỗi ngắn |
| `first_mes` | Tin nhắn đầu tiên | Có thể chứa HTML splash screen đầy đủ |
| `description` | System prompt cho AI | Tối đa ~4.000 từ |
| `mes_example` | Ví dụ hội thoại mẫu | Có thể rỗng |
| `regex_scripts` | Engine render | 1 script (card phức tạp) hoặc 3–6 scripts (MVU) |
| `character_book` | World data | Nhiều entries |

---

# 3. HAI MÔ HÌNH CARD

| Đặc điểm | **Mô hình MVU/Zod** | **Mô hình Self-contained** (slimev5.42) |
|-----------|---------------------|----------------------------------------|
| State | MVU variables qua SillyTavern API | localStorage + IndexedDB (Dexie) |
| DOM Access | `getAllVariables()` | `document.getElementById()` |
| Communication | `triggerSlash()`, `eventOn()` | `parent.*`, `fetch()` |
| Regex Scripts | 3–6 scripts chuyên biệt | **1 script duy nhất** (~2MB) |
| UI Injection | Nhiều regex nhỏ | 1 regex = toàn bộ SPA |
| Phức tạp | Trung bình | Rất cao (full game engine) |
| Dùng khi | Dashboard, form đơn giản | RPG phức tạp, game engine |

### Khi nào dùng pattern nào?

| Tiêu chí | Multi-Regex (MVU) | Single-Regex (Self-contained) |
|-----------|-------------------|-------------------------------|
| Độ phức tạp UI | Đơn giản (1–2 panel) | Phức tạp (game engine) |
| Số components | < 5 | > 10 |
| State management | MVU variables đủ | Cần localStorage/DB |
| File size | < 100KB | > 500KB |
| Debug | Dễ debug từng script | Phải tổ chức code tốt |

---

# 4. TAVERNHELPER API

> Trích từ `World Book Tạo Thẻ TMN.json` — 20 nhóm API, 31 entries.
> Đây là danh sách **đầy đủ** tất cả API có sẵn trong môi trường iframe/script của SillyTavern.

## 4.1 Thao tác tầng tin nhắn

```javascript
/* Lấy tin nhắn */
getChatMessages(start?, end?, role?) → ChatMessage[]
// start/end: số tầng hoặc id. role: 'all'|'user'|'assistant'|'system'
// VD: getChatMessages(0, -1, 'user')  → tất cả tin user
// VD: getChatMessages(-3)              → 3 tầng cuối

/* Tạo tin nhắn mới */
createChatMessages(messages, position?) → Promise<void>
// messages: {role, content}[] hoặc string
// position: 'end'(mặc định)|'start'|number

/* Sửa tin nhắn */
setChatMessages(changes) → Promise<void>
// changes: {id, content?, role?}[]

/* Xóa tin nhắn */
deleteChatMessages(message_ids) → Promise<void>
// VD: deleteChatMessages([getLastMessageId()])

/* Lấy ID tin nhắn hiện tại */
getCurrentMessageId() → number
getLastMessageId() → number
```

## 4.2 Đọc ghi biến

```javascript
/* Đọc biến */
getvar(path, options?) → any
// options: { defaults: giá_trị_mặc_định }
// BẮT BUỘC prefix stat_data. cho biến MVU
// VD: getvar('stat_data.Nhân_vật.Độ_hảo_cảm', { defaults: 0 })

/* Ghi biến */
setvar(key, value, options?) → void
// options: { scope: 'local'|'message' }  (message = mặc định)
// VD: setvar('stat_data.hp', 80, { scope: 'local' })

/* Lấy toàn bộ biến MVU */
getAllVariables() → object
// Trả về object chứa toàn bộ biến Zod đã khai báo
```

## 4.3 Thao tác Worldbook

```javascript
/* Lấy nội dung mục WB */
getwi(entry_name) → Promise<string>
// VD: const content = await getwi('Bản_đồ_Trung_Ương')

/* Ghi nội dung mục WB */
setwi(entry_name, content) → Promise<void>

/* Lấy danh sách tên mục */
getwinames() → string[]

/* Bật/tắt mục */
enablewi(entry_name) → Promise<void>
disablewi(entry_name) → Promise<void>

/* Kiểm tra trạng thái */
iswiactive(entry_name) → boolean
iswienabled(entry_name) → boolean
```

## 4.4 Yêu cầu AI tạo (Generate)

```javascript
/* Tạo KÈM thiết lập sẵn */
generate(config) → Promise<string>
// config:
//   user_input?: string
//   should_stream?: boolean     (mặc định false)
//   should_silence?: boolean    (mặc định false)
//   image?: File|string|(File|string)[]
//   overrides?: Overrides
//   injects?: InjectionPrompt[]
//   max_chat_history?: 'all'|number
//   custom_api?: CustomApiConfig
//   generation_id?: string

/* Tạo KHÔNG KÈM thiết lập sẵn */
generateRaw(config) → Promise<string>
// Tham số bổ sung:
//   ordered_prompts?: (BuiltinPrompt|RolePrompt)[]
// BuiltinPrompt: 'world_info_before'|'persona_description'|
//   'char_description'|'char_personality'|'scenario'|
//   'world_info_after'|'dialogue_examples'|'chat_history'|'user_input'
// RolePrompt: {role:'system'|'assistant'|'user', content:string}

/* Dừng tạo */
stopGeneration(generation_id?) → void
```

## 4.5 Hiển thị tầng

```javascript
/* Lấy DOM tầng */
retrieveDisplayedMessage(message_id) → JQuery<HTMLDivElement>
// VD: retrieveDisplayedMessage(0).text()

/* Văn bản → HTML hiển thị */
formatAsDisplayedMessage(text, {message_id?}) → string

/* Làm mới hiển thị */
refreshOneMessage(message_id, $mes?) → Promise<void>
```

## 4.6 Lắng nghe sự kiện

```javascript
/* Đăng ký lắng nghe */
eventOn(event_type, listener) → {stop}       // Liên tục
eventOnce(event_type, listener) → {stop}     // Một lần
eventMakeFirst(event_type, listener) → {stop} // Đầu tiên
eventMakeLast(event_type, listener) → {stop}  // Cuối cùng

/* Hủy lắng nghe */
eventRemoveListener(event_type, listener)
eventClearEvent(event_type)
eventClearListener(listener)
eventClearAll()

/* Gửi sự kiện */
eventEmit(event_type, ...data) → Promise<void>

/* Sự kiện iframe thường dùng */
iframe_events.MESSAGE_IFRAME_RENDER_STARTED
iframe_events.MESSAGE_IFRAME_RENDER_ENDED
iframe_events.GENERATION_STARTED
iframe_events.STREAM_TOKEN_RECEIVED_FULLY
iframe_events.GENERATION_ENDED

/* Sự kiện quán rượu thường dùng */
tavern_events.MESSAGE_SENT        // User gửi tin
tavern_events.MESSAGE_RECEIVED    // AI trả tin
tavern_events.CHAT_CHANGED        // Đổi chat
tavern_events.CHARACTER_FIRST_MESSAGE // Tin nhắn đầu tiên
tavern_events.GENERATION_STOPPED  // Dừng tạo
```

## 4.7 Bơm Prompt

```javascript
/* Bơm prompt tạm thời (chỉ lần generate tiếp theo) */
setEphemeralInject(key, {content, role?, position?, depth?}) → void
// position: 'before_system'|'after_system'|'in_chat'
// depth: 0 = gần nhất, số lớn = xa hơn
// VD: setEphemeralInject('my_hint', {
//   content: 'Hãy thêm chi tiết về thời tiết',
//   role: 'system',
//   position: 'in_chat', depth: 0
// })

/* Bơm prompt vĩnh viễn (mọi lần generate) */
setExtensionPromptByName(name, {content, role?, position?, depth?}) → void
removeExtensionPromptByName(name) → void
```

## 4.8 Macro và Regex

```javascript
/* Thay thế macro */
substitudeMacros(text) → string
// VD: substitudeMacros('{{char}} nói {{lastMessageId}}')
// → "Thiếu_nữ in 5"

/* Macro có sẵn */
// {{char}}        → Tên nhân vật
// {{user}}        → Tên người dùng
// {{lastMessageId}} → ID tầng cuối
// {{newline}}     → Xuống dòng
// {{random::A::B::C}} → Ngẫu nhiên trong A/B/C
```

## 4.9 Phát âm thanh

```javascript
playAudio(url, options?) → HTMLAudioElement
// options: { volume?: 0-1, loop?: boolean }
// VD: playAudio('https://example.com/sfx.mp3', { volume: 0.5 })

stopAudio(audio_element)
```

## 4.10 Script và nút bấm

```javascript
/* Nút bấm script (chỉ trong script, không phải frontend) */
getScriptButtons() → ScriptButton[]
replaceScriptButtons(buttons) → void
appendInexistentScriptButtons(buttons) → void

/* Sự kiện nút bấm */
eventOn(getButtonEvent('Tên_nút'), () => { ... })

/* Thông tin script */
getScriptName() → string
getScriptInfo() → string

/* Chia sẻ giao diện toàn cục */
getGlobalIframe() → JQuery<HTMLIFrameElement>|null
// Lấy iframe giao diện frontend toàn cục
```

## 4.11 Quản lý tiện ích mở rộng

```javascript
isAdmin() → boolean
isInstalledExtension(extension_id) → boolean
getExtensionType(id) → 'local'|'global'|'system'|null
installExtension(url, type) → Promise<Response>
uninstallExtension(id) → Promise<Response>
updateExtension(id) → Promise<Response>
```

## 4.12 Nhập dữ liệu gốc

```javascript
importRawCharacter(filename, content:Blob) → Promise<Response>
importRawChat(filename, content:string) → Promise<Response>
importRawPreset(filename, content:string) → Promise<boolean>
importRawWorldbook(filename, content:string) → Promise<Response>
importRawTavernRegex(filename, content:string) → boolean
```

## 4.13 Hàm công cụ

```javascript
substitudeMacros(text) → string        // Thay thế macro
getLastMessageId() → number            // ID tầng cuối
getMessageId(iframe_name) → number     // ID theo iframe
errorCatched(fn) → fn                  // Bọc bắt lỗi hiển thị popup

/* API tích hợp (object builtin) */
builtin.addOneMessage(mes, options?)
builtin.copyText(text)                 // Copy clipboard
builtin.duringGenerating() → boolean   // Đang generate?
builtin.renderMarkdown(text) → string  // MD → HTML
builtin.uuidv4() → string             // Tạo UUID
builtin.saveSettings() → Promise<void>
```

## 4.14 Framework Biến MVU

```javascript
/* Chờ MVU sẵn sàng */
await waitGlobalInitialized('Mvu')

/* Lấy toàn bộ biến */
const vars = getAllVariables()
// Truy cập: _.get(vars, 'stat_data.Nhân_vật.Độ_hảo_cảm', 0)

/* Lắng nghe cập nhật biến */
eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, () => {
  populateCharacterData() // Cập nhật UI
})

/* Gửi lệnh slash */
triggerSlash('/mvu set hp 80')
triggerSlash('/sys Một sự kiện xảy ra...')
triggerSlash('/trigger')             // Bắt AI phản hồi
triggerSlash('/cut ' + msgId)        // Xóa tin nhắn
```

## 4.15 Lệnh Slash

```javascript
triggerSlash(command) → Promise<string>

/* Lệnh thường dùng */
'/sys Nội_dung'        // Gửi tin nhắn hệ thống
'/trigger'             // Bắt AI phản hồi
'/cut ID'              // Xóa tin nhắn
'/mvu set key value'   // Set biến MVU
'/reload-page'         // Tải lại trang
```

## 4.16 Thông tin thẻ nhân vật

```javascript
getCharacterData() → CharacterData
// Trả về: {name, description, personality, scenario, first_mes, ...}

getCharacterName() → string
getUserName() → string
```

## 4.17 Quản lý thẻ nhân vật

```javascript
getCharacterList() → Promise<Character[]>
selectCharacterByNameOrId(name_or_id) → Promise<void>
createCharacter(data) → Promise<Response>
deleteCharacter(name, delete_chats?) → Promise<Response>
```

## 4.18 Thao tác thiết lập sẵn

```javascript
getPresetList(api_id?) → Promise<string[]>
getPreset(preset_name, api_id?) → Promise<object>
selectPreset(preset_name, api_id?) → Promise<void>
createPreset(preset_name, preset_data, api_id?) → Promise<Response>
deletePreset(preset_name, api_id?) → Promise<Response>
```

## 4.19 Thông tin phiên bản

```javascript
getTavernHelperVersion() → string    // VD: "3.0.0"
getTavernVersion() → string         // VD: "1.12.6"
```

## 4.20 Khởi tạo và chờ sẵn sàng

```javascript
/* Chờ module sẵn sàng */
waitGlobalInitialized(module_name) → Promise<void>
// VD: await waitGlobalInitialized('Mvu')

/* Bọc hàm init an toàn */
$(errorCatched(init))  // ← MẪU CHUẨN để gọi init
// KHÔNG dùng DOMContentLoaded — BẮT BUỘC dùng $(function(){})
```

---

# 5. MVU/ZOD FRAMEWORK BIẾN

## 5.1 Thành phần hệ thống MVU

```
Script cấu trúc biến (Zod Schema)  → Định nghĩa kiểu và ràng buộc
    ↓
[initvar] Biến_khởi_tạo (WB entry, disabled) → Giá trị ban đầu (YAML)
    ↓
Danh_sách_biến (WB entry)          → AI nhìn thấy giá trị hiện tại
    ↓
[mvu_update] Quy_tắc_cập_nhật     → AI biết khi nào cập nhật
    ↓
[mvu_update] Định_dạng_đầu_ra     → AI dùng JSON Patch xuất
    ↓
Regex ẩn <UpdateVariable>          → Ẩn khối update khỏi hiển thị
    ↓
Frontend giao diện (tùy chọn)      → Hiển thị biến lên UI
```

## 5.2 ⚠️ QUY TẮC TỬ HUYỆT

### QUY TẮC #1: `initvar` PHẢI LÀ entry WB disabled
```yaml
# Tên entry: [initvar] Khởi_tạo_biến_đừng_mở
# Trạng thái: VÔ HIỆU HÓA (disabled)
# Nội dung: YAML tương ứng với Schema
Nhân_vật:
  Độ_hảo_cảm: 35
  Túi_đồ:
    Băng_cá_nhân:
      Mô_tả: Băng cá nhân hoạt hình
      Số_lượng: 1
```

### QUY TẮC #2: Tên biến HTML phải KHỚP 100% với Zod Schema
```
Zod: hp, gold, location     HTML data-var: hp, gold, location    ✅
Zod: hp, gold, location     HTML data-var: HP, Gold, Location    ❌
```

### QUY TẮC #3: Prefix `stat_data.` bắt buộc khi truy cập biến
```javascript
// ĐÚNG:
_.get(all_variables, 'stat_data.Nhân_vật.Độ_hảo_cảm', 0)
getvar('stat_data.Nhân_vật.Độ_hảo_cảm', { defaults: 0 })

// SAI:
_.get(all_variables, 'Nhân_vật.Độ_hảo_cảm', 0)    // ❌ Thiếu stat_data.
```

## 5.3 Script cấu trúc biến (Zod Schema)

> Đặt trong **Script nhân vật**, `z` và `_` (lodash) đã khả dụng toàn cục.

```javascript
import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';

export const Schema = z.object({
  Nhân_vật: z.object({
    Độ_hảo_cảm: z.coerce.number().transform(v => _.clamp(v, 0, 100)),
    Túi_đồ: z.record(
      z.string().describe('Tên_vật_phẩm'),
      z.object({
        Mô_tả: z.string(),
        Số_lượng: z.coerce.number().prefault(1),
      })
    ).transform(data => _.pickBy(data, ({Số_lượng}) => Số_lượng > 0)),
  }),
});

$(() => { registerMvuSchema(Schema); });
```

### Quy tắc Zod 4 (BẮT BUỘC)

| Quy tắc | Giải thích |
|---------|-----------|
| `z.coerce.number()` | Ưu tiên hơn `z.number()` |
| `z.prefault(value)` | Ưu tiên hơn `z.default(value)` |
| `z.transform(v => _.clamp(v, min, max))` | Dùng thay cho `.min()/.max()` |
| `z.record()` ưu tiên hơn `z.array()` | Object > mảng cho dữ liệu có key |
| KHÔNG dùng `.strict()` / `.passthrough()` | Không tồn tại trong Zod 4 |
| KHÔNG dùng `.optional()` cho biến gốc | Gây lỗi khi parse |
| `transform` chỉ nhận 1 tham số | `(value) => ...` |
| Tính lũy đẳng | `Schema.parse(Schema.parse(x)) === Schema.parse(x)` |
| Chỉ import `registerMvuSchema` | `z` và `_` đã có sẵn toàn cục |

## 5.4 Cập nhật biến — AI output format

AI cần xuất khối `<UpdateVariable>` trong phản hồi:

```xml
<UpdateVariable>
<JSONPatch>
[
  {"op":"replace","path":"/Nhân_vật/Độ_hảo_cảm","value":50},
  {"op":"replace","path":"/Nhân_vật/Túi_đồ/Kiếm_Bạc/Số_lượng","value":1}
]
</JSONPatch>
</UpdateVariable>
```

> Khối này bị Regex ẩn khỏi hiển thị nhưng MVU engine đọc được.

## 5.5 Frontend đọc biến MVU — Mẫu chuẩn

```javascript
async function init() {
  await waitGlobalInitialized('Mvu');
  populateCharacterData();
  eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, populateCharacterData);
}

function populateCharacterData() {
  const vars = getAllVariables();
  if (!vars) return;

  /* Dùng _.get với prefix stat_data. */
  const hp = _.get(vars, 'stat_data.Nhân_vật.HP', 100);
  const name = _.get(vars, 'stat_data.Nhân_vật.Tên', 'Chưa_đặt');

  /* Cập nhật UI */
  document.getElementById('hp-bar').style.width = hp + '%';
  document.getElementById('char-name').textContent = name;
}

/* Khởi tạo — BẮT BUỘC dùng pattern này */
$(errorCatched(init));
```

---

# 6. EJS — TEMPLATE PROMPT ĐỘNG

> Sử dụng tiện ích mở rộng `ST-Prompt-Template`. Chạy trong Worldbook, prompt, và tin nhắn.

## 6.1 Cú pháp

| Tag | Chức năng |
|-----|-----------|
| `<%_ Code _%>` | Thực thi code, không xuất, tự xóa khoảng trắng (khuyên dùng) |
| `<%= Biểu_thức %>` | Xuất giá trị (HTML escape) |
| `<%- Biểu_thức %>` | Xuất giá trị (giữ nguyên, không escape) |
| `<%# Chú_thích %>` | Chú thích, không thực thi |

## 6.2 Điều khiển điều kiện

```ejs
<%_ if (getvar('stat_data.Nhân_vật.Độ_hảo_cảm') < 30) { _%>
Prompt AI thấy khi độ hảo cảm thấp — thái độ lạnh nhạt
<%_ } else if (getvar('stat_data.Nhân_vật.Độ_hảo_cảm') < 60) { _%>
Prompt trung bình — thái độ trung lập
<%_ } else { _%>
Prompt cao — thái độ thân thiện
<%_ } _%>
```

## 6.3 Bộ điều khiển nội dung động (`@@preprocessing`)

```ejs
@@preprocessing
<%
var currentDomain = getvar('stat_data.Định_vị_thế_giới.Đại_vực_hiện_tại',
                           { defaults: 'Trung_Ương' });
var presentCharacters = getvar('stat_data.Nhân_vật_có_mặt', { defaults: {} });
%>

<% if (!isFloorZero) { %>
  <% if (currentDomain.includes('Trung_Ương')) { %>
    <%- await getwi('Bản_đồ_Trung_Ương') %>
  <% } %>

  <% /* Tải động nhân vật có mặt */ %>
  <%
  const aliasMap = { 'Tuyết': 'Ân_Đông_Tuyết' };
  var detectedCharacters = new Set();
  for (const [alias, full] of Object.entries(aliasMap)) {
    if (Object.keys(presentCharacters).some(k => k.includes(alias))) {
      detectedCharacters.add(full);
    }
  }
  for (const char of detectedCharacters) {
    %><%- await getwi(char) %><%
  }
  %>
<% } %>
```

> **Mục đích:** Chỉ tải WB entries liên quan đến vị trí/nhân vật hiện tại → tiết kiệm token.

---

# 7. REGEX SCRIPTS

## 7.1 Cấu hình các trường quan trọng

| Trường | Giá trị | Ý nghĩa |
|--------|---------|---------|
| `findRegex` | `"youyujun233"` | Keyword duy nhất — AI phải trả về keyword này |
| `replaceString` | `` "```html\n<!DOCTYPE html>...\n```" `` | Toàn bộ ứng dụng HTML/CSS/JS |
| `markdownOnly` | `true` | **Chỉ render UI**, không ảnh hưởng prompt AI |
| `promptOnly` | `false` | Không gửi UI code vào prompt |
| `placement` | `[2]` | Chỉ áp dụng cho tin nhắn AI |
| `runOnEdit` | `false` | Không re-render khi edit |

## 7.2 Mẫu Multi-Regex (MVU cards)

```
Script 0: Ẩn keyword khỏi prompt     → promptOnly: true
Script 1: Ẩn tag <UpdateVariable>     → promptOnly: true
Script 2: Render Frontend UI          → markdownOnly: true
(Tùy chọn thêm: Loading UI, Form khởi đầu, v.v.)
```

### Script 0 — Ẩn keyword trigger
```json
{
  "scriptName": "Ẩn keyword trigger",
  "findRegex": "KEYWORD_TRIGGER",
  "replaceString": "",
  "promptOnly": true,
  "markdownOnly": false,
  "placement": [2],
  "runOnEdit": false
}
```

### Script 1 — Ẩn tag biến MVU
```json
{
  "scriptName": "Ẩn update tags",
  "findRegex": "<UpdateVariable>[\\s\\S]*?</UpdateVariable>",
  "replaceString": "",
  "promptOnly": true,
  "markdownOnly": false,
  "placement": [2],
  "runOnEdit": false
}
```

### Script 2 — Render Frontend UI (CHÍNH)
```json
{
  "scriptName": "Game Dashboard UI",
  "findRegex": "KEYWORD_TRIGGER",
  "replaceString": "```html\n<!DOCTYPE html>\n...(toàn bộ frontend)...\n```",
  "promptOnly": false,
  "markdownOnly": true,
  "placement": [2],
  "runOnEdit": false
}
```

## 7.3 Quy tắc Regex quan trọng

1. **Keyword phải duy nhất** — không trùng bất kỳ từ thông thường nào (VD: `youyujun233`, `terraparallel2026`)
2. **Bọc HTML trong Markdown code block** — BẮT BUỘC `` ```html ... ``` `` để bypass DOMPurify
3. **Không dùng nhóm chụp `()`** — cách viết mới không cần `$1`
4. **Dùng `[\s\S]*?`** thay cho `.*` — vì `.*` không khớp xuống dòng
5. **Kiểm tra Regex SillyTavern:**
   - ✅ `<story>[\s\S]*?</story>`
   - ❌ `<story>([\s\S]*?)</story>` (nhóm chụp)
   - ❌ `<story>.*</story>` (không khớp multiline)

---

# 8. FRONTEND UI

## 8.1 Quy tắc CSS bắt buộc

```css
/* ⚠️ BODY: margin: 0; padding: 0; — TUYỆT ĐỐI */
body {
  margin: 0;
  padding: 0;  /* KHÔNG BAO GIỜ khác 0 */
}

/* Nếu cần lề → thêm margin cho phần tử chứa */
.game-panel {
  margin: 15px;
}
```

### CSS Variables (Design System)

```css
:root {
    /* Typography */
    --ai-font-size: 1.05em;
    --ai-font-color: #FFFFFF;
    --chat-font-family: 'Lora', serif;

    /* Colors — Primary palette */
    --primary-color: #7A78C2;
    --hover-color: #9896E0;
    --text-primary: #F0F4FF;
    --accent-color: #82D8F7;

    /* Separators */
    --separator-color: #3D4059;

    /* Background */
    --center-pane-bg: rgba(26, 29, 46, 0.1);

    /* Rarity colors (items/skills) */
    --rarity-mundane: #808080;
    --rarity-common: #CCCCCC;
    --rarity-rare: #4fc3f7;
    --rarity-epic: #ba68c8;
    --rarity-legendary: #ffd700;
    --rarity-mythic: #ff5252;
}
```

### Google Fonts

```css
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,700;1,400&display=swap');
```

| Font | Dùng cho |
|------|----------|
| **Cinzel** | Tiêu đề, splash screen |
| **Lora** | Body text, chat messages |

## 8.2 Layout 3 Pane

```css
.game-panel {
    display: flex;
    width: 100%;
    height: 100dvh;   /* Dynamic viewport height */
    overflow: hidden;
    box-sizing: border-box;
}

.left-pane {
    width: clamp(280px, 20vw, 350px);
    flex-shrink: 0;
    padding: 20px;
    overflow-y: auto;
}

.center-pane {
    flex-grow: 1;
    padding: 20px;
    border-left: 1px solid var(--separator-color);
    border-right: 1px solid var(--separator-color);
}

.right-pane {
    width: clamp(220px, 15vw, 280px);
    flex-shrink: 0;
    padding: 20px;
}
```

## 8.3 Modal & Overlay System

```html
<div id="my-overlay" class="overlay">
  <div class="modal">
    <button class="modal-close-btn">✕</button>
    <h4>Tiêu Đề</h4>
    <div class="modal-content">...</div>
    <div class="modal-footer">
      <button class="major-action-button">Action</button>
    </div>
  </div>
</div>
```

```css
.overlay {
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    background-color: rgba(0,0,0,0.75);
    z-index: 1000;
    display: flex;
    justify-content: center;
    align-items: center;
    opacity: 0;
    transition: opacity 0.3s ease;
    pointer-events: none;
}
.overlay.visible { opacity: 1; pointer-events: auto; }
.overlay.visible .modal { transform: scale(1); }

.modal {
    background-color: #2c2a2a;
    border: 2px solid var(--primary-color);
    border-radius: 8px;
    padding: 20px;
    transform: scale(0.95);
    transition: transform 0.3s ease;
}
```

### Z-Index Hierarchy

```
1000  — Standard overlays
1200  — Mobile panes
1500  — Character creation
1600  — Map, Skills, Tasks, Achievements
1700  — Equipment picker, Skill detail
1800  — Custom editors
2000  — Context menu
2100  — System settings
6000  — Custom dialog (highest)
```

## 8.4 Responsive Design

```css
/* Desktop: > 992px  — 3 pane layout */
/* Mobile:  ≤ 992px  — Stacked layout */

@media (max-width: 992px) {
    .game-panel { flex-direction: column; }

    .left-pane, .right-pane {
        position: fixed;
        z-index: 1200;
        transform: translateX(-100%);
        transition: transform 0.3s ease-in-out;
        padding-top: 60px;
    }

    .left-pane { left: 0; width: clamp(280px, 80vw, 350px) !important; }
    .right-pane { right: 0; width: clamp(220px, 60vw, 280px) !important; }

    .game-panel.left-pane-visible .left-pane { transform: translateX(0); }
    .game-panel.right-pane-visible .right-pane { transform: translateX(0); }
}
```

### FAB (Floating Action Button) cho mobile

```css
#fab-container {
    --fab-size: 56px;
    --fab-menu-radius: 110px;
    position: absolute;
    bottom: 80px; right: 20px;
    z-index: 1001;
}
@media (max-width: 992px) {
    #fab-container { --fab-size: 50px; --fab-menu-radius: 80px; }
}
```

## 8.5 Theme System (Day/Night)

```css
/* Night theme (mặc định) */
body { background-color: #1A1D2E; color: #D8DEE9; }

/* Day theme */
body.theme-day {
    --ai-font-color: #3D4F6C;
    --primary-color: #6A8EAF;
    --text-primary: #2c3e50;
    background-color: #F0F4F8;
}
```

## 8.6 State Management

### localStorage (dữ liệu nhỏ < 5MB)
```javascript
localStorage.setItem('game_state', JSON.stringify(state));
const state = JSON.parse(localStorage.getItem('game_state') || '{}');
```

### Dexie.js / IndexedDB (dữ liệu lớn, queries phức tạp)
```html
<script src="https://unpkg.com/dexie/dist/dexie.js"></script>
```
```javascript
const db = new Dexie('GameDatabase');
db.version(1).stores({
  characters: '++id, name, level',
  items: '++id, name, rarity',
  logs: '++id, timestamp, content'
});
await db.characters.add({ name: 'Hero', level: 1 });
```

## 8.7 Communication: Iframe ↔ Parent

```javascript
/* MVU model — AN TOÀN NHẤT */
triggerSlash('/sys Nội_dung')
triggerSlash('/trigger')

/* Self-contained model */
parent.someFunction()
parent.document.querySelector('#something')

/* ⚠️ KHÔNG dùng document.getElementById('send_textarea') trong iframe MVU */
```

## 8.8 External CDN Dependencies

| Library | URL | Dùng cho |
|---------|-----|----------|
| Font Awesome 6 | `cdnjs.cloudflare.com/ajax/libs/font-awesome/6.x/css/all.min.css` | Icons |
| Dexie.js | `unpkg.com/dexie/dist/dexie.js` | IndexedDB wrapper |
| vis-network | `unpkg.com/vis-network/standalone/umd/vis-network.min.js` | Graphs |
| html2canvas | `cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js` | Screenshot |
| Google Fonts | `fonts.googleapis.com/css2?family=...` | Typography |

> **Nguyên tắc:** Pin phiên bản, ưu tiên unpkg/cdnjs, tải async, cân nhắc inline fallback.

## 8.9 Quy tắc Comment trong code

```javascript
/* ĐÚNG — dùng block comment */
/* Hàm khởi tạo game */
function init() { ... }

// SAI — không dùng line comment trong code nhúng inline
// vì khi minify hoặc parse nội tuyến sẽ bị lỗi
```

---

# 9. LOREBOOK

## 9.1 Định dạng Entry — Bắt buộc tuân thủ

### Entry mở đầu (đầu mỗi chủ đề)
```markdown
## [Thế giới quan] bắt đầu

**Keys:** Thế giới quan
**Secondary Keys:** —
**Order:** 0
**Position:** before_char
**Constant:** true

<bắt đầu>
```

### Entry nội dung (đánh số bội 5)
```markdown
## [Thế giới quan 5] Vũ trụ luận và Nguồn gốc thế giới

**Keys:** vũ trụ luận, nguồn gốc, sáng thế, thần thoại sáng tạo
**Secondary Keys:** thiên đình, hư không, primordial
**Order:** 5
**Position:** before_char
**Constant:** false

[Nội dung 3.000–5.000 CHỮ (word count). Viết văn xuôi chi tiết.]
```

### Entry kết thúc (cuối mỗi chủ đề)
```markdown
## [Thế giới quan] kết thúc

**Keys:** Thế giới quan
**Order:** 9999
**Position:** before_char
**Constant:** true

<kết thúc>
```

## 9.2 Quy tắc đánh số

| Quy tắc | Giải thích |
|---------|-----------|
| Entry mở đầu | Order = `0`, tên = `[Chủ đề] bắt đầu` |
| Entry nội dung | Order tăng theo **bội số 5**: 5, 10, 15, 20... |
| Entry kết thúc | Order = `9999`, tên = `[Chủ đề] kết thúc` |
| Giữa các pass | Nối tiếp, KHÔNG reset về 5 |

## 9.3 Quy tắc chất lượng

1. **Mỗi entry tối thiểu 3.000 chữ, tối đa 5.000 chữ** (word count)
2. **Viết văn xuôi chi tiết**, không bullet point đại khái
3. **KHÔNG viết các cụm lười biếng:**
   - "...và nhiều thứ khác"
   - "chi tiết sẽ được bổ sung sau"
   - "tương tự như trên"
   - "(xem entry khác)"
   - Bất kỳ placeholder nào
4. **Cross-reference** bằng tên entry cụ thể nhưng vẫn viết đủ ngữ cảnh
5. **Tính nhất quán** — tên riêng, niên đại, sự kiện phải thống nhất
6. **Chiều sâu hơn chiều rộng** — 3 entry cực chi tiết > 10 entry sơ sài

## 9.4 Cấu trúc entry Lorebook (JSON)

```json
{
  "keys": ["Elf", "Tinh linh"],
  "content": "<tag>\nNội dung...",
  "order": 100,
  "position": "before_char",
  "enabled": true,
  "insertion_order": 100,
  "constant": false,
  "selective": false,
  "secondary_keys": [],
  "scan_depth": null,
  "recursive": true,
  "group_weight": 100
}
```

### Best Practices

- **Entries hệ thống** (`constant: true`): Luôn bật cho quy tắc cốt lõi
- **Entries chủng tộc** (`constant: false`): Chỉ kích hoạt khi nhắc keyword
- **Content format:** Bọc trong tag XML tùy chỉnh (VD: `<Quy tắc kiểm định>...</Quy tắc kiểm định>`)
- **Keys rõ ràng:** Mỗi entry có keywords cụ thể
- **Tránh trùng lặp:** Mỗi domain knowledge 1 entry duy nhất
- **EJS Preprocessing:** Tích hợp tag `@@preprocessing` ở đầu content để kiểm soát nạp động entry nhằm tiết kiệm token.

---

# 10. SYSTEM PROMPT

## 10.1 Template chuẩn

```
Bạn là Narrator — người kể chuyện kiêm Game Master cho thế giới [TÊN THẾ GIỚI].

## Quy tắc nhập vai
- Kể chuyện ngôi thứ ba, giọng văn sử thi
- Mỗi phản hồi dài tối thiểu 400 từ
- Mô tả chi tiết cảnh vật, cảm xúc, hành động
- Không bao giờ nói thay người chơi — chỉ mô tả thế giới phản ứng

## Quy tắc thế giới
- Tuân thủ tuyệt đối lorebook — không bịa đặt lore mới mâu thuẫn
- Hệ thống sức mạnh có giới hạn rõ ràng
- Hậu quả mọi hành động đều tồn tại — không reset

## Keyword UI (BẮT BUỘC)
- Cuối MỖI phản hồi, LUÔN LUÔN thêm keyword: <StatusPlaceHolderImpl/>
- Keyword này bị Regex thay bằng dashboard UI, người chơi không thấy
- TUYỆT ĐỐI KHÔNG quên keyword

## Biến trạng thái (MVU)
- Khi sự kiện ảnh hưởng trạng thái, đính kèm:
  <UpdateVariable>
  <Analysis>
  (Phân tích ngắn gọn bằng tiếng Anh về sự thay đổi, thực hiện check lịch sử xem sự kiện đã được cập nhật chưa để tránh trùng lặp)
  </Analysis>
  <JSONPatch>
  [{"op":"replace","path":"/Người_Chơi/HP","value":85}]
  </JSONPatch>
  </UpdateVariable>
- Tag này bị Regex ẩn khỏi người chơi. Đường dẫn path trong JSON Patch TUYỆT ĐỐI không chứa tiền tố "stat_data".
- Cấm cập nhật các biến chỉ đọc có tiền tố "_" ở tên biến.

## Phong cách viết
- Tiếng Việt, giọng sử thi dễ hiểu
- Dùng hội thoại trực tiếp khi NPC nói
- Mô tả 5 giác quan khi cần
- Không dùng emoji trong tường thuật
```

## 10.2 Yêu cầu khi viết

- Không vượt quá **4.000 từ**
- Bao gồm danh sách tất cả biến MVU/Zod mà AI cần cập nhật
- Bao gồm danh sách tag XML tùy chỉnh
- Bao gồm ví dụ cụ thể format output

---

# 11. first_mes — SPLASH SCREEN

## 11.1 Template chuẩn

```html
Nhấn vào nút bên dưới để bắt đầu:
```html
<!DOCTYPE html>
<html lang="vi-VN">
<head>
<meta charset="UTF-8">
<style>
  body { margin: 0; padding: 0; background: #1a1d2e; color: #e5e9f0; font-family: 'Lora', serif; }
  .splash { text-align: center; padding: 40px; }
  .splash h1 { font-family: 'Cinzel', serif; font-size: 2.5em; color: #ffd700; }
  .splash-form { margin-top: 30px; }
  .splash-select {
    background: #2e3440; color: #e5e9f0; padding: 10px;
    border: 1px solid #4c566a; border-radius: 4px; width: 100%; margin: 10px 0;
  }
  .splash-btn {
    background: #5e81ac; color: white; padding: 12px 30px;
    border: none; border-radius: 6px; font-size: 1.1em; cursor: pointer;
  }
  .splash-btn:hover { background: #81a1c1; }
</style>
</head>
<body>
<div class="splash">
  <h1>⚔️ Tên Game ⚔️</h1>
  <p>Mô tả ngắn về thế giới</p>

  <div class="splash-form">
    <h3>Chọn Xuất Phát Điểm</h3>
    <select class="splash-select" id="select-race">
      <option value="human">Nhân loại</option>
      <option value="elf">Tinh Linh</option>
    </select>
    <select class="splash-select" id="select-region">
      <option value="east">Đông Á</option>
      <option value="west">Tây Âu</option>
    </select>
    <br/><br/>
    <button class="splash-btn" id="btn-start">Bắt Đầu</button>
  </div>

  <div style="margin-top:20px;font-size:0.85em;color:#888">
    <p>⚠️ Bật "Đầu ra dạng luồng (Stream)" để mượt hơn.</p>
  </div>
</div>

<script type="module">
document.getElementById('btn-start').addEventListener('click', () => {
  const race = document.getElementById('select-race').value;
  const region = document.getElementById('select-region').value;
  const cmd = '/sys Bắt đầu. Tôi là ' + race + ', tại ' + region + '. Mô tả bối cảnh.';

  if (typeof triggerSlash === 'function') {
    triggerSlash(cmd);
  }
});
</script>
</body>
</html>
```
```

## 11.2 Lưu ý

1. **Không chứa logic game** — chỉ UI chào mừng + form
2. **CSS tự chứa** — không phụ thuộc main app CSS
3. **Hướng dẫn người dùng** — notes về plugin, cài đặt
4. **Nút bấm** → `triggerSlash('/sys ...')`

---

# 12. CHECKLIST TỰ KIỂM TRA

## 12.1 Kiểm tra Regex của quán rượu

- [ ] Regex khớp với khu vực thẻ (tag)?
- [ ] Dùng `[\s\S]*?` thay vì `.*`?
- [ ] KHÔNG dùng nhóm chụp `()`?
- [ ] Đã chọn "AI đầu ra, chạy khi chỉnh sửa, chỉ định dạng hiển thị"?

## 12.2 Kiểm tra HTML cơ bản

- [ ] Có `<!DOCTYPE html>`, `<head>`, `<body>`?
- [ ] Có `<script type="module">` trong `<head>` (MVU frontend)?
- [ ] Có hàm `init()` + `$(errorCatched(init))`?
- [ ] **KHÔNG** dùng `DOMContentLoaded`?
- [ ] **KHÔNG** dùng `$1` để lấy dữ liệu?
- [ ] Dùng `getChatMessages(getCurrentMessageId())` thay thế?
- [ ] Chú thích dùng `/* */` thay `//`?

## 12.3 Kiểm tra CSS (NGHIÊM NGẶT)

- [ ] `body { margin: 0; padding: 0; }` — margin/padding **PHẢI** là 0.
- [ ] Nếu cần lề → dùng margin/padding cho phần tử chứa bên trong (ví dụ `.container` / `.wrapper`), tuyệt đối KHÔNG set padding cho body.
- [ ] Thiết lập CSS variables cho dark/light themes.
- [ ] Style mượt mà, hỗ trợ responsive với breakpoint `@media (max-width: 992px)`.

## 12.4 Kiểm tra biến MVU (TRỌNG ĐIỂM)

- [ ] Dùng `getAllVariables()`?
- [ ] Tất cả đường dẫn biến bắt đầu bằng `stat_data.` khi đọc trạng thái?
- [ ] Dùng `_.get(vars, 'stat_data.xxx', default_value)`?
- [ ] Biến mảng: duyệt đúng + hiển thị nội dung?
- [ ] Object lồng: dùng `_.get` truy cập đường dẫn?
- [ ] Các đường dẫn trong cập nhật JSON Patch không được có tiền tố `stat_data` (ví dụ: `/Người_Chơi/HP`).
- [ ] Đã hỗ trợ readonly prefix `_` cho các biến nhạy cảm và history deduplication check trong prompt.

## 12.5 Kiểm tra khởi tạo (LOGIC CỐT LÕI)

- [ ] `await waitGlobalInitialized('Mvu')`?
- [ ] `$(errorCatched(init))`?
- [ ] `populateCharacterData()` gọi trong `init()`?
- [ ] `eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, ...)` lắng nghe?

## 12.6 Kiểm tra Script cấu trúc Zod

- [ ] Mở đầu: `import { registerMvuSchema } from '...'`?
- [ ] Kết thúc: `$(() => { registerMvuSchema(Schema); })`?
- [ ] Cú pháp JS đúng (ngoặc, phẩy, nháy)?
- [ ] KHÔNG dùng `.strict()` / `.passthrough()`?
- [ ] KHÔNG dùng `.optional()` ở gốc schema?
- [ ] Dùng `z.coerce.number()` thay `z.number()`?
- [ ] Dùng `.prefault(value)` thay `.default(value)`?
- [ ] Mọi trường con và object/array lồng bắt buộc phải có `.prefault()` để đảm bảo khởi tạo đầy đủ.
- [ ] Dùng `.transform(v => _.clamp())` thay `.min()/.max()`?
- [ ] Chỉ import `registerMvuSchema` (z và _ đã sẵn)?
- [ ] Tính lũy đẳng: `parse(parse(x)) === parse(x)`?

## 12.7 Kiểm tra biến khởi tạo (initvar)

- [ ] Đặt trong entry Worldbook riêng, trạng thái **disabled** (`enabled: false`)?
- [ ] Tên: `[initvar] Tên_mô_tả`?
- [ ] YAML cú pháp đúng?
- [ ] Cấu trúc tương ứng với Zod Schema?

## 12.8 Kiểm tra Worldbook (Lorebook)

- [ ] Mỗi entry: keys rõ ràng, không trùng lặp?
- [ ] Entries quy tắc cốt lõi: `constant: true`?
- [ ] `scan_depth`, `position` phù hợp?
- [ ] `recursive: true` cho entries cần thiết?
- [ ] Tích hợp EJS Preprocessing `@@preprocessing` để ẩn/hiện động entry.

## 12.9 Testing cuối cùng

- [ ] Test desktop (> 992px)
- [ ] Test mobile (≤ 992px)
- [ ] Test encoding tiếng Việt
- [ ] Test với Preset plugin tắt
- [ ] Test tạo chat mới
- [ ] File size < 5MB recommended
- [ ] UTF-8, không escape `\uXXXX`

---

# 13. LỖI THƯỜNG GẶP

| Lỗi | Nguyên nhân | Khắc phục |
|-----|-------------|-----------|
| HTML hiện dạng code, không render | Thiếu bọc `` ```html ``` `` | Bọc replaceString trong fenced code block |
| Chữ Việt bị `á»`, `Ä` | Sai encoding | Re-encode cp1252 → utf-8 |
| Chữ hiện `\u1eadp` | Dùng escape Unicode | Viết UTF-8 trực tiếp |
| Form hiện ở mỗi tin nhắn | findRegex match quá rộng | Dùng keyword duy nhất |
| Nút bấm không hoạt động (MVU) | Dùng DOM API trong iframe | Dùng `triggerSlash()` |
| UI bị treo/freeze | Regex loop vô hạn hoặc JS nặng | Kiểm tra regex, dùng async |
| Card conflict với Preset plugin | Plugin ghi đè regex | Tắt plugin Preset |
| Modal không đóng | Z-index conflict | Kiểm tra hierarchy |
| Mobile layout vỡ | Thiếu responsive | Thêm `@media` rules |
| localStorage mất | User clear browser data | Thêm export/import backup |
| CDN không load | Bị block/timeout | Pin version, inline fallback |
| Biến MVU không cập nhật | Thiếu `stat_data.` prefix khi đọc hoặc có `stat_data.` trong patch | Thêm prefix đúng khi đọc, xóa prefix trong patch |
| Frontend không hiện | Thiếu `waitGlobalInitialized('Mvu')` | Thêm await init |
| Zod parse lỗi | Thiếu `.prefault()` ở trường con hoặc dùng `.strict()` | Tuân thủ Zod 4 rules |

---

# 14. CÂU LỆNH MẪU (PROMPT TEMPLATES)

## 14.1 Prompt cho Pass Lorebook

```
Đây là Pass [X.Y] trong kế hoạch tạo card V3.

## Ngữ cảnh
- Chủ đề: [Tên chủ đề]
- Nhiệm vụ cụ thể: [Nội dung pass này theo bảng]
- Entry bắt đầu từ Order: [số tiếp nối pass trước]
- File seed lore: xem CARD_MASTERY_COMPLETE.md phần 9

## Yêu cầu đầu ra
- Mỗi entry dài 3.000–5.000 CHỮ (word count). KHÔNG ít hơn.
- Định dạng entry theo mục 9.1
- Viết văn xuôi chi tiết, có chiều sâu, nhân quả, hệ quả
- KHÔNG tóm tắt, KHÔNG rút gọn, KHÔNG viết dàn ý
- KHÔNG viết "...và nhiều thứ khác", "chi tiết bổ sung sau"
- Cross-reference entry khác bằng tên cụ thể
- Giữ nhất quán với tất cả entry đã viết trước đó

## Đầu ra
Viết trực tiếp nội dung các entry vào file .md. Không giải thích, không hỏi lại.
Nếu hết token giữa chừng, dừng ở cuối entry gần nhất (không cắt giữa entry).
```

## 14.2 Prompt cho Pass Frontend

```
Đây là Pass [X.Y] — Frontend UI.

## Ngữ cảnh
- Nhiệm vụ: [Nội dung pass theo bảng GĐ 8–9]
- Tham khảo: CARD_MASTERY_COMPLETE.md mục 8
- Kiến trúc: Self-contained SPA, bypass DOMPurify bằng ```html```

## Yêu cầu
- Viết code HTML/CSS/JS hoàn chỉnh, không placeholder
- CSS dùng variables (:root), responsive @media (max-width: 992px)
- body { margin: 0; padding: 0; } — BẮT BUỘC
- Dùng $(errorCatched(init)) — KHÔNG DOMContentLoaded
- Comment dùng /* */ — KHÔNG //
- State dùng localStorage + Dexie.js (self-contained) hoặc getAllVariables() (MVU)
- Prefix stat_data. khi truy cập biến MVU
- Z-index theo hierarchy: modal 1000–2000, dialog 6000
- Tương thích dark theme mặc định

## Đầu ra
Viết code vào file .html. Code phải chạy được, không có TODO.
```

## 14.3 Prompt Kiểm Tra Nhất Quán

```
Kiểm tra tính nhất quán lore của tất cả entry trong Giai đoạn [N].

Kiểm tra:
1. Tên riêng thống nhất? (VD: "Long Đế" vs "Rồng Đế"?)
2. Niên đại mâu thuẫn?
3. Quan hệ nhân quả logic?
4. Chủng tộc / phe phái nhầm thuộc tính?
5. Entry nào dưới 3.000 chữ?
6. Cross-reference chính xác?

Xuất danh sách lỗi (nếu có) và đề xuất sửa.
```

## 14.4 Prompt Ghép Card Cuối Cùng

```
Đây là Pass 10.1 — Ghép card JSON hoàn chỉnh.

Ghép tất cả thành 1 file JSON SillyTavern V3:
- Lorebook: tất cả entry từ GĐ 1–6
- System prompt: từ GĐ 7
- first_mes: từ GĐ 8
- regex_scripts: 3 scripts (ẩn keyword, ẩn tag MVU, render UI)
- Frontend UI: toàn bộ HTML/CSS/JS → nhét vào replaceString
- MVU/Zod schema: từ GĐ 7

Format JSON chuẩn SillyTavern V3. Encoding UTF-8, ensure_ascii=False.
```

## 14.5 Prompt Tạo Zod Schema

```
Tạo Zod Schema cho card [TÊN CARD].

## Danh sách biến cần quản lý
[Liệt kê biến: tên, kiểu, min, max, default]

## Yêu cầu
- Tuân thủ Zod 4 rules (xem CARD_MASTERY_COMPLETE.md mục 5.3)
- z.coerce.number() thay z.number()
- .prefault(default_value) thay .default()
- Mọi trường con, object, array lồng bắt buộc phải có .prefault()
- .transform(v => _.clamp(v, min, max)) thay .min()/.max()
- z.record() ưu tiên hơn z.array()
- Chỉ import registerMvuSchema
- Đảm bảo lũy đẳng
- Kết thúc bằng $(() => { registerMvuSchema(Schema); })
```

## 14.6 Prompt Tạo Frontend MVU

```
Tạo Frontend MVU Status Bar cho card [TÊN CARD].

## Biến cần hiển thị
[Liệt kê biến từ Zod Schema]

## Yêu cầu
- await waitGlobalInitialized('Mvu') trước khi đọc biến
- $(errorCatched(init)) để khởi tạo
- getAllVariables() + _.get(vars, 'stat_data.xxx', default)
- eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, callback)
- body margin:0 padding:0
- Comment /* */ chỉ
- Dark theme mặc định, responsive @media 992px
```

---

# 15. KẾ HOẠCH THỰC HIỆN

## 15.1 Nguyên tắc

- **Lorebook TRƯỚC, Frontend SAU** (UI phụ thuộc biến → cần gameplay trước)
- Mỗi pass = 1 lần gọi AI
- Lưu file sau mỗi pass
- Cuối mỗi giai đoạn: kiểm tra nhất quán

## 15.2 Tổng quan giai đoạn

| GĐ | Nội dung | Loại | Ước tính |
|----|----------|------|----------|
| 1 | Nền tảng thế giới | Lorebook | 6 pass |
| 2 | Chính trị & Địa lý | Lorebook | 7 pass |
| 3 | Chủng tộc & Thế lực | Lorebook | 7 pass |
| 4 | Nhân vật & Sinh vật | Lorebook | 6 pass |
| 5 | Hệ thống & Gameplay | Lorebook | 6 pass |
| 6 | Mở rộng bulk | Lorebook | ~200+ pass |
| 7 | System Prompt + MVU/Zod | Config | 2–3 pass |
| 8 | Frontend UI | Code | 6 pass |
| 9 | Tích hợp & Polish | Code + Config | 5 pass |
| 10 | Ghép card JSON | Assembly | 1–2 pass |

## 15.3 File Output Naming

| Loại | Naming | Gộp thành |
|------|--------|-----------|
| Lorebook | `lorebook_pass_X.Y.md` | `lorebook_[chủ đề].md` → JSON entries |
| Frontend | `frontend_pass_X.Y.html` | 1 `replaceString` hoàn chỉnh |
| Config | `system_prompt.md`, `mvu_schema.json` | Nhúng vào card JSON |

## 15.4 Encoding

- Luôn UTF-8
- Viết tiếng Việt trực tiếp, không escape `\uXXXX`
- `json.dump(data, f, ensure_ascii=False, indent=2)`

---

# PHỤ LỤC: QUICK REFERENCE

## Mẫu init Frontend MVU hoàn chỉnh

```html
<!DOCTYPE html>
<html lang="vi-VN">
<head>
<meta charset="UTF-8">
<script type="module">
async function init() {
  await waitGlobalInitialized('Mvu');
  populateCharacterData();
  eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, populateCharacterData);
}

function populateCharacterData() {
  const vars = getAllVariables();
  if (!vars) return;

  const hp = _.get(vars, 'stat_data.Nhân_vật.HP', 100);
  const maxHp = _.get(vars, 'stat_data.Nhân_vật.Max_HP', 100);
  const name = _.get(vars, 'stat_data.Nhân_vật.Tên', 'Chưa_đặt');
  const gold = _.get(vars, 'stat_data.Nhân_vật.Vàng', 0);

  document.getElementById('char-name').textContent = name;
  document.getElementById('hp-text').textContent = hp + '/' + maxHp;
  document.getElementById('hp-fill').style.width = (hp/maxHp*100) + '%';
  document.getElementById('gold-text').textContent = gold;
}

$(errorCatched(init));
</script>
<style>
  body { margin: 0; padding: 0; background: #1a1d2e; color: #e5e9f0; font-family: 'Lora', serif; }
  .status-bar { display: flex; gap: 15px; padding: 10px 15px; background: rgba(0,0,0,0.3); }
  .stat { display: flex; align-items: center; gap: 6px; }
  .hp-bar { width: 120px; height: 8px; background: #333; border-radius: 4px; overflow: hidden; }
  .hp-fill { height: 100%; background: linear-gradient(90deg, #e74c3c, #e67e22); transition: width 0.3s; }
</style>
</head>
<body>
  <div class="status-bar">
    <div class="stat"><strong id="char-name">...</strong></div>
    <div class="stat">❤️ <span id="hp-text">100/100</span>
      <div class="hp-bar"><div class="hp-fill" id="hp-fill" style="width:100%"></div></div>
    </div>
    <div class="stat">💰 <span id="gold-text">0</span></div>
  </div>
</body>
</html>
```

## Mẫu Zod Schema hoàn chỉnh

```javascript
import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';

export const Schema = z.object({
  Nhân_vật: z.object({
    Tên: z.string().prefault('Chưa_đặt'),
    HP: z.coerce.number().transform(v => _.clamp(v, 0, 999)).prefault(100),
    Max_HP: z.coerce.number().transform(v => _.clamp(v, 1, 999)).prefault(100),
    Vàng: z.coerce.number().transform(v => Math.max(v, 0)).prefault(0),
    Vị_trí: z.string().prefault('Chưa_chọn'),
    Độ_hảo_cảm: z.coerce.number().transform(v => _.clamp(v, 0, 100)).prefault(0),
    Túi_đồ: z.record(
      z.string().describe('Tên_vật_phẩm'),
      z.object({
        Mô_tả: z.string().prefault('Chờ cập nhật'),
        Số_lượng: z.coerce.number().prefault(1),
      }).prefault({})
    ).transform(data => _.pickBy(data, ({Số_lượng}) => Số_lượng > 0)).prefault({}),
  }).prefault({}),
}).prefault({});

$(() => { registerMvuSchema(Schema); });
```

---

> **Cập nhật lần cuối:** 2026-05-20
> **Nguồn tham chiếu:** World Book Tạo Thẻ TMN.json (31 entries), CARD_BUILDING_GUIDE.md, LOREBOOK_CARD_PROMPT.md, MVUZOD_TUTORIAL.md, FRONTEND_TUTORIAL.md, chuyển sinh thành slimev5.42.json

