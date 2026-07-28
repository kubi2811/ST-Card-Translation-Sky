// (bug 134) "Áp dụng vào Auto Creator" của AI Sinh Theo Batch đổi từ NÚT BẤM sang CÔNG TẮC.
// User: "không rõ khi Reset trang thì cái AI Sinh Theo Batch có tắt hay không".
// Test khoá đúng hợp đồng của công tắc: bật thì thấy trạng thái, tắt thì HOÀN NGUYÊN cấu hình
// về đúng như trước khi áp — không để lại promptOverride/category mồ côi.
import { describe, it, expect, beforeEach } from 'vitest';
import { useAutoCreatorStore } from '../autoCreatorStore';
import type { AppliedBatchPreset } from '../../types';

const mkPreset = (previousConfig: Record<string, unknown>): AppliedBatchPreset => ({
  appliedAt: '2026-07-28T00:00:00Z',
  tabLabel: 'Nhân vật',
  summary: { totalEntries: 40, entriesPerBatch: 5, concurrentBatches: 3, hasPrompt: true },
  previousConfig: previousConfig as AppliedBatchPreset['previousConfig'],
});

describe('(bug 134) công tắc cấu hình AI Sinh Theo Batch', () => {
  beforeEach(() => {
    useAutoCreatorStore.getState().clearBatchPreset();
    useAutoCreatorStore.getState().updateStepConfig('lorebook', {
      totalEntries: 20, entriesPerBatch: 3, concurrentBatches: 1,
      promptOverride: undefined, promptMode: 'default',
    });
  });

  it('BẬT: cấu hình Batch được ghi đè và trạng thái hiện ra (không còn "không biết đang bật hay tắt")', () => {
    const s = useAutoCreatorStore.getState();
    const prev = s.config.stepConfigs.lorebook;
    s.applyBatchPreset(
      mkPreset({ totalEntries: prev.totalEntries, entriesPerBatch: prev.entriesPerBatch, promptOverride: prev.promptOverride }),
      { totalEntries: 40, entriesPerBatch: 5, promptOverride: 'prompt riêng', promptMode: 'append' },
    );
    const after = useAutoCreatorStore.getState().config;
    expect(after.appliedBatchPreset, 'trạng thái phải nhìn thấy được').toBeTruthy();
    expect(after.appliedBatchPreset!.tabLabel).toBe('Nhân vật');
    expect(after.stepConfigs.lorebook.totalEntries).toBe(40);
    expect(after.stepConfigs.lorebook.promptOverride).toBe('prompt riêng');
  });

  it('TẮT: hoàn nguyên ĐÚNG bản chụp — prompt từng là undefined thì phải XOÁ hẳn, không để chuỗi mồ côi', () => {
    const s = useAutoCreatorStore.getState();
    const prev = s.config.stepConfigs.lorebook;
    s.applyBatchPreset(
      mkPreset({ totalEntries: prev.totalEntries, entriesPerBatch: prev.entriesPerBatch, promptOverride: undefined, promptMode: 'default' }),
      { totalEntries: 40, entriesPerBatch: 5, promptOverride: 'prompt riêng', promptMode: 'append' },
    );
    useAutoCreatorStore.getState().clearBatchPreset();

    const after = useAutoCreatorStore.getState().config;
    expect(after.appliedBatchPreset).toBeUndefined();
    expect(after.stepConfigs.lorebook.totalEntries).toBe(20);
    expect(after.stepConfigs.lorebook.entriesPerBatch).toBe(3);
    expect(after.stepConfigs.lorebook.promptOverride, 'prompt phải biến mất hẳn').toBeUndefined();
    expect(after.stepConfigs.lorebook.promptMode).toBe('default');
  });

  it('TẮT không đụng các cấu hình KHÁC mà công tắc chưa từng ghi', () => {
    const s = useAutoCreatorStore.getState();
    s.updateStepConfig('lorebook', { useWebSearch: true });
    s.applyBatchPreset(mkPreset({ totalEntries: 20 }), { totalEntries: 40 });
    useAutoCreatorStore.getState().clearBatchPreset();
    expect(useAutoCreatorStore.getState().config.stepConfigs.lorebook.useWebSearch).toBe(true);
  });

  it('công tắc Batch và chính sách EJS sống song song — tắt cái này không xoá cái kia', () => {
    const s = useAutoCreatorStore.getState();
    s.applyEjsPolicy({
      appliedAt: '2026-07-28T00:00:00Z', sourceCard: 'C', goal: 'g', rowCount: 2,
      summary: { reclassify: 1, createEjs: 1, character: 0, tokensSaved: 10 }, directive: 'D',
    });
    s.applyBatchPreset(mkPreset({ totalEntries: 20 }), { totalEntries: 40 });
    useAutoCreatorStore.getState().clearBatchPreset();
    expect(useAutoCreatorStore.getState().config.appliedEjsPolicy, 'chính sách EJS không được bay theo').toBeTruthy();
  });
});
