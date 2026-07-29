# Kế hoạch: LÕI LOREBOOK DÙNG CHUNG

> Mục tiêu user đặt ra: *"xây dựng lõi thống nhất để áp dụng cho các tính năng tạo Lorebook.
> Đồng bộ hoá chất lượng cao cho tất cả, dễ nâng cấp toàn diện khi sửa lõi chung, nhưng vẫn giữ
> được tính độc lập và khả năng tạo ra các nội dung/góc nhìn xung đột, đa dạng cho từng trường
> hợp cụ thể — một bên tạo Lorebook chất lượng thì bên còn lại cũng chất lượng theo nhưng không
> xung đột nhau."*

Viết sau khi bug 150 (`007e2c5`) hoàn tất. Đây là **kế hoạch**, chưa đụng code.

---

## 1. Hiện trạng — đo được, không phải cảm tính

Có **6 nơi sinh entry lorebook**, và chất lượng lệch nhau rất xa:

| Nơi sinh entry | chống đệ quy | order | position | depth | khử trùng | nhất quán | từ khoá |
|---|---|---|---|---|---|---|---|
| `ai/batchGenerator.ts` (AI Sinh Batch) | **0** | 18 | 21 | 38 | 15 | 6 | 43 |
| `ai/storyDeepScan.ts` (Từ truyện, bug 150) | 1 | 1 | 11 | 10 | 8 | 4 | 14 |
| `export/worldbookGenerator.ts` (xuất) | 1 | 7 | 9 | 12 | 5 | **0** | 3 |
| `ai/autoCreatorPrompts.ts` (Auto Creator) | **0** | **0** | **0** | 2 | 3 | **0** | 1 |
| `ai/lorebookAgent.ts` | **0** | **0** | **0** | **0** | 5 | **0** | 12 |
| `wikiImport/entryGen.ts` (Cào wiki) | **0** | **0** | **0** | **0** | **0** | **0** | 2 |

*(số lần khái niệm đó xuất hiện trong file — đo bằng grep, dùng làm chỉ dấu độ phủ)*

Chuẩn worldbook của chính user (`bug/150/chinh lorebook.txt`) ghi rõ:

> `Recursion_Prevention: … Áp dụng **bắt buộc cho toàn bộ 100%** các mục bên dưới để chống sụp đổ bộ nhớ.`

Chỉ **2/6** nơi có nhắc tới nó.

### Điều bất ngờ: hạ tầng dùng chung ĐÃ CÓ SẴN

| Module dùng chung | Dòng | Generator nào đang gọi |
|---|---|---|
| `worldbook/worldbookConfig.ts` | 438 | chỉ `batchGenerator` |
| `worldbook/entryGroupAnalyzer.ts` | 492 | **không generator nào** |
| `worldbook/lorebookCategorizer.ts` | 307 | **không generator nào** |
| `worldbook/worldbookHealthCheck.ts` | 285 | **không generator nào** |
| `worldbook/tagManager.ts` | 233 | **không generator nào** |
| `worldbook/keyInput.ts` | 43 | chỉ `lorebookAgent` |
| `ai/deduplicator.ts` | 433 | `batchGenerator`, `storyDeepScan` |
| `ai/coherenceManager.ts` | 80 | chỉ `batchGenerator` |

**Gần 2.300 dòng hạ tầng chất lượng đã viết rồi, nhưng 4/6 generator không gọi một dòng nào.**

Kết luận quan trọng cho kế hoạch: **đây không phải bài toán xây lõi mới — mà là bài toán BẮT BUỘC DÙNG lõi đã có.** Viết thêm module thứ chín không giải quyết gì; phải có cơ chế khiến việc không dùng trở thành **không thể**.

---

## 2. Nguyên tắc: tách "DỰNG THẾ NÀO" khỏi "NÓI GÌ"

Yêu cầu của user nghe như mâu thuẫn (thống nhất **nhưng** vẫn xung đột được). Nó chỉ mâu thuẫn khi
gộp hai thứ khác hẳn nhau vào một chữ "lorebook":

| | Ai quyết | Có được khác nhau? |
|---|---|---|
| **Cơ học entry** — strategy, position, depth, order, prevent recursion, dạng keys, ngân sách token | **Máy**, tất định | **KHÔNG.** Khác nhau là hỏng. |
| **Nội dung entry** — viết về chủ đề gì, giọng nào, sâu tới đâu, đứng từ góc nhìn nào | **Lăng kính của từng tính năng** | **CÓ, và nên khác.** |

Toàn bộ kế hoạch này chỉ là: kéo cột 1 về một chỗ, để nguyên cột 2 cho từng tính năng.

### 2.1. Phân biệt XUNG ĐỘT TỐT với VA CHẠM XẤU

Đây là chỗ tinh tế nhất trong yêu cầu, và cũng là chỗ dễ làm hỏng nhất nếu đồng bộ hoá thô bạo.

**Xung đột TỐT — phải giữ, thậm chí khuyến khích:**
> Entry `<Faction> Minh Đình` kể trận Tùng Cẩm là "bị phản bội";
> entry `<Faction> Hậu Kim` kể đúng trận đó là "chiến thắng nhờ mưu".

Hai entry mâu thuẫn nhau về **sự thật trong truyện** — đó chính là lore hay. Bộ kiểm nhất quán
hiện tại sẽ báo đây là "mâu thuẫn" và đòi sửa. **Sai.**

**VA CHẠM XẤU — phải chặn tuyệt đối:**
> Hai entry cùng `constant`, cùng `depth 0`, cùng `order 900`, cùng tranh một chỗ trong prompt.
> Hoặc: Cào wiki chạy lần hai, đẻ ra bản sao của chính entry nó tạo lần trước.

Đây là hỏng cơ học, không liên quan gì tới nội dung.

**Cách phân biệt bằng máy:** thêm trường `perspective` (góc nhìn) vào entry. Hai entry cùng chủ đề
nhưng **khác `perspective`** → bộ kiểm nhất quán hiểu là cố ý, không báo lỗi, và còn tự thêm câu
dẫn "theo góc nhìn của X". Cùng chủ đề mà **cùng `perspective`** → mới là mâu thuẫn thật, phải gộp
hoặc sửa.

Không có trường này thì mọi nỗ lực "đồng bộ chất lượng" sẽ nghiền phẳng đúng cái làm lore hay.

---

## 3. Kiến trúc ba tầng

```
┌─ TẦNG 3 · LĂNG KÍNH (mỗi tính năng một bản, tự do khác nhau) ─────────┐
│  Auto Creator · Từ truyện · AI Sinh Batch · Cào wiki · EJS · Mod Card │
│  khai báo: chủ đề cần phủ, giọng văn, độ sâu, perspective, độ nghiêm  │
│  của bộ kiểm, và ĐƯỢC PHÉP xung đột nội dung với lăng kính khác       │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ trả về EntryDraft[] (thô, chỉ có nội dung)
┌───────────────────────────▼─── TẦNG 2 · BỘ KIỂM CHẤT LƯỢNG ──────────┐
│  khử trùng lặp · nhất quán (biết tha xung đột cố ý) · sót chữ Hán     │
│  · lẫn {{user}} với nhân vật chính · health check · ngân sách token   │
│  DÙNG CHUNG code, nhưng ĐỘ NGHIÊM do lăng kính chỉnh                  │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ trả về EntryDraft[] (đã sạch)
┌───────────────────────────▼─── TẦNG 1 · HỢP ĐỒNG ENTRY ──────────────┐
│  TẤT ĐỊNH, KHÔNG AI ĐƯỢC BỎ QUA:                                     │
│  category → strategy/position/depth/order (worldbookConfig)          │
│  preventRecursion = true (100%, theo chuẩn user)                     │
│  keys chuẩn hoá (sanitizeAiKeys) · provenance · uid ổn định          │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ trả về LorebookEntry[] hợp lệ
                            ▼
                     Card / file xuất ra
```

**Điểm mấu chốt kiến trúc:** tầng 1 là **cổng ra duy nhất**. Không tính năng nào được tự tay dựng
`LorebookEntry` nữa — muốn có entry thì phải đi qua đây. Nhờ vậy, sửa tầng 1 một lần là cả 6 tính
năng lên theo, đúng yêu cầu "dễ nâng cấp toàn diện".

### 3.1. Tầng 1 — Hợp đồng entry (`lib/worldbook/entryContract.ts`, mới)

```ts
// KHÔNG gọi AI. Thuần tất định ⇒ test được 100%, chạy tức thì.
export interface EntryDraft {
  category: EntryCategory;      // -> quyết định toàn bộ cơ học, lăng kính KHÔNG được ghi đè
  title: string;
  content: string;
  keys: string[];
  perspective?: string;         // (2.1) góc nhìn — cho phép xung đột nội dung có chủ ý
  source: SourceId;             // 'auto-creator' | 'story' | 'batch' | 'wiki' | 'ejs' | 'mod'
  topicKey: string;             // danh tính bền của chủ đề, dùng để cập-nhật-thay-vì-đẻ-thêm
}

export function sealEntry(draft: EntryDraft, ctx: CardContext): LorebookEntry;
export function sealAll(drafts: EntryDraft[], ctx: CardContext): SealResult;
```

`sealEntry` áp: preset theo category từ `worldbookConfig`, `preventRecursion`/`preventSecondaryRecursion`
= true không ngoại lệ, chuẩn hoá keys, gắn provenance, sinh uid ổn định từ `source+topicKey`.

### 3.2. Tầng 2 — Bộ kiểm dùng chung (`lib/worldbook/qualityGate.ts`, mới)

Gom `deduplicator` + `coherenceManager` + `worldbookHealthCheck` + `cjkResidue` + `userPersonaSwap`
sau một cửa duy nhất, nhận `GateProfile` từ lăng kính:

```ts
interface GateProfile {
  dedupThreshold: number;        // wiki cần lỏng (nhiều bài gần nhau), truyện cần chặt
  allowCrossPerspective: boolean;// true = tha xung đột giữa các perspective khác nhau
  minContentChars: number;
  requireKeys: boolean;          // entry constant thì không cần keys
}
```

Đây là chỗ giữ "tính độc lập": **cùng một bộ kiểm, khác ngưỡng.** Không phải mỗi nơi tự viết một
bộ kiểm riêng như hiện nay.

### 3.3. Tầng 3 — Lăng kính (`lib/worldbook/lenses/*.ts`, mới)

Mỗi tính năng khai báo, **không chứa logic cơ học**:

```ts
export const STORY_LENS: Lens = {
  id: 'story',
  topics: ['worldview','timeline','character','faction','location','item','power-system','term'],
  voice: 'Bám sát văn phong tác giả (Style Profile); không bịa; dữ liệu thiếu ghi "chưa xác định".',
  gate: { dedupThreshold: 0.82, allowCrossPerspective: true, minContentChars: 200, requireKeys: true },
  perspectiveOf: (t) => t.factionName,   // entry phe phái mang góc nhìn của chính phe đó
};
```

Prompt cụ thể vẫn nằm ở tính năng — lăng kính chỉ khai báo *khung*, không nuốt mất sự khác biệt.

---

## 4. Không va chạm khi nhiều tính năng ghi vào cùng một card

Đây là vế "*một bên chất lượng thì bên còn lại cũng chất lượng theo nhưng không xung đột nhau*".

Hiện tại chạy Auto Creator xong rồi chạy Cào wiki là **đẻ thêm entry trùng**, vì không có gì cho
biết entry nào của ai. Hợp đồng entry giải quyết bằng `source + topicKey`:

- Chạy lại **cùng một** tính năng → cập nhật đúng entry của chính nó (không đẻ thêm).
- Tính năng **khác** ghi vào cùng chủ đề → không đè lên, mà nối thành entry mới có `perspective`
  riêng, hoặc đề xuất gộp cho user quyết. **Máy không tự xoá lore của ai.**
- Bảng "Nguồn" trong UI cho user lọc/xoá theo từng nguồn.

---

## 5. Cơ chế BẮT BUỘC tuân thủ — phần quan trọng nhất

Bài học từ chính hiện trạng: có module chung mà không có cơ chế ép thì **4/6 nơi sẽ không dùng**.
Ba lớp ép, từ mềm tới cứng:

1. **Sổ đăng ký lăng kính** — `LENSES` là mảng duy nhất. Thêm tính năng sinh lorebook mà quên đăng
   ký thì không có đường nào ra được `LorebookEntry`.

2. **Test tuân thủ chạy trên MỌI lăng kính** (`__tests__/lensConformance.test.ts`):
   ```ts
   for (const lens of LENSES) {
     it(`${lens.id}: entry sinh ra phải qua hợp đồng`, () => {
       const out = sealAll(fixtureDraftsFor(lens), CTX);
       expect(out.every(e => e.preventRecursion)).toBe(true);       // chuẩn user, 100%
       expect(out.every(e => e.position !== undefined)).toBe(true);
       expect(collisions(out)).toEqual([]);                          // không đụng slot
     });
   }
   ```
   Thêm lăng kính mới là test tự động phủ luôn — không phải nhớ viết thêm test.

3. **Chặn đường tắt bằng lint**: cấm `import type { LorebookEntry }` rồi tự khởi tạo ngoài
   `entryContract.ts`. Ai muốn đi tắt sẽ gãy ở CI chứ không gãy ở tay người dùng.

---

## 6. Lộ trình — 5 giai đoạn, mỗi giai đoạn tự đứng được

Không làm "đại tu một phát". Mỗi giai đoạn có giá trị riêng và có thể dừng lại ở đó.

| GĐ | Việc | Được gì ngay | Rủi ro |
|---|---|---|---|
| **0** | Viết `entryContract.ts` + test tuân thủ, **chưa nối vào đâu** | Có chuẩn chạy được để đối chiếu; đo được hiện trạng lệch chuẩn bao nhiêu | Gần như không |
| **1** | Nối **cổng ra** cho cả 6 generator: output đi qua `sealAll` | 4 nơi yếu lên chuẩn ngay (đặc biệt Cào wiki — hiện 0 cơ chế nào). **Không đụng prompt** nên nội dung không đổi | Thấp; test hồi quy bắt được |
| **2** | Gom bộ kiểm về `qualityGate` + `GateProfile` | Hết cảnh mỗi nơi một kiểu khử trùng; chỉnh ngưỡng một chỗ | Trung bình — ngưỡng cũ cần dò lại |
| **3** | Thêm `perspective` + cho bộ kiểm tha xung đột cố ý | Mở khoá lore đa góc nhìn mà không bị báo lỗi giả | Trung bình |
| **4** | `source + topicKey` + màn hình gộp theo nguồn | Chạy nhiều tính năng chồng lên nhau không đẻ rác | Cao nhất — đụng dữ liệu card có sẵn, cần đường di trú |

**Đề xuất bắt đầu từ GĐ 0 + 1.** Riêng hai giai đoạn đó đã giải quyết phần lớn "đồng bộ chất
lượng" mà gần như không chạm vào nội dung — tức là phần lợi cao nhất trên mỗi đơn vị rủi ro.
GĐ 3 và 4 nên làm sau khi 1-2 đã chạy thật vài card.

---

## 7. Rủi ro & cách giảm

| Rủi ro | Vì sao đáng lo | Giảm bằng |
|---|---|---|
| Đồng bộ hoá **nghiền phẳng** cái hay riêng của từng tính năng | Đây là điều user lo nhất và nói thẳng ra | Lõi **chỉ** cầm cơ học. Prompt/giọng văn không vào lõi. GĐ 1 cố ý không đụng prompt |
| Bộ kiểm nhất quán báo nhầm xung đột cố ý là lỗi | Sẽ ép AI viết lore nhạt đi | `perspective` (GĐ 3) làm trước khi siết ngưỡng nhất quán |
| Sửa lõi làm hỏng cả 6 nơi cùng lúc | Đúng mặt trái của "một chỗ ăn hết" | Test tuân thủ chạy trên mọi lăng kính + card thật trong `bug/` làm mốc |
| GĐ 4 đụng card cũ | Card đã có không mang provenance | Thiếu provenance thì coi là `source: 'unknown'`, **không bao giờ tự xoá**, chỉ đề xuất |
| Làm xong lại không ai dùng (đúng vết xe hiện tại) | Đã xảy ra với 2.300 dòng có sẵn | Mục 5 — đăng ký + test tuân thủ + lint chặn đường tắt |

---

## 8. Việc cần user quyết trước khi bắt tay

1. **Có đồng ý cách phân biệt xung đột-tốt / va-chạm-xấu ở mục 2.1 không**, và trường
   `perspective` có đúng ý "góc nhìn xung đột, đa dạng" mà bạn muốn không?
2. **Bắt đầu từ GĐ 0+1** (an toàn, lợi ngay, không đụng nội dung) hay muốn làm thẳng tới GĐ 3-4?
3. Cào wiki hiện gần như **không có cơ chế chất lượng nào** — có muốn ưu tiên nó lên đầu GĐ 1 không?
