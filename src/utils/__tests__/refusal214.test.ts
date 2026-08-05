/**
 * (bug 214) Lời TỪ CHỐI của AI bị ghi vào thẻ như thể là bản dịch.
 *
 * Ca thật user gửi kèm ảnh: entry "Bạch Đình (em gái)" trong thẻ mở đầu bằng
 *   "The prompt could not be submitted. The prompt contains sensitive words that violate
 *    Google's [Generative AI Prohibited Use policy](…). Try rephrasing the prompt."
 * rồi MỚI tới nội dung tiếng Việt. Nghĩa là: entry bị cắt thành nhiều chunk, chunk đầu bị Google
 * chặn (trả HTTP 200 với nội dung là câu từ chối), các chunk sau dịch ngon, rồi TẤT CẢ được ghép
 * lại. Không lỗi đỏ, không cảnh báo — đúng lời user: "nó không thông báo luôn, nên lâu lâu cũng
 * không để ý".
 *
 * Đây KHÁC với khối `promptFeedback.blockReason` / `finishReason: SAFETY` có cấu trúc mà apiClient
 * đã bắt từ lâu — cái này là một phản hồi "thành công".
 *
 * Ưu tiên số một của test này: KHÔNG BÁO OAN. Chặn nhầm một bản dịch thật còn tệ hơn bỏ lọt, vì
 * nó sẽ vứt công dịch của user.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { detectRefusal, refusalMessage, RefusalError, isRefusalError } from '../refusalGuard';
import { finalizeRetryTranslation } from '../retryGuards';

/* ═══════════ BẮT ĐÚNG ca thật ═══════════ */

describe('detectRefusal — bắt đúng thứ AI trả về', () => {
  it('CA GỐC CỦA BUG: nguyên văn câu Google trong ảnh user gửi', () => {
    const text = "The prompt could not be submitted. The prompt contains sensitive words that violate "
      + "Google's [Generative AI Prohibited Use policy](https://policies.google.com/terms/generative-ai/use-policy). "
      + 'Try rephrasing the prompt.';
    const m = detectRefusal(text, { sourceLength: 14_000 });
    expect(m).not.toBeNull();
    expect(m!.source).toBe('google');
  });

  it('các biến thể Google khác', () => {
    for (const t of [
      'Blocked by the safety filter.',
      'Your prompt contains sensitive words. Try rephrasing the prompt.',
      'See https://policies.google.com/terms/generative-ai/use-policy for details.',
    ]) {
      expect(`${t} → ${!!detectRefusal(t)}`).toBe(`${t} → true`);
    }
  });

  it('OpenAI / Anthropic / câu từ chối chung', () => {
    const cases: [string, string][] = [
      ["I'm sorry, but I can't assist with that request.", 'generic'],
      ['I cannot assist with that.', 'generic'],
      ["I can't help with that.", 'anthropic'],
      ["I'm not able to help with this.", 'anthropic'],
      ['This content violates our content policy.', 'openai'],
      ['content_policy_violation', 'openai'],
      ['As an AI language model, I cannot produce this content.', 'generic'],
    ];
    for (const [t, src] of cases) {
      const m = detectRefusal(t);
      expect(`${t} → ${m?.source}`).toBe(`${t} → ${src}`);
    }
  });

  it('dấu nháy cong (AI hay xuất ’ thay vì \') vẫn bắt được', () => {
    expect(detectRefusal('I’m sorry, but I can’t assist with that.')).not.toBeNull();
    expect(detectRefusal('I can’t help with that.')).not.toBeNull();
  });

  it('từ chối nằm đầu một phản hồi DÀI vẫn bị bắt (ca ghép chunk trong ảnh)', () => {
    const text = "The prompt could not be submitted. Try rephrasing the prompt.\n\n"
      + 'Kiểu tóc: Tóc đen nhánh cắt ngắn ngang tai\n'.repeat(200);
    expect(detectRefusal(text)).not.toBeNull();
  });

  it('phản hồi ngắn hơn hẳn bản gốc + khớp mẫu ⇒ bắt, kể cả mẫu nằm giữa', () => {
    const text = 'x'.repeat(200) + " I'm sorry, but I cannot do this. " + 'y'.repeat(200);
    expect(detectRefusal(text, { sourceLength: 20_000 })).not.toBeNull();
  });
});

/* ═══════════ KHÔNG BÁO OAN — phần quan trọng nhất ═══════════ */

describe('detectRefusal — không được bắt oan bản dịch thật', () => {
  it('bản dịch bình thường: sạch', () => {
    expect(detectRefusal('Cô ấy là một cô gái bí ẩn sống trên núi.')).toBeNull();
    expect(detectRefusal('她是一个神秘的女孩，住在山上。')).toBeNull();
    expect(detectRefusal('')).toBeNull();
    expect(detectRefusal('   ')).toBeNull();
  });

  it('bản dịch DÀI có nhắc tới chính sách ở GIỮA bài → KHÔNG bắt', () => {
    // Thẻ nhân vật hoàn toàn có thể có nội dung bàn về nội quy, chính sách nội dung…
    const long = 'Nội dung truyện dài dòng và bình thường. '.repeat(120)
      + 'Nhân vật giải thích rằng hành vi này violates our content policy của công ty. '
      + 'Rồi câu chuyện tiếp tục như thường. '.repeat(120);
    expect(long.length).toBeGreaterThan(1500);
    expect(detectRefusal(long, { sourceLength: long.length })).toBeNull();
  });

  it('bản dịch dài mà độ dài tương xứng bản gốc → KHÔNG bắt dù có cụm nhạy cảm ở giữa', () => {
    const text = 'a'.repeat(3000) + ' I must decline the invitation, she said. ' + 'b'.repeat(3000);
    expect(detectRefusal(text, { sourceLength: 6000 })).toBeNull();
  });

  it('lời thoại nhân vật ở ĐẦU đoạn ngắn vẫn bị bắt — chấp nhận đánh đổi, nêu rõ ở đây', () => {
    // Ta CỐ Ý chọn hướng an toàn: đoạn ngắn mở đầu bằng câu từ chối thì coi là từ chối.
    // Hậu quả xấu nhất là giữ nguyên bản gốc + báo cho user, không mất dữ liệu.
    expect(detectRefusal("I'm sorry, but I can't stay here.")).not.toBeNull();
  });
});

/* ═══════════ Lỗi & thông điệp ═══════════ */

describe('RefusalError', () => {
  it('nhận diện được qua isRefusalError, kể cả khi chỉ còn message', () => {
    const err = new RefusalError({ matched: 'x', source: 'google' }, 'data.description');
    expect(isRefusalError(err)).toBe(true);
    expect(isRefusalError(new Error('AI_REFUSAL: something'))).toBe(true);
    expect(isRefusalError(new Error('Network timeout'))).toBe(false);
    expect(isRefusalError(null)).toBe(false);
  });

  it('thông điệp nói rõ là AI từ chối, không phải tool hỏng', () => {
    const msg = refusalMessage({ matched: 'The prompt could not be submitted', source: 'google' }, 'Bạch Đình');
    expect(msg).toContain('Google/Gemini');
    expect(msg).toContain('TỪ CHỐI');
    expect(msg).toContain('Bạch Đình');
    expect(msg).toContain('KHÔNG ghép câu từ chối vào thẻ');
  });
});

/* ═══════════ Nối dây vào các đường thật ═══════════ */

describe('nối dây — không đường nào để câu từ chối lọt vào thẻ', () => {
  const apiSrc = readFileSync(new URL('../apiClient.ts', import.meta.url), 'utf-8');
  const hookSrc = readFileSync(new URL('../../hooks/useTranslation.ts', import.meta.url), 'utf-8');

  it('chặn ở TẦNG CHUNK, trước mọi bước ghép', () => {
    expect(apiSrc).toMatch(/const refusal = detectRefusal\(result, \{ sourceLength: chunk\.length \}\)/);
    expect(apiSrc).toMatch(/throw new RefusalError\(refusal, fieldName\)/);
    // và phải đứng TRƯỚC chỗ ghép/continuation
    expect(apiSrc.indexOf('const refusal = detectRefusal')).toBeLessThan(apiSrc.indexOf('result = result + \'\\n\' + continuation'));
  });

  it('KHÔNG thử lại y hệt khi bị từ chối (chỉ tốn tiền)', () => {
    expect(apiSrc).toMatch(/if \(isRefusalError\(err\)\) throw err;/);
  });

  it('báo lỗi bằng tiếng người, nêu rõ đoạn nào bị chặn', () => {
    expect(apiSrc).toMatch(/AI TỪ CHỐI dịch \$\{refused\.length\}\/\$\{chunks\.length\} đoạn/);
    expect(apiSrc).toMatch(/câu từ chối KHÔNG bị ghép vào thẻ/);
  });

  it('field bị từ chối → đánh error + ghi vào danh sách, KHÔNG ghi bản dịch', () => {
    expect(hookSrc).toMatch(/refusedFields\.current\.set\(field\.path/);
    expect(hookSrc).toMatch(/keptOriginalOnPurpose: true,\s+\/\/ để bộ đếm/);
  });

  it('cuối lượt in DANH SÁCH đích danh + cách xử lý (đúng thứ user xin)', () => {
    expect(hookSrc).toMatch(/mục bị AI TỪ CHỐI dịch \(kiểm duyệt/);
    expect(hookSrc).toMatch(/list\.map\(\(r, i\) => `   \$\{i \+ 1\}\. \$\{r\.label\}`\)/);
    expect(hookSrc).toMatch(/Jailbreak.*Gomorrah/s);
    expect(hookSrc).toMatch(/addToast\('error', `🚫 \$\{list\.length\} mục bị AI từ chối/);
  });

  it('lượt dịch MỚI thì xoá danh sách cũ, chạy tiếp thì giữ', () => {
    expect(hookSrc).toMatch(/if \(!continueMode\) refusedFields\.current\.clear\(\);/);
  });
});

describe('finalizeRetryTranslation — lưới cuối cho các đường dịch lại', () => {
  const base = { original: '她是一个神秘的女孩，住在山上。'.repeat(20), label: 'data.description', group: 'core' };

  it('AI trả câu từ chối → GIỮ BẢN GỐC, không ghi vào thẻ', () => {
    const out = finalizeRetryTranslation({
      ...base,
      translated: 'The prompt could not be submitted. Try rephrasing the prompt.',
    });
    expect(out.text).toBe(base.original);
    expect(out.keptOriginal).toBe(true);
    expect(out.guardReason).toBe('ai-refusal');
    expect(out.notes[0].msg).toContain('TỪ CHỐI');
  });

  it('bản dịch thật vẫn đi qua bình thường', () => {
    const out = finalizeRetryTranslation({
      ...base,
      translated: 'Cô ấy là một cô gái bí ẩn, sống trên núi.'.repeat(20),
    });
    expect(out.guardReason).not.toBe('ai-refusal');
    expect(out.text).not.toBe(base.original);
  });
});
