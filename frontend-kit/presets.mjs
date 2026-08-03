/**
 * Lớp vỏ Node cho bộ dựng preset. Logic thật nằm ở
 * `tao-card/src/lib/frontendKit/presetBuilder.js` — nguồn duy nhất, dùng chung với app.
 */
import path from 'node:path';
import url from 'node:url';
import { APP_KIT_DIR, ELDRAN } from './lib.mjs';

const mod = await import(url.pathToFileURL(path.join(APP_KIT_DIR, 'presetBuilder.js')).href);

export function buildPresets() {
  return mod.buildPresets({
    title: 'Hành Tinh Eldran',
    subtitle: 'Năm 3000 SC · Kỷ nguyên Veil',
    updateTag: ELDRAN.updateTag,
  });
}
