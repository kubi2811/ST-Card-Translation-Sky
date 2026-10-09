/**
 * src/utils/urlMask.ts — che / gỡ che link và tên file trước khi gửi AI (tách từ apiClient, bug 263).
 */
import { replaceCjkFileNames } from './cjk';

// ─── URL Masking Utilities ───
// Protect URLs/image links from being translated by the AI.
// Similar to secret masking, but for URLs in src, href, CSS url(), standalone URLs, and markdown images.
interface UrlMaskMap {
  [placeholder: string]: string;
}

export function maskUrls(text: string): { maskedText: string; map: UrlMaskMap } {
  const map: UrlMaskMap = {};
  let maskedText = text;
  let counter = 0;

  // Helper to create unique placeholder
  const makePlaceholder = () => `__PROTECTED_URL_${counter++}__`;

  // 1. Markdown image links: ![alt](url)
  maskedText = maskedText.replace(/(!\[[^\]]*\]\()([^)\s]+)(\))/g, (_match, prefix, url, suffix) => {
    const ph = makePlaceholder();
    map[ph] = url;
    return `${prefix}${ph}${suffix}`;
  });

  // 2. HTML attributes: src="...", href="...", url="...", action="...", data-src="...", poster="...", srcset="..."
  maskedText = maskedText.replace(
    /((?:src|href|action|data-src|data-url|poster|srcset)\s*=\s*)(["'])(https?:\/\/[^"'<>\s]+|[^"'<>\s]+\.(?:png|jpg|jpeg|gif|svg|webp|mp4|webm|mp3|ogg|wav|pdf|zip|css|js|html?)(?:[?#][^"'<>\s]*)?)\2/gi,
    (_match, attr, quote, url) => {
      const ph = makePlaceholder();
      map[ph] = url;
      return `${attr}${quote}${ph}${quote}`;
    }
  );

  // 3. CSS url() patterns
  maskedText = maskedText.replace(
    /(url\s*\(\s*)(["']?)(https?:\/\/[^"')\s]+|[^"')\s]+\.(?:png|jpg|jpeg|gif|svg|webp|woff2?|ttf|eot)(?:[?#][^"')\s]*)?)\2(\s*\))/gi,
    (_match, prefix, quote, url, suffix) => {
      const ph = makePlaceholder();
      map[ph] = url;
      return `${prefix}${quote}${ph}${quote}${suffix}`;
    }
  );

  // 4. Standalone URLs (https://... not already captured)
  // Only match URLs that aren't already placeholders
  maskedText = maskedText.replace(
    /(?<=[\s\n(]|^)(https?:\/\/[^\s<>"'`)\]]{10,})/gm,
    (match, url) => {
      if (url.includes('__PROTECTED_URL_')) return match; // Already masked
      const ph = makePlaceholder();
      map[ph] = url;
      return match.replace(url, ph);
    }
  );

  // 5. (bug 256) Tên file trần có chữ Hán (`状态机.js`, `scripts/02_大乾风华录后台GM修改器.js`) —
  //    tên một file KHÁC; AI dịch ra là trỏ vào file không tồn tại.
  maskedText = replaceCjkFileNames(maskedText, (m) => {
    const ph = makePlaceholder();
    map[ph] = m;
    return ph;
  });

  return { maskedText, map };
}

export function unmaskUrls(text: string, map: UrlMaskMap): string {
  let unmaskedText = text;
  for (const [placeholder, url] of Object.entries(map)) {
    // Use split+join for safety (avoids regex special char issues in URLs)
    unmaskedText = unmaskedText.split(placeholder).join(url);
  }
  return unmaskedText;
}

