// (Goal 100.4) Suite kiểm hợp nhất — mọi luật đối chiếu từ source MagVarUpdate.
import { describe, it, expect } from 'vitest';
import { validateMvuCard } from '../validateMvuCard';

const goodInitvar = {
  comment: '[InitVar] Vui lòng không mở', enabled: false, constant: true,
  content: 'Người Chơi:\n  Máu: [100, "máu hiện tại"]',
};
const goodUpdate = {
  comment: '[mvu_update] Định dạng đầu ra', enabled: true,
  content: '<UpdateVariable>\n<Analysis>...</Analysis>\n<JSONPatch>[{"op":"replace","path":"/x","value":1}]</JSONPatch>\n</UpdateVariable>',
};

describe('validateMvuCard — bộ kiểm hợp nhất', () => {
  it('card chuẩn → 0 lỗi', () => {
    const r = validateMvuCard({ entries: [goodInitvar, goodUpdate] });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.stats.initvarEntries).toBe(1);
  });

  it('thiếu [initvar] → error initvar-missing', () => {
    const r = validateMvuCard({ entries: [goodUpdate] });
    expect(r.errors.some((e) => e.code === 'initvar-missing')).toBe(true);
  });

  it('CA THẬT bug cũ: [initvar] đang BẬT → error (engine chỉ nhận khi enabled=false)', () => {
    const r = validateMvuCard({ entries: [{ ...goodInitvar, enabled: true }, goodUpdate] });
    expect(r.errors.some((e) => e.code === 'initvar-enabled')).toBe(true);
  });

  it('CA THẬT bug 78a: khoá phẳng "Player/Name:" → error initvar-flat-keys', () => {
    const r = validateMvuCard({
      entries: [{ ...goodInitvar, content: 'Player/Name: "X"\nPlayer/HP: 100' }, goodUpdate],
    });
    expect(r.errors.some((e) => e.code === 'initvar-flat-keys')).toBe(true);
  });

  it('khối UpdateVariable dùng _.set (phương ngữ hàm) → HỢP LỆ, không bắt oan nữa', () => {
    const r = validateMvuCard({
      entries: [goodInitvar, { ...goodUpdate, content: "<UpdateVariable>\n_.set('Máu', 90);//trúng đòn\n</UpdateVariable>" }],
    });
    expect(r.errors).toEqual([]);
  });

  it('khối UpdateVariable KHÔNG phương ngữ nào → error update-block-invalid (其内的更新命令无效)', () => {
    const r = validateMvuCard({
      entries: [goodInitvar, { ...goodUpdate, content: '<UpdateVariable>chỉ có chữ</UpdateVariable>' }],
    });
    expect(r.errors.some((e) => e.code === 'update-block-invalid')).toBe(true);
  });

  it('CHÍNH BUG #162: form ghi qua kho biến chat của ST → error form-write-path', () => {
    const r = validateMvuCard({
      entries: [goodInitvar, goodUpdate],
      regexScripts: [{ scriptName: 'Form mở đầu',
        replaceString: 'function onConfirm(){ executeSlashCommands(\'/setvar key="x" value="1"\'); }' }],
    });
    expect(r.errors.some((e) => e.code === 'form-write-path')).toBe(true);
    // và chỉ đích danh chỗ sai để user/autofix nhảy tới
    expect(r.errors.find((e) => e.code === 'form-write-path')?.where).toBe('Form mở đầu');
  });

  it('form ghi đúng đường (bug 116 — khuôn One Piece: insertOrAssignVariables message-scoped) → sạch', () => {
    const okForm = `function onConfirm(){ var tree={};
      insertOrAssignVariables({ stat_data: tree }, {type:'message', message_id:'latest'}); }
      function collectFormData(){}`;
    const r = validateMvuCard({ entries: [goodInitvar, goodUpdate], regexScripts: [{ scriptName: 'F', replaceString: okForm }] });
    expect(r.errors).toEqual([]);
  });

  it('rác không nổ: entries rỗng/thiếu field', () => {
    expect(() => validateMvuCard({ entries: [] })).not.toThrow();
    expect(validateMvuCard({ entries: [] }).ok).toBe(false);
  });
});
