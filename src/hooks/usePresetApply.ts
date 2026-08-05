import { useStore } from '../store';
import { useUi } from '../i18n/useLocale';
import type { FieldGroupConfig } from '../types/card';
import type { RecommendedPreset } from '../utils/presetRecommend';
import { isMvuUpdateField } from '../utils/cardFields';

/**
 * Áp 1 trong 3 preset dịch (⚡ nhẹ / 📖 đầy đủ / 🚀 siêu tốc) — logic DUY NHẤT dùng chung cho
 * cả 3 nút preset trong TranslateConfig lẫn popup "Gợi ý cấu hình" sau khi import card.
 * (Trước đây logic nằm inline trong 3 onClick — popup ra đời thì phải tách, kẻo đúp.)
 */
export function usePresetApply() {
  // (bug 213) selector hẹp — destructure trần từ useStore() là subscribe TOÀN store: mọi
  // set() (addLog/updateField suốt lượt dịch) đều kéo component này re-render dù chẳng liên quan.
  const translationConfig = useStore((s) => s.translationConfig);
  const setTranslationConfig = useStore((s) => s.setTranslationConfig);
  const fields = useStore((s) => s.fields);
  const setFields = useStore((s) => s.setFields);
  const addToast = useStore((s) => s.addToast);
  const setActivePresetId = useStore((s) => s.setActivePresetId);
  const ui = useUi();

  return (preset: RecommendedPreset) => {
    if (preset === 'light') {
      // Bật keys + regex + messages + core + lorebook để LẤY tên card + tên/comment lorebook.
      const lightOn = new Set(['lorebook_keys', 'regex', 'messages', 'core', 'lorebook']);
      setTranslationConfig({
        fieldGroups: translationConfig.fieldGroups.map((g: FieldGroupConfig) => ({
          ...g, enabled: lightOn.has(g.id),
        })),
        // (Fix bug #4) Dịch nhẹ KHÔNG đổi tên biến MVU: ruột card giữ 100% tiếng gốc.
        enableMvuSync: false,
        exportKeyMode: 'merge',
        lorebookStrategy: 'batch',
        lightSkipContent: true,
        surgicalMode: true, // bảo vệ regex/code
      });
      const isNameOrComment = (p: string) => /(^|\.)name$/.test(p) || /\.comment$/.test(p);
      // (Fix bug #13) entry [mvu update] cũng được TICK dịch ở Dịch Nhẹ — đồng bộ với pipeline
      // (useTranslation lightSkipContent) qua cùng 1 helper isMvuUpdateField.
      if (fields.length > 0) {
        setFields(fields.map(f => {
          if (f.group !== 'core' && f.group !== 'lorebook') return f;
          if (isNameOrComment(f.path) || isMvuUpdateField(f)) {
            return f.status === 'ignored' ? { ...f, status: 'pending' as const } : f;
          }
          return f.status === 'done' ? f : { ...f, status: 'ignored' as const };
        }));
      }
      addToast('success', ui.tcPresetLightDone);
    } else if (preset === 'full') {
      setTranslationConfig({
        fieldGroups: translationConfig.fieldGroups.map((g: FieldGroupConfig) => ({ ...g, enabled: true })),
        lightSkipContent: false,
        lorebookStrategy: 'batch',
      });
      setFields(fields.map(f => f.status === 'ignored' ? { ...f, status: 'pending' as const } : f));
      addToast('success', ui.tcPresetFullDone);
    } else {
      // 🚀 Siêu tốc: đầy đủ + gom call thông minh (entry ngắn → model phụ, entry dài → model chính).
      setTranslationConfig({
        fieldGroups: translationConfig.fieldGroups.map((g: FieldGroupConfig) => ({ ...g, enabled: true })),
        lightSkipContent: false,
        lorebookStrategy: 'batch',
        smartBatchPacking: true,
        enableMvuSync: true,
        exportKeyMode: 'merge',
      });
      setFields(fields.map(f => f.status === 'ignored' ? { ...f, status: 'pending' as const } : f));
      addToast('success', ui.tcPresetTurboDone);
    }
    setActivePresetId(preset);
  };
}
