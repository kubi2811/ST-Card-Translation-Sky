/**
 * src/components/shared/SingleThreadToggle.tsx — (bugNeedFix/183) Nút bật/tắt "chỉ 1 luồng API".
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "song song sẽ dễ dẫn tới tình trạng một nhân vật lại có tới 7-8 entry lorebook y hệt
 * nhau" — vì các luồng song song không nhìn thấy nhau, cùng đọc một đoạn truyện rồi mạnh ai
 * nấy sinh. Toggle này khoá van chung ở client.ts (computePoolConcurrency → 1) nên có hiệu lực
 * với MỌI công cụ sinh: tạo/trích từ txt, batch lorebook, quét sâu, wiki, refiner…
 *
 * Trạng thái là TOÀN CỤC và persist — nhiều panel cùng hiện nút này thì phải khớp nhau, nên
 * component tự subscribe qua onSingleThreadChange thay vì mỗi nơi giữ state riêng.
 */
import { useEffect, useState } from 'react';
import { isSingleThreadMode, setSingleThreadMode, onSingleThreadChange } from '../../lib/ai/client';
import { cn } from '../../lib/utils';

export function SingleThreadToggle({ className }: { className?: string }) {
  const [on, setOn] = useState(isSingleThreadMode());
  useEffect(() => onSingleThreadChange(setOn), []);

  return (
    <button
      type="button"
      onClick={() => setSingleThreadMode(!on)}
      title={on
        ? 'ĐANG BẬT: mọi công cụ sinh nội dung gọi API tuần tự từng call một. Chậm hơn, nhưng mỗi lượt sinh đều thấy kết quả lượt trước nên không còn cảnh một nhân vật có 7-8 entry giống nhau. Bấm để trở lại chạy song song.'
        : 'ĐANG TẮT (chạy song song hết tốc RPM). Nếu gặp cảnh một nhân vật ra nhiều entry lorebook na ná nhau, bật nút này: các luồng song song không nhìn thấy nhau nên hay sinh giẫm chân — chạy 1 luồng thì mỗi lượt đều biết những gì đã sinh trước đó.'}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] transition-colors',
        on
          ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
          : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted',
        className,
      )}
    >
      <span aria-hidden>{on ? '🐢' : '⚡'}</span>
      {on ? '1 luồng API (chống trùng)' : 'Đa luồng API'}
    </button>
  );
}

export default SingleThreadToggle;
