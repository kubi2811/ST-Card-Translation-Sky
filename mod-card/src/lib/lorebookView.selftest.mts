/**
 * (Làm tiếp việc 88) BÀI TỰ KIỂM cho logic so sánh lorebook sau mod.
 *
 * mod-card (Next.js) không có test runner — lorebookView là logic thuần duy nhất của tính năng
 * "xem entry sau mod" mà trước giờ chỉ được verify tay trong trình duyệt. File này chạy độc lập:
 *     npx tsx src/lib/lorebookView.selftest.mts
 * và được `npm run selftest` gọi. Thoát mã ≠ 0 khi có ca hỏng — gắn được vào CI sau này.
 */
import { listLorebookEntries, findRemovedEntries, summarizeLorebook } from './lorebookView';

type CardV3 = Parameters<typeof listLorebookEntries>[0];

const mk = (entries: Array<{ comment: string; content: string; enabled?: boolean }>): CardV3 => ({
  spec: 'chara_card_v3', spec_version: '3.0',
  data: {
    name: 'T', character_book: {
      entries: entries.map((e, i) => ({
        id: i, keys: [e.comment], secondary_keys: [], comment: e.comment,
        content: e.content, enabled: e.enabled ?? true, insertion_order: i,
      })),
    },
  },
}) as unknown as CardV3;

let fail = 0;
const check = (name: string, ok: boolean) => {
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!ok) fail++;
};

/* ─── Ca 1: mod chèn 1 + sửa 1 + xoá 1 Ở GIỮA (lệch chỉ số hàng loạt) ─── */
{
  const before = mk([
    { comment: 'Bối cảnh', content: 'Thế giới tu tiên rộng lớn.' },
    { comment: 'Lý Tiêu Dao', content: 'Đại đệ tử Thiên Kiếm Tông.' },
    { comment: 'Sẽ bị xoá', content: 'Entry này sẽ biến mất sau mod.' },
    { comment: 'Giữ nguyên', content: 'Không đổi gì.' },
  ]);
  const after = mk([
    { comment: 'Bối cảnh', content: 'Thế giới tu tiên rộng lớn.' },
    { comment: 'Lý Tiêu Dao', content: 'Đại đệ tử Thiên Kiếm Tông. ĐÃ MOD: thêm quá khứ bí ẩn.' },
    { comment: 'Giữ nguyên', content: 'Không đổi gì.' },
    { comment: 'Entry mới', content: 'Do lượt mod thêm vào.' },
  ]);
  const rows = listLorebookEntries(after, before);
  const removed = findRemovedEntries(after, before);
  const sum = summarizeLorebook(rows, removed);
  const by = (c: string) => rows.find(r => r.name === c);

  check('entry sửa → changed', by('Lý Tiêu Dao')?.status === 'changed');
  check('entry mới → added', by('Entry mới')?.status === 'added');
  check('entry không đổi → same (xoá ở giữa KHÔNG làm báo oan — ghép theo tiêu đề, không theo chỉ số)',
    by('Giữ nguyên')?.status === 'same' && by('Bối cảnh')?.status === 'same');
  check('entry bị xoá vào danh sách removed', removed.length === 1 && removed[0].name === 'Sẽ bị xoá');
  check('tóm tắt: added=1 changed=1 removed=1', sum.added === 1 && sum.changed === 1 && sum.removed === 1);
  check('delta của entry sửa là số dương (nội dung dài thêm)', (by('Lý Tiêu Dao')?.delta ?? 0) > 0);
}

/* ─── Ca 2: không có bản trước (mở card lần đầu) → mọi entry là same, không nổ ─── */
{
  const only = mk([{ comment: 'A', content: 'x' }]);
  const rows = listLorebookEntries(only, null);
  check('không có bản trước → không đánh dấu added oan', rows.every(r => r.status === 'same'));
  check('không có bản trước → removed rỗng', findRemovedEntries(only, null).length === 0);
}

/* ─── Ca 3: card rỗng/null → không nổ ─── */
{
  check('card null → mảng rỗng', listLorebookEntries(null).length === 0);
  const sum = summarizeLorebook([], []);
  check('summary trên rỗng → toàn 0', sum.total === 0 && sum.added === 0 && sum.removed === 0);
}

console.log(fail === 0 ? '\n✅ lorebookView selftest: TOÀN BỘ PASS' : `\n❌ CÓ ${fail} CA HỎNG`);
process.exit(fail === 0 ? 0 : 1);
