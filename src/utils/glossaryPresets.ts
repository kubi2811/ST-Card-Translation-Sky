import type { GlossaryEntry } from '../types/card';

/**
 * ─── Bộ thuật ngữ CÓ SẴN cho Từ điển ───
 *
 * Đa số card user dịch là card Trung thể loại tu tiên/võ hiệp — cùng một bộ thuật ngữ
 * lặp đi lặp lại (境界, 金丹, 灵气…). Thay vì mỗi người tự gõ tay, kèm sẵn bộ chuẩn
 * theo cách cộng đồng convert quen dùng: bấm 1 nút là nạp vào Từ điển (mục user đã có
 * LUÔN thắng — xem mergeGlossary).
 *
 * Nguyên tắc chọn mục:
 * - Chỉ giữ thuật ngữ CHUẨN CỘNG ĐỒNG, một nghĩa rõ ràng (bỏ mục mơ hồ như 炼器/炼气 trùng âm).
 * - Cảnh giới tu luyện viết Hoa (Kim Đan, Nguyên Anh) — danh xưng/danh từ chung viết thường.
 * - Glossary chỉ được nhét vào prompt khi mục THẬT SỰ xuất hiện trong đoạn đang dịch
 *   (filterGlossaryForText) nên nạp cả bộ to cũng không phình token.
 */

export interface GlossaryPreset {
  id: string;
  /** Key i18n cho tên bộ (nhãn nút) */
  nameKey: 'gpXianxia';
  entries: GlossaryEntry[];
}

const XIANXIA_WUXIA: GlossaryEntry[] = [
  // ── Tu luyện & khí ──
  { source: '修炼', target: 'tu luyện' },
  { source: '修仙', target: 'tu tiên' },
  { source: '修为', target: 'tu vi' },
  { source: '灵气', target: 'linh khí' },
  { source: '灵力', target: 'linh lực' },
  { source: '灵石', target: 'linh thạch' },
  { source: '灵根', target: 'linh căn' },
  { source: '灵脉', target: 'linh mạch' },
  { source: '丹田', target: 'đan điền' },
  { source: '元神', target: 'nguyên thần' },
  { source: '元气', target: 'nguyên khí' },
  { source: '真元', target: 'chân nguyên' },
  { source: '真气', target: 'chân khí' },
  { source: '神识', target: 'thần thức' },
  { source: '神通', target: 'thần thông' },
  { source: '寿元', target: 'thọ nguyên' },
  { source: '血脉', target: 'huyết mạch' },
  { source: '经脉', target: 'kinh mạch' },
  // ── Cảnh giới ──
  { source: '境界', target: 'cảnh giới' },
  { source: '练气', target: 'Luyện Khí' },
  { source: '筑基', target: 'Trúc Cơ' },
  { source: '金丹', target: 'Kim Đan' },
  { source: '元婴', target: 'Nguyên Anh' },
  { source: '化神', target: 'Hóa Thần' },
  { source: '炼虚', target: 'Luyện Hư' },
  { source: '合体', target: 'Hợp Thể' },
  { source: '大乘', target: 'Đại Thừa' },
  { source: '渡劫', target: 'Độ Kiếp' },
  { source: '飞升', target: 'phi thăng' },
  { source: '突破', target: 'đột phá' },
  { source: '瓶颈', target: 'bình cảnh' },
  { source: '走火入魔', target: 'tẩu hỏa nhập ma' },
  { source: '闭关', target: 'bế quan' },
  { source: '出关', target: 'xuất quan' },
  { source: '天劫', target: 'thiên kiếp' },
  { source: '雷劫', target: 'lôi kiếp' },
  // ── Công pháp & vật phẩm ──
  { source: '功法', target: 'công pháp' },
  { source: '心法', target: 'tâm pháp' },
  { source: '秘籍', target: 'bí kíp' },
  { source: '法宝', target: 'pháp bảo' },
  { source: '法力', target: 'pháp lực' },
  { source: '丹药', target: 'đan dược' },
  { source: '炼丹', target: 'luyện đan' },
  { source: '符箓', target: 'phù lục' },
  { source: '阵法', target: 'trận pháp' },
  { source: '傀儡', target: 'khôi lỗi' },
  { source: '洞府', target: 'động phủ' },
  { source: '秘境', target: 'bí cảnh' },
  // ── Người & danh xưng ──
  { source: '修士', target: 'tu sĩ' },
  { source: '散修', target: 'tán tu' },
  { source: '妖修', target: 'yêu tu' },
  { source: '魔修', target: 'ma tu' },
  { source: '凡人', target: 'phàm nhân' },
  { source: '仙人', target: 'tiên nhân' },
  { source: '真人', target: 'chân nhân' },
  { source: '道友', target: 'đạo hữu' },
  { source: '前辈', target: 'tiền bối' },
  { source: '晚辈', target: 'vãn bối' },
  { source: '师尊', target: 'sư tôn' },
  { source: '师父', target: 'sư phụ' },
  { source: '师兄', target: 'sư huynh' },
  { source: '师姐', target: 'sư tỷ' },
  { source: '师弟', target: 'sư đệ' },
  { source: '师妹', target: 'sư muội' },
  // ── Tông môn & giang hồ ──
  { source: '宗门', target: 'tông môn' },
  { source: '门派', target: 'môn phái' },
  { source: '掌门', target: 'chưởng môn' },
  { source: '长老', target: 'trưởng lão' },
  { source: '弟子', target: 'đệ tử' },
  { source: '帮主', target: 'bang chủ' },
  { source: '盟主', target: 'minh chủ' },
  { source: '江湖', target: 'giang hồ' },
  { source: '武林', target: 'võ lâm' },
  { source: '侠客', target: 'hiệp khách' },
  // ── Võ học ──
  { source: '内力', target: 'nội lực' },
  { source: '内功', target: 'nội công' },
  { source: '轻功', target: 'khinh công' },
  { source: '剑法', target: 'kiếm pháp' },
  { source: '刀法', target: 'đao pháp' },
  { source: '掌法', target: 'chưởng pháp' },
  { source: '拳法', target: 'quyền pháp' },
  { source: '身法', target: 'thân pháp' },
  { source: '招式', target: 'chiêu thức' },
  { source: '暗器', target: 'ám khí' },
  { source: '点穴', target: 'điểm huyệt' },
  // ── Khác hay gặp ──
  { source: '妖兽', target: 'yêu thú' },
  { source: '灵兽', target: 'linh thú' },
  { source: '天赋', target: 'thiên phú' },
  { source: '资质', target: 'tư chất' },
  { source: '悟性', target: 'ngộ tính' },
  { source: '机缘', target: 'cơ duyên' },
  { source: '造化', target: 'tạo hóa' },
];

export const GLOSSARY_PRESETS: GlossaryPreset[] = [
  { id: 'xianxia', nameKey: 'gpXianxia', entries: XIANXIA_WUXIA },
];
