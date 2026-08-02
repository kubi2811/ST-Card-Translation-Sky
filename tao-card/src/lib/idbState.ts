/**
 * (bug 189) Persist state TO qua IndexedDB — thay localStorage cho những state vượt quota.
 * ─────────────────────────────────────────────────────────────────────────────
 * Vì sao phải có: `usePersistedState` ghi localStorage và NUỐT lỗi quota trong im lặng
 * (catch rỗng). Với DeepScanState của một buổi quét truyện 12 giờ (26k dữ kiện + 2k entry,
 * JSON 5-10MB) thì vượt quota 5MB là gần như chắc chắn → KHÔNG một lần lưu nào thành công,
 * F5 phát là mất trắng — đúng thảm cảnh "4k call API đi tong" user báo. IndexedDB cho hàng
 * trăm MB nên state cỡ nào cũng sống qua F5.
 *
 * Hook còn tự MIGRATE giá trị cũ từ localStorage (nếu lần trước may mắn lưu lọt) rồi xoá
 * bản localStorage để trả lại quota cho phần còn lại của app.
 */
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

const DB_NAME = 'tc-state';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB không mở được'));
    });
    // DB hỏng (private mode, disk lỗi) → lần gọi sau thử mở lại thay vì kẹt promise chết.
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB lỗi'));
  }));
}

export const idbGet = <T>(key: string): Promise<T | undefined> => tx<T | undefined>('readonly', (s) => s.get(key));
export const idbSet = (key: string, value: unknown): Promise<void> => tx<void>('readwrite', (s) => s.put(value, key));
export const idbDel = (key: string): Promise<void> => tx<void>('readwrite', (s) => s.delete(key));

/**
 * useState lưu qua IndexedDB. Trả thêm cờ `loaded` — false cho tới khi đọc xong bản lưu
 * (đọc IDB là async, khác localStorage; render trước khi loaded thì đừng vẽ phần phụ thuộc).
 *
 * `normalize` chạy MỘT lần trên giá trị vừa nạp — chỗ để sửa các trạng thái "không thể còn
 * đúng sau reload" (vd status 'running' của một tiến trình đã chết theo tab).
 */
export function useIdbState<T>(
  key: string,
  initial: T,
  normalize?: (loaded: T) => T,
): [T, Dispatch<SetStateAction<T>>, boolean] {
  const [state, setState] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSave = useRef(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let value: T | undefined;
      try {
        value = await idbGet<T>(key);
      } catch { /* IDB hỏng → chạy như state thường, còn hơn crash */ }
      if (value === undefined) {
        // Migrate bản localStorage cũ (nếu có) rồi xoá để trả quota.
        try {
          const raw = localStorage.getItem(key);
          if (raw != null) {
            value = JSON.parse(raw) as T;
            localStorage.removeItem(key);
            void idbSet(key, value).catch(() => {});
          }
        } catch { /* bản cũ hỏng → bỏ */ }
      }
      if (cancelled) return;
      if (value !== undefined) {
        skipNextSave.current = true;
        setState(normalize ? normalize(value) : value);
      }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
    // key cố định theo call-site; normalize chỉ dùng lúc nạp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    // Debounce: pipeline emit state liên tục (mỗi chunk xong một lần) — ghi IDB mỗi lần là phí.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void (state === undefined || state === null
        ? idbDel(key)
        : idbSet(key, state)
      ).catch(() => { /* ghi hỏng thì lần emit sau ghi lại */ });
    }, 600);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [key, state, loaded]);

  return [state, setState, loaded];
}
