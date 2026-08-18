/**
 * injectSystemEntry.ts — MỘT CỬA DUY NHẤT để MVUZOD Studio ghi entry hệ thống vào thẻ.
 * ─────────────────────────────────────────────────────────────────────────────
 * Vì sao cần: trước đây mỗi tab của Studio tự dựng lấy entry, mỗi nơi một kiểu —
 *
 *   tab Update      → comment '[mvu_update]Quy tắc cập nhật biến'      (KHÔNG dấu cách)
 *   tab Biến số     → comment '[mvu_update] Quy tắc cập nhật biến - <tên nhân vật>'
 *   worldbookGenerator/Auto Creator → '[mvu_update] Quy tắc cập nhật biến'
 *
 * mà tab Update lại dò entry cũ bằng SO SÁNH CHUỖI TUYỆT ĐỐI. Nên bấm ở tab này rồi bấm ở tab
 * kia là thẻ có hai (có khi ba) entry quy tắc sống song song, nội dung đá nhau — cùng đúng cái
 * bệnh "ba danh sách action sống song song, AI chỉ đọc được một" của bug 236.
 *
 * Nay mọi đường ghi đều đi qua đây: vị trí/độ sâu/role/thứ tự lấy từ đặc tả DUY NHẤT trong
 * worldbookGenerator.ts, còn việc dò entry cũ dùng SYSTEM_ENTRY_PATTERNS (khớp được cả mấy tên
 * cũ đã lỡ sinh ra) nên bấm lại là CẬP NHẬT chứ không đẻ thêm.
 *
 * KHÔNG tự xoá bản trùng: mẫu dò cố tình lỏng (vd 'biến số' cũng khớp varlist) nên rất dễ trúng
 * entry do người dùng tự viết. Thấy trùng thì báo id ra để người dùng tự quyết.
 */
import type { LorebookEntry } from '../../types/lorebook.types';
import type { MVUZODSchema } from '../../types/mvuzod.types';
import { generateWorldbookEntries, findExistingMVUZODEntries } from '../export/worldbookGenerator';
import { useCardStore } from '../../store/cardStore';

/** Các entry hệ thống mà Studio ghi được — trùng tên với systemId của worldbookGenerator. */
export type MvuSystemEntryId = 'initvar' | 'varlist' | 'update_rules' | 'output_format' | 'emphasis';

export interface InjectResult {
  level: 'success' | 'warning' | 'error';
  message: string;
  /** id entry đã ghi (để UI nhảy tới). */
  entryId?: number;
}

/**
 * Ghi (hoặc cập nhật) một entry hệ thống MVU vào thẻ đang mở.
 * `content` là nội dung cuối cùng — cho phép người dùng/AI sửa trước khi ghi; mọi thứ CÒN LẠI
 * (tên entry, vị trí, depth, role, thứ tự, bật/tắt) đều lấy theo đặc tả chuẩn, không cho tuỳ biến,
 * vì đó là phần engine MVU đòi chứ không phải sở thích.
 */
export function injectMvuSystemEntry(
  systemId: MvuSystemEntryId,
  content: string,
  schema: MVUZODSchema,
): InjectResult {
  const store = useCardStore.getState();
  const entries: LorebookEntry[] = store.card.data.character_book?.entries ?? [];

  const generated = generateWorldbookEntries(schema, entries, {
    include: [systemId],
    replaceExisting: false,
  });
  const spec = generated.entries[0];
  if (!spec) {
    return { level: 'error', message: `Không dựng được entry "${systemId}".` };
  }
  spec.content = content;

  const existingIds = findExistingMVUZODEntries(entries)[systemId] ?? [];

  if (existingIds.length > 0) {
    const [target, ...dups] = existingIds;
    const old = entries.find(e => e.id === target);
    store.updateEntry(target, {
      comment: spec.comment,
      content,
      constant: spec.constant,
      enabled: spec.enabled,
      // ST đọc cờ `disable` (ngược nghĩa `enabled`); thiếu nó thì [initvar] xuất ra vẫn ở trạng
      // thái BẬT và engine không chịu đọc nó làm template.
      disable: !spec.enabled,
      insertion_order: spec.insertion_order,
      position: spec.position,
      extensions: {
        ...(old?.extensions ?? {}),
        ...spec.extensions,
        display_index: old?.extensions?.display_index ?? spec.extensions.display_index,
      },
    });
    return {
      level: dups.length > 0 ? 'warning' : 'success',
      entryId: target,
      message: dups.length > 0
        ? `✅ Đã cập nhật entry #${target} — nhưng thẻ còn ${dups.length} entry cùng loại (#${dups.join(', #')}), nên xoá bớt kẻo AI đọc phải bản cũ.`
        : `✅ Đã cập nhật entry #${target} (${spec.comment})`,
    };
  }

  const id = store.getNextEntryId();
  store.addEntry({ ...spec, id, extensions: { ...spec.extensions, display_index: id } });
  return { level: 'success', entryId: id, message: `✅ Đã tạo entry mới #${id} (${spec.comment})` };
}
