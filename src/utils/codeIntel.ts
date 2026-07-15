/**
 * ─── P3 Roadmap Trợ Lý AI — Code Intelligence ───
 * 1) Syntax highlight khối code trong chat bằng shiki (chuẩn TextMate, đúng màu VS Code) —
 *    lazy-load 1 lần, fallback <pre> trơn khi chưa sẵn sàng. KHÔNG dùng Monaco cho chat
 *    (quá nặng để render tĩnh — Monaco dành cho diff view).
 * 2) Chẩn đoán cú pháp tức thời cho JS/TS-lite (acorn — tái dùng scriptSafety) + JSON —
 *    banner lỗi kèm dòng/cột + nút "AI sửa" đưa đúng dòng lỗi vào prompt.
 */
import { jsParseErrorAny } from './scriptSafety';

export interface CodeDiagnostic {
  line?: number;
  message: string;
}

/** Ngôn ngữ shiki hỗ trợ trong bundle web mà app dùng. */
const HIGHLIGHT_LANGS = new Set([
  'javascript', 'js', 'typescript', 'ts', 'json', 'html', 'css', 'yaml', 'yml',
  'xml', 'markdown', 'md', 'jsx', 'tsx',
]);

const LANG_ALIAS: Record<string, string> = {
  js: 'javascript', ts: 'typescript', yml: 'yaml', md: 'markdown',
};

let highlighterPromise: Promise<any> | null = null;

/** Singleton highlighter — tải WASM + grammar 1 lần (lazy). */
async function getHighlighter(): Promise<any> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(shiki =>
      shiki.createHighlighter({
        themes: ['dark-plus'],
        langs: ['javascript', 'typescript', 'json', 'html', 'css', 'yaml', 'xml', 'markdown', 'jsx', 'tsx'],
      }),
    );
  }
  return highlighterPromise;
}

/**
 * Highlight `code` thành HTML (shiki tự escape nội dung — an toàn để dангerouslySetInnerHTML).
 * Ngôn ngữ không hỗ trợ / lỗi WASM → trả null (caller giữ <pre> trơn).
 */
export async function highlightCode(code: string, language: string): Promise<string | null> {
  const lang = LANG_ALIAS[language] || language;
  if (!HIGHLIGHT_LANGS.has(language) && !HIGHLIGHT_LANGS.has(lang)) return null;
  // Khối quá lớn: bỏ highlight để không nghẽn main thread (KPI: <50ms/khối)
  if (code.length > 60_000) return null;
  try {
    const hl = await getHighlighter();
    return hl.codeToHtml(code, { lang, theme: 'dark-plus' });
  } catch (e) {
    console.warn('[codeIntel] highlight lỗi (dùng pre trơn):', e);
    return null;
  }
}

/** Chẩn đoán cú pháp nhanh (sync, rẻ): JS/TS qua acorn, JSON qua JSON.parse. Sạch → null. */
export function diagnoseCode(code: string, language: string): CodeDiagnostic | null {
  const lang = LANG_ALIAS[language] || language;
  if (!code.trim()) return null;

  if (lang === 'javascript' || lang === 'typescript' || lang === 'jsx' || lang === 'tsx') {
    const err = jsParseErrorAny(code);
    if (err) return { line: err.line, message: err.msg };
    return null;
  }

  if (lang === 'json') {
    try { JSON.parse(code); return null; }
    catch (e: any) {
      const msg = String(e.message || 'JSON không hợp lệ');
      // Định vị dòng — V8 đổi format lỗi qua các đời:
      // 1) "... (line 3 column 8)"  2) "... at position 19"
      // 3) V8 mới: không có cả hai, chỉ có SNIPPET quanh lỗi: Unexpected token ',', ..."<snippet>" is not valid JSON
      let line: number | undefined;
      const lineM = msg.match(/line (\d+)/);
      const posM = msg.match(/position (\d+)/);
      if (lineM) line = Number(lineM[1]);
      else if (posM) line = code.slice(0, Number(posM[1])).split('\n').length;
      else {
        const snipM = msg.match(/\.\.\."([\s\S]*?)" is not valid JSON/);
        if (snipM) {
          const idx = code.indexOf(snipM[1]);
          // snippet bao QUANH điểm lỗi → lấy giữa snippet làm xấp xỉ
          if (idx >= 0) line = code.slice(0, idx + Math.floor(snipM[1].length / 2)).split('\n').length;
        }
      }
      return { line, message: msg };
    }
  }

  return null; // ngôn ngữ khác: chưa chẩn đoán (tree-sitter là việc P5)
}

/** Dựng prompt "AI sửa" từ chẩn đoán — đưa ĐÚNG dòng lỗi + ngữ cảnh quanh nó. */
export function buildFixPrompt(code: string, language: string, diag: CodeDiagnostic): string {
  let context = '';
  if (diag.line) {
    const lines = code.split('\n');
    const from = Math.max(0, diag.line - 4);
    const to = Math.min(lines.length, diag.line + 3);
    context = lines.slice(from, to)
      .map((l, i) => `${from + i + 1}${from + i + 1 === diag.line ? ' ►' : '  '} ${l}`)
      .join('\n');
  }
  return `Đoạn code ${language} dưới đây bị LỖI CÚ PHÁP${diag.line ? ` ở dòng ${diag.line}` : ''}: ${diag.message}
${context ? `\nNgữ cảnh quanh dòng lỗi (► = dòng lỗi):\n${context}\n` : ''}
Hãy sửa TRIỆT ĐỂ lỗi này, GIỮ NGUYÊN cấu trúc + logic gốc, rồi trả về TOÀN BỘ code đã sửa trong 1 code block duy nhất:

\`\`\`${language}
${code}
\`\`\``;
}
