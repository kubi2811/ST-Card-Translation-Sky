// (Goal 103) Miền Regex — luật sắt: mọi regex phải compile + chạy thử thật trước khi vào card.
import { describe, it, expect } from 'vitest';
import { createRegexDomain, type RegexDraft } from '../regexAgent';
import { executeGoalPlan, type AgentCallFn, type AgentPlan } from '../goalAgent';
import { buildProgrammaticRegex } from '../../mvuzod/programmaticRegexBuilder';
import { normalizeMVUZODSchema } from '../../mvuzod/normalizeSchema';
import type { RegexScript } from '../../../types';

const SAMPLE = `*Cô ấy mỉm cười.*\n<details>\n<summary>Thinking...</summary>\nsuy nghĩ nội bộ\n</details>\nHết.`;

const ctx = { schema: null, existingScripts: [], sampleText: SAMPLE };

const draft = (over: Partial<RegexScript>): RegexDraft => ({
  stepId: 's1', explanation: '',
  script: {
    scriptName: 'Ẩn thinking', findRegex: '<details>[\\s\\S]*?<\\/details>', replaceString: '',
    trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false,
    runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null, ...over,
  },
});

describe('regexAgent — validate (luật sắt 103)', () => {
  const domain = createRegexDomain(ctx);

  it('regex chuẩn, khớp sample → sạch', () => {
    expect(domain.validate([draft({})])).toEqual([]);
  });

  it('regex KHÔNG compile → error rx-compile', () => {
    const bad = draft({ findRegex: '([unclosed' });
    const issues = domain.validate([bad]);
    expect(issues.some(i => i.code === 'rx-compile' && i.level === 'error')).toBe(true);
  });

  it('regex nhắm AI output nhưng KHÔNG khớp gì trên sample → error rx-no-match', () => {
    const bad = draft({ findRegex: '<khong_ton_tai>[\\s\\S]*?<\\/khong_ton_tai>' });
    const issues = domain.validate([bad]);
    expect(issues.some(i => i.code === 'rx-no-match')).toBe(true);
  });

  it('trùng tên với script có sẵn → error + autofixDeterministic đổi tên miễn phí', () => {
    const d2 = createRegexDomain({ ...ctx, existingScripts: [{ scriptName: 'Ẩn thinking', findRegex: 'x' }] });
    const issues = d2.validate([draft({})]);
    expect(issues.some(i => i.code === 'rx-dup-name')).toBe(true);
    const fix = d2.autofixDeterministic!([draft({})], issues);
    expect(fix.items[0].script.scriptName).toBe('Ẩn thinking (2)');
    expect(d2.validate(fix.items)).toEqual([]);
  });

  it('replaceString HTML/JS vỡ → báo qua rx-replace', () => {
    const bad = draft({ replaceString: '<div><script>function broken( {</script>' });
    const issues = domain.validate([bad]);
    expect(issues.some(i => i.code === 'rx-replace')).toBe(true);
  });
});

describe('regexAgent — parseStepOutput kẹp dữ liệu bậy', () => {
  const domain = createRegexDomain(ctx);
  it('placement bậy bị lọc, rỗng thì mặc định [2]', () => {
    const d = domain.parseStepOutput(JSON.stringify({
      scriptName: 'X', findRegex: 'a', replaceString: '', placement: [9, 'z', 2],
    }), { id: 's1', title: 'X', requirement: '' });
    expect(d.script.placement).toEqual([2]);
    const d2 = domain.parseStepOutput(JSON.stringify({ scriptName: 'Y', findRegex: 'a', placement: [] }),
      { id: 's2', title: 'Y', requirement: '' });
    expect(d2.script.placement).toEqual([2]);
  });
});

describe('regexAgent — đủ vòng qua goalAgent với mock AI', () => {
  it('bước sinh regex sai → vòng sửa AI vá → ok, giữ nguyên tên', async () => {
    const domain = createRegexDomain(ctx);
    const plan: AgentPlan = {
      scope: 't', estCalls: 2,
      steps: [{ id: 's1', title: 'Ẩn thinking', requirement: 'ẩn khối details' }],
    };
    const badResp = JSON.stringify({ scriptName: 'Ẩn thinking', findRegex: '([unclosed', replaceString: '', placement: [2] });
    const goodResp = JSON.stringify({ scriptName: 'Tên Khác Bị Đổi', findRegex: '<details>[\\s\\S]*?<\\/details>', replaceString: '', placement: [2], markdownOnly: true });
    const call: AgentCallFn = async (messages) => {
      const last = messages[messages.length - 1].content;
      return last.includes('NHIỆM VỤ BƯỚC NÀY') ? badResp : goodResp;
    };
    const r = await executeGoalPlan(plan, domain, call);
    expect(r.ok).toBe(true);
    expect(r.fixRounds).toBe(1);
    // parseFixOutput giữ tên cũ để khoá hội tụ không gãy
    expect(r.items[0].script.scriptName).toBe('Ẩn thinking');
    expect(r.items[0].script.findRegex).toContain('details');
  });
});

describe('(103.2) Bảo chứng 2 chiều: bộ CHUẨN từ schema phải qua CHÍNH validator của agent', () => {
  it('full_set từ schema → compile sạch + replaceString hợp lệ (bỏ kiểm no-match vì script chuẩn khớp marker riêng)', () => {
    const schema = normalizeMVUZODSchema({
      version: '1.0',
      fields: [
        { path: '/Người Chơi', type: 'object', label: 'Người Chơi', constraints: {}, defaultValue: {},
          children: [
            { path: '/Người Chơi/HP', type: 'number', label: 'HP', constraints: {}, defaultValue: 100 },
            { path: '/Người Chơi/Tên', type: 'string', label: 'Tên', constraints: {}, defaultValue: '' },
          ] },
      ],
    });
    const built = buildProgrammaticRegex({ schema, component: 'full_set', gameName: 'T' });
    expect(built.scripts.length).toBeGreaterThan(0);
    // Sample = chính marker mà bộ chuẩn nhắm tới, để kiểm no-match có ý nghĩa
    const sample = built.scripts.map(s => {
      // lấy một chuỗi khớp thô từ findRegex dạng literal-marker nếu có
      const m = s.findRegex.match(/[\w<>[\]{}_-]{4,}/);
      return m ? m[0].replace(/\\/g, '') : '';
    }).join('\n');
    const domain = createRegexDomain({ schema, existingScripts: [], sampleText: sample });
    const drafts: RegexDraft[] = built.scripts.map((s, i) => ({ stepId: `b${i}`, explanation: '', script: s }));
    const issues = domain.validate(drafts);
    // Luật cốt lõi: KHÔNG được có lỗi compile / replace-error / run-error / trùng tên.
    const hard = issues.filter(i => ['rx-compile', 'rx-run', 'rx-dup-name'].includes(i.code)
      || (i.code === 'rx-replace' && i.level === 'error'));
    expect(hard).toEqual([]);
  });
});
