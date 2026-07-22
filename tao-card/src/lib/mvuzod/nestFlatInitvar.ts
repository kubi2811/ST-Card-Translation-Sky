/**
 * (User 22/07 — bug 78) "Nhập Opening Form không cập nhật vào trình quản lý biến + biến không
 * cập nhật vào thanh trạng thái."
 *
 * ═══ Đo trên thẻ thật (bugNeedFix/41) ═══
 *
 * Bốn nơi khai báo biến, KHÔNG cặp nào giao nhau:
 *
 *   Schema Zod       : `Player` > `Name`, `CurrentVP`   (cây, tiếng Anh)
 *   Entry [initvar]  : `Player/Name:`                    ← khoá PHẲNG có dấu `/`
 *   Opening Form     : `Cấp Tầng Hiện Tại`               (nhãn tiếng Việt)
 *   Status Bar       : 0 data-var
 *
 * Module này lo phần initvar. Auto Creator lấy THẲNG chuỗi AI trả về làm nội dung entry, mà AI
 * hay viết khoá phẳng `Player/Name: x` thay vì cây YAML. MVU đọc cái đó thành MỘT khoá tên
 * đúng chữ "Player/Name", không phải Player > Name — nên không khớp schema, không khớp form,
 * và thanh trạng thái đọc ra rỗng.
 */

/** Có khoá nào chứa dấu `/` không — dấu hiệu AI viết phẳng. */
const FLAT_KEY_RE = /^\s*[^\s#:][^:]*\/[^:]*:/m;

/**
 * Dựng lại khoá initvar phẳng (`Player/Name: x`) thành cây YAML thật.
 * Schema vốn đã đúng dạng cây thì trả nguyên văn, không đụng gì.
 */
export function nestFlatInitvarKeys(yaml: string): string {
  const src = String(yaml ?? '');
  if (!FLAT_KEY_RE.test(src)) return src;

  const tree: Record<string, unknown> = {};
  const preamble: string[] = [];

  for (const line of src.split('\n')) {
    const m = line.match(/^(\s*)([^\s#:][^:]*):\s*(.*)$/);
    if (!m) {
      // Giữ lại dòng đầu kiểu `[initvar]` / chú thích — chúng không phải khoá.
      if (line.trim()) preamble.push(line);
      continue;
    }
    const segs = m[2].trim().split('/').filter(Boolean);
    if (segs.length < 2) {
      preamble.push(line);
      continue;
    }
    let node = tree;
    for (const seg of segs.slice(0, -1)) {
      if (typeof node[seg] !== 'object' || node[seg] === null) node[seg] = {};
      node = node[seg] as Record<string, unknown>;
    }
    node[segs[segs.length - 1]] = m[3];
  }

  const out: string[] = [];
  const emit = (node: Record<string, unknown>, depth: number) => {
    const pad = '  '.repeat(depth);
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === 'object') {
        out.push(`${pad}${k}:`);
        emit(v as Record<string, unknown>, depth + 1);
      } else {
        out.push(`${pad}${k}: ${v}`);
      }
    }
  };
  emit(tree, 0);

  return [...preamble, ...out].join('\n');
}
