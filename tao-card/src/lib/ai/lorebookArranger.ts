/**
 * lorebookArranger.ts — (bug 191) AI SẮP XẾP LẠI order & config cho TOÀN BỘ lorebook.
 * ─────────────────────────────────────────────────────────────────────────────
 * Vì sao cần: autoConfig lúc sinh để AI tự điền order/position/depth theo TỪNG batch — mỗi
 * batch tự bịa số theo cách hiểu riêng, cả bộ lorebook thành mớ order chắp vá không theo hệ
 * nào ("sắp xếp không đúng" user báo). Cách sửa KHÔNG phải là bắt AI đoán số giỏi hơn, mà là
 * TÁCH ĐÔI việc:
 *   • AI chỉ làm việc AI giỏi: ĐỌC HIỂU nội dung và phân loại entry (nhân vật? địa danh? luật?);
 *   • Con số thì máy áp theo BẢNG CHUẨN worldbook (đúng bảng Group 1-5 mà "Tạo thẻ từ truyện"
 *     dùng — entryPlacement, order 900/800/200/150/120/100) — tất định, nhất quán cả bộ.
 * Kết quả trả về dạng DANH SÁCH THAY ĐỔI để user duyệt trước khi áp — không lặng lẽ ghi đè.
 */
import type { ProxyProfile, GenerationParams, LorebookEntry } from '../../types';
import { callAI, computePoolConcurrency } from './client';
import { tag, allTags, runPool } from './storyToCard';
import { entryPlacement, type EntryCat } from './storyDeepScan';

const CATS: EntryCat[] = ['meta', 'worldview', 'system', 'mechanic', 'rule', 'character', 'faction', 'location', 'item', 'history', 'culture', 'term', 'timeline', 'style', 'other'];

export interface ArrangeChange {
  id: number;
  comment: string;
  cat: EntryCat;
  /** Mô tả từng khác biệt, vd "order 10 → 200" — để user thấy mình sắp đồng ý cái gì. */
  diffs: string[];
  patch: {
    constant: boolean;
    selective: boolean;
    insertion_order: number;
    position: LorebookEntry['position'];
    ext: { position: 0 | 1 | 4; depth: number; role: 0 | null };
  };
}

export interface ArrangeResult {
  changes: ArrangeChange[];
  /** Entry đã đúng chuẩn — không cần đổi gì. */
  okCount: number;
  /** Entry kỹ thuật (EJS/MVU/initvar/@@) — config của chúng là CHỦ Ý, không được đụng. */
  skipped: Array<{ id: number; comment: string }>;
  /** Entry AI không phân loại được (thiếu trong output) — không đổi gì cho chúng. */
  unclassified: Array<{ id: number; comment: string }>;
}

/** Entry kỹ thuật: script EJS, biến MVU, initvar… — cấu hình của chúng là chủ ý, cấm sắp lại. */
export function isTechnicalEntry(e: LorebookEntry): boolean {
  const c = `${e.comment || ''}`;
  const body = e.content || '';
  return /@@|(\[\s*initvar)|(\[\s*mvu)|(\bEJS\b)/i.test(c)
    || /@@preprocessing|<%[_=-]?|\[initvar\]|\[mvu_update\]/i.test(body.slice(0, 400));
}

/** Bóc kết quả phân loại `<cls><e><id>3</id><cat>character</cat></e>…</cls>`. */
export function parseClassification(text: string): Map<number, EntryCat> {
  const out = new Map<number, EntryCat>();
  const block = tag(text, 'cls') || text;
  for (const e of allTags(block, 'e')) {
    const id = Number(tag(e, 'id').trim());
    const cat = tag(e, 'cat').trim().toLowerCase() as EntryCat;
    if (!Number.isFinite(id)) continue;
    out.set(id, CATS.includes(cat) ? cat : 'other');
  }
  return out;
}

/** Máy áp bảng chuẩn: trả thay đổi cần làm cho một entry (null = đã đúng chuẩn). */
export function buildArrangeChange(e: LorebookEntry, cat: EntryCat): ArrangeChange | null {
  const p = entryPlacement(cat);
  const constant = p.constant;
  const selective = !p.constant;
  const ext = (e.extensions ?? {}) as { position?: number; depth?: number; role?: number | null };
  const diffs: string[] = [];
  if (!!e.constant !== constant) diffs.push(`constant ${e.constant ? 'BẬT' : 'tắt'} → ${constant ? 'BẬT' : 'tắt'}`);
  if (!!e.selective !== selective) diffs.push(`selective ${e.selective ? 'BẬT' : 'tắt'} → ${selective ? 'BẬT' : 'tắt'}`);
  if ((e.insertion_order ?? 0) !== p.order) diffs.push(`order ${e.insertion_order ?? 0} → ${p.order}`);
  if (e.position !== p.position) diffs.push(`vị trí ${e.position} → ${p.position}`);
  if ((ext.position ?? -1) !== p.extPosition) diffs.push(`position(ext) ${ext.position ?? '?'} → ${p.extPosition}`);
  if ((ext.depth ?? -1) !== p.depth) diffs.push(`depth ${ext.depth ?? '?'} → ${p.depth}`);
  const curRole = ext.role === undefined ? null : ext.role;
  if ((curRole ?? null) !== (p.role ?? null)) diffs.push(`role ${curRole ?? 'null'} → ${p.role ?? 'null'}`);
  if (diffs.length === 0) return null;
  return {
    id: e.id, comment: e.comment, cat, diffs,
    patch: {
      constant, selective, insertion_order: p.order, position: p.position,
      ext: { position: p.extPosition, depth: p.depth, role: p.role },
    },
  };
}

const CLASSIFY_SYSTEM = `Bạn là chuyên gia phân loại entry Lorebook (World Info) SillyTavern.
Với MỖI entry (id + tên + keys + trích nội dung), chọn ĐÚNG MỘT loại:
meta (quy tắc hệ thống/meta cho AI) | worldview (thế giới quan vĩ mô) | system (hệ thống sức mạnh/tu luyện/kinh tế) | mechanic (cơ chế vận hành) | rule (luật lệ/quy tắc thế giới) | character (nhân vật/NPC) | faction (phe phái/tổ chức/gia tộc/tôn giáo) | location (địa danh/khu vực) | item (vật phẩm/trang bị) | history (lịch sử/truyền thuyết) | culture (văn hoá/phong tục) | term (thuật ngữ) | timeline (dòng thời gian) | style (văn phong) | other.
Phân loại theo NỘI DUNG THẬT của entry, không đoán theo tên. Không chắc thì chọn loại gần nhất, KHÔNG bỏ sót entry nào.
CHỈ xuất đúng khối sau, mỗi entry một dòng <e>, không viết gì ngoài:
<cls>
<e><id>ID</id><cat>loại</cat></e>
…
</cls>`;

export interface ArrangeOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Chạy toàn bộ: phân loại bằng AI (model phụ nếu có — việc máy móc) theo lô 30, song song qua
 * pool, rồi máy áp bảng chuẩn. KHÔNG ghi gì vào store — trả danh sách thay đổi cho user duyệt.
 */
export async function arrangeLorebook(
  entries: LorebookEntry[],
  profile: ProxyProfile,
  params: GenerationParams,
  opts: ArrangeOptions = {},
): Promise<ArrangeResult> {
  const skipped = entries.filter(isTechnicalEntry).map(e => ({ id: e.id, comment: e.comment }));
  const workable = entries.filter(e => !isTechnicalEntry(e));

  const BATCH = 30;
  const batches: LorebookEntry[][] = [];
  for (let i = 0; i < workable.length; i += BATCH) batches.push(workable.slice(i, i + BATCH));

  const catById = new Map<number, EntryCat>();
  let done = 0;
  const conc = Math.max(1, Math.min(computePoolConcurrency(profile), batches.length || 1));
  await runPool(batches, conc, async (batch) => {
    const user = batch.map(e =>
      `<entry><id>${e.id}</id><name>${e.comment}</name><keys>${(e.keys || []).slice(0, 8).join(', ')}</keys><body>${(e.content || '').replace(/\s+/g, ' ').slice(0, 300)}</body></entry>`,
    ).join('\n');
    const raw = await callAI({
      profile, params: { ...params, useJsonResponseFormat: false },
      messages: [
        { role: 'system', content: CLASSIFY_SYSTEM },
        { role: 'user', content: `Phân loại ${batch.length} entry sau:\n${user}` },
      ],
      signal: opts.signal, useSecondary: true, label: 'Phân loại entry (sắp xếp order)',
    });
    for (const [id, cat] of parseClassification(raw.text)) catById.set(id, cat);
    done++;
    opts.onProgress?.(done, batches.length);
  });

  const changes: ArrangeChange[] = [];
  const unclassified: Array<{ id: number; comment: string }> = [];
  let okCount = 0;
  for (const e of workable) {
    const cat = catById.get(e.id);
    if (!cat) { unclassified.push({ id: e.id, comment: e.comment }); continue; }
    const ch = buildArrangeChange(e, cat);
    if (ch) changes.push(ch);
    else okCount++;
  }
  return { changes, okCount, skipped, unclassified };
}
