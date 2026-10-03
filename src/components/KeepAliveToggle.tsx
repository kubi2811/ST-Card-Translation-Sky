/**
 * (bug 241) Nút 🔊 GIỮ TAB SỐNG trên thanh đầu trang của Hub.
 *
 * User (gogopikachu): "tệp audio khi tắt thì không thể bật lại thủ công được mà phải tắt hẳn cmd và
 * mở lại bằng tệp bat." — Trước đây dòng âm thanh giữ tab chỉ tự bật theo lượt dịch thẻ, không có
 * chỗ nào để nhìn nó đang sống hay chết, cũng không có chỗ nào để bật lại.
 *
 * Nút này:
 *   • hiện đúng trạng thái đo được (đang giữ / bị chặn — cần bấm / tắt), kèm mức dBFS;
 *   • bấm = bật/tắt giữ tab THỦ CÔNG (nhớ qua lần mở sau) — áp cho cả Hub, kể cả các tool con
 *     chạy trong iframe, vì cùng một tab trình duyệt;
 *   • đang bị chặn thì bấm là dựng lại ngay (cú bấm là cử chỉ hợp lệ, trình duyệt cho phát).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Volume2, VolumeX, AlertTriangle } from 'lucide-react';
import {
  subscribeKeepAlive, getKeepAliveStatus, setManualKeepAlive, isManualKeepAliveSaved, pokeKeepAlive,
  acquireKeepAlive,
} from '../utils/keepAlive';

export default function KeepAliveToggle() {
  const st = useSyncExternalStore(subscribeKeepAlive, getKeepAliveStatus, getKeepAliveStatus);
  const manual = st.holders.includes('manual');
  // Thanh đầu trang chật ở màn hẹp — lúc đó chỉ hiện biểu tượng (màu vẫn báo trạng thái).
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1200);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1199px)');
    const on = () => setCompact(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // Lần trước đã bật tay → bật lại ở cú bấm ĐẦU TIÊN của phiên này (trình duyệt không cho phát âm
  // thanh khi chưa có cử chỉ người dùng, nên không bật ngay lúc tải trang được).
  useEffect(() => {
    if (!isManualKeepAliveSaved()) return;
    const once = () => { acquireKeepAlive('manual'); pokeKeepAlive(false); };
    document.addEventListener('pointerdown', once, { capture: true, once: true });
    return () => document.removeEventListener('pointerdown', once, { capture: true });
  }, []);

  const onClick = () => {
    if (st.running && st.health !== 'ok') { pokeKeepAlive(); return; }   // đang hỏng → dựng lại
    setManualKeepAlive(!manual);
  };

  const others = st.holders.filter(h => h !== 'manual');
  let color = 'var(--text-muted, #9a96ad)';
  let label = 'Giữ tab: tắt';
  let Icon = VolumeX;
  if (st.running && st.health === 'ok') {
    color = '#7ee2a8'; Icon = Volume2;
    label = manual ? 'Giữ tab: bật' : 'Giữ tab: tự động';
  } else if (st.running) {
    color = '#ffcf70'; Icon = AlertTriangle;
    label = st.health === 'blocked' ? 'Giữ tab: bị chặn — bấm' : 'Giữ tab: yếu — bấm';
  }

  const title = [
    label,
    'Phát một dòng âm thanh tai người không nghe được để trình duyệt (Edge/Chrome) KHÔNG cho tab ngủ khi chạy nền.',
    st.running
      ? `Đang giữ cho: ${[manual ? 'bật tay' : '', ...others.map(h => h === 'translation' ? 'lượt dịch thẻ' : h === 'heavy-script' ? 'Script nặng' : h.startsWith('field:') ? 'dịch lẻ' : h)].filter(Boolean).join(', ')}.`
      : 'Đang tắt — tự bật khi có lượt dịch, hoặc bấm để bật tay.',
    st.db !== null && Number.isFinite(st.db) ? `Mức đo: ${st.db.toFixed(0)} dBFS (cần trên -72).` : '',
    st.restarts ? `Đã tự dựng lại ${st.restarts} lần.` : '',
    st.running && st.health !== 'ok' ? 'Bấm để bật lại ngay.' : (manual ? 'Bấm để tắt giữ tay.' : 'Bấm để bật giữ tay (nhớ cho lần sau).'),
  ].filter(Boolean).join('\n');

  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
        fontSize: '0.78rem', fontWeight: 700, whiteSpace: 'nowrap',
        color, background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${st.running ? color : 'rgba(255,255,255,0.12)'}`,
      }}
    >
      <Icon size={14} strokeWidth={2.4} />
      {!compact && <span>{label}</span>}
    </button>
  );
}
