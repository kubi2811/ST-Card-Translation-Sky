export interface MvuDoc {
  id: string;
  title: string;
  keywords: string[];
  content: string;
}

export const MVU_KNOWLEDGE_BASE: MvuDoc[] = [
  {
    id: 'variable_rules_guide',
    title: 'Hướng dẫn viết quy tắc cập nhật biến số (Variable Rules)',
    keywords: ['rules', 'quy tắc', 'luật', 'cập nhật', 'variable_rules', 'xml', 'cách viết', 'hướng dẫn'],
    content: `[HƯỚNG DẪN VIẾT VARIABLE RULES TRONG MVU-ZOD]
Quy tắc cập nhật biến số được đặt trong khối thẻ XML \`<Variable_rules>\`.
Hệ thống AI sẽ đọc khối rules này ở mỗi lượt chat của người dùng để xác định có cần cập nhật trị số biến nào không.

Định dạng và Quy tắc viết:
1. Sử dụng định dạng XML rõ ràng, dễ hiểu. Bạn có thể sử dụng các thẻ như \`<rule>\`, \`<condition>\`, \`<action>\` để mô tả logic.
2. Cú pháp cơ bản của một luật cập nhật:
   - Chỉ rõ biến nào được cập nhật.
   - Điều kiện cập nhật (ví dụ: khi nhân vật bị tấn công, khi người dùng tặng quà, khi hoàn thành nhiệm vụ).
   - Logic tính toán (cộng thêm, trừ đi, giới hạn min/max).
3. Luôn yêu cầu đầu ra của AI cập nhật biến dưới dạng JSON Patch nằm trong thẻ \`<UpdateVariable>\` ở cuối tin nhắn:
   Ví dụ:
   \`\`\`json
   [
     {"op": "replace", "path": "/hp", "value": 80}
   ]
   \`\`\`
4. Các thuộc tính biến phải trùng khớp hoàn toàn với Zod Schema đã định nghĩa.
5. Đưa ra các ví dụ cụ thể về hội thoại và cách biến số thay đổi để AI dễ dàng bắt chước.`
  },
  {
    id: 'character_stats_status',
    title: 'Mẫu Hệ thống Chỉ số Nhân vật (Stats & Status)',
    keywords: ['stats', 'status', 'chỉ số', 'máu', 'hp', 'mp', 'exp', 'level', 'sức mạnh', 'mana', 'trạng thái'],
    content: `[MẪU HỆ THỐNG CHỈ SỐ NHÂN VẬT (STATS & STATUS)]
Dành cho các thẻ nhân vật dạng game RPG, chiến đấu, thăng cấp chỉ số.

1. ZOD SCHEMA MẪU:
\`\`\`typescript
const mvuSchema = z.object({
  hp: z.number().min(0).max(100).default(100).describe("Máu hiện tại của nhân vật"),
  mp: z.number().min(0).max(100).default(100).describe("Mana hiện tại của nhân vật"),
  level: z.number().int().min(1).default(1).describe("Cấp độ của nhân vật"),
  exp: z.number().min(0).default(0).describe("Kinh nghiệm hiện tại, đủ 100 sẽ tăng cấp"),
  status: z.enum(["Bình thường", "Bị thương", "Ngất xỉu", "Kiệt sức"]).default("Bình thường").describe("Trạng thái sức khỏe")
});
\`\`\`

2. VARIABLE RULES XML MẪU:
\`\`\`xml
<Variable_rules>
- Cập nhật HP:
  + Khi nhân vật bị tấn công hoặc chịu sát thương vật lý/phép thuật, giảm HP tùy theo mức độ nghiêm trọng (Nhẹ: -10 HP, Trung bình: -30 HP, Nặng: -60 HP).
  + Khi HP về 0, trạng thái (status) phải chuyển sang "Ngất xỉu". Nhân vật không thể hành động cho đến khi được trị thương.
  + Khi được hồi máu hoặc nghỉ ngơi, tăng HP (tối đa 100).
- Cập nhật MP:
  + Khi nhân vật sử dụng phép thuật hoặc kỹ năng đặc biệt, trừ MP tương ứng (ví dụ: Niệm phép trừ 15-30 MP).
  + MP tự hồi phục chậm khi nghỉ ngơi hoặc dùng bình thuốc.
- Cập nhật EXP và Level:
  + Khi nhân vật hoàn thành một hành động khó, đánh bại quái vật, hoặc làm hài lòng người dùng, tăng EXP (+15 đến +40 EXP).
  + Khi EXP đạt từ 100 trở lên: Tăng level lên 1, reset EXP về (EXP dư), và tăng giới hạn HP/MP tối đa hoặc hồi đầy HP/MP.
</Variable_rules>`
  },
  {
    id: 'inventory_items',
    title: 'Mẫu Hệ thống Túi đồ & Vật phẩm (Inventory & Items)',
    keywords: ['inventory', 'items', 'túi đồ', 'vật phẩm', 'đồ', 'tiền', 'vàng', 'gold', 'vũ khí', 'nhặt đồ', 'mua bán'],
    content: `[MẪU HỆ THỐNG TÚI ĐỒ & VẬT PHẨM (INVENTORY & ITEMS)]
Dành cho nhân vật có khả năng nhặt đồ, mua bán, sử dụng vật phẩm, quản lý tiền bạc.

1. ZOD SCHEMA MẪU:
\`\`\`typescript
const mvuSchema = z.object({
  gold: z.number().int().min(0).default(100).describe("Số tiền vàng nhân vật sở hữu"),
  inventory: z.array(z.object({
    name: z.string().describe("Tên vật phẩm"),
    quantity: z.number().int().min(1).describe("Số lượng"),
    type: z.enum(["Vũ khí", "Hồi phục", "Nhiệm vụ", "Khác"]).describe("Loại vật phẩm")
  })).default([]).describe("Danh sách vật phẩm trong túi đồ"),
  equippedWeapon: z.string().default("Tay không").describe("Vũ khí đang trang bị")
});
\`\`\`

2. VARIABLE RULES XML MẪU:
\`\`\`xml
<Variable_rules>
- Quản lý Tiền vàng (Gold):
  + Khi nhân vật làm nhiệm vụ, tiêu diệt quái vật hoặc bán đồ, tăng gold tương ứng.
  + Khi nhân vật mua vật phẩm từ cửa hàng hoặc người dùng, trừ gold. Không được để gold âm.
- Quản lý Túi đồ (Inventory):
  + Khi nhặt được vật phẩm mới: Nếu vật phẩm đã có sẵn trong túi, cộng dồn số lượng (quantity). Nếu là vật phẩm mới, thêm một object mới vào mảng inventory.
  + Khi sử dụng vật phẩm hồi phục (ví dụ: Bình máu): Giảm số lượng đi 1. Nếu số lượng về 0, xóa hoàn toàn vật phẩm khỏi danh sách mảng inventory. Đồng thời chạy rule hồi phục HP tương ứng.
- Trang bị Vũ khí (Equipped Weapon):
  + Khi người dùng tặng hoặc nhân vật nhặt được vũ khí mạnh hơn và muốn dùng, cập nhật equippedWeapon thành tên vũ khí đó.
</Variable_rules>`
  },
  {
    id: 'relationship_affection',
    title: 'Mẫu Mối quan hệ & Thiện cảm (Relationship & Affection)',
    keywords: ['relationship', 'affection', 'thiện cảm', 'tình cảm', 'yêu', 'ghét', 'thân mật', 'tin tưởng', 'trust', 'favorability'],
    content: `[MẪU MỐI QUAN HỆ & THIỆN CẢM (RELATIONSHIP & AFFECTION)]
Dành cho nhân vật tập trung vào tương tác cảm xúc, hẹn hò, tăng điểm thân mật với người dùng.

1. ZOD SCHEMA MẪU:
\`\`\`typescript
const mvuSchema = z.object({
  affection: z.number().min(0).max(100).default(20).describe("Điểm thiện cảm/yêu thích của nhân vật đối với {{user}}"),
  trust: z.number().min(0).max(100).default(10).describe("Điểm tin tưởng đối với {{user}}"),
  relationStage: z.enum(["Xa lạ", "Kẻ quen biết", "Bạn bè", "Thân thiết", "Người yêu", "Vợ chồng"]).default("Xa lạ").describe("Giai đoạn mối quan hệ"),
  loveStyle: z.string().default("Ngượng ngùng").describe("Thái độ/Phong cách thể hiện tình cảm của nhân vật")
});
\`\`\`

2. VARIABLE RULES XML MẪU:
\`\`\`xml
<Variable_rules>
- Cập nhật Thiện cảm (Affection):
  + Tăng thiện cảm (+2 đến +10) khi {{user}} nói lời ngọt ngào, khen ngợi, tặng quà, hoặc có cử chỉ quan tâm, bảo vệ nhân vật.
  + Giảm thiện cảm (-5 đến -20) khi {{user}} thô lỗ, xúc phạm, bỏ rơi hoặc làm tổn thương nhân vật.
- Cập nhật Sự tin tưởng (Trust):
  + Tăng tin tưởng (+5 đến +15) khi {{user}} giữ lời hứa, chia sẻ bí mật, hoặc giúp đỡ nhân vật giải quyết khó khăn cá nhân.
  + Giảm tin tưởng khi bị {{user}} phản bội hoặc lừa dối.
- Cập nhật Giai đoạn mối quan hệ (Relation Stage):
  + "Xa lạ" -> "Kẻ quen biết": Khi thiện cảm đạt > 20.
  + "Kẻ quen biết" -> "Bạn bè": Khi thiện cảm đạt > 40 và tin tưởng > 30.
  + "Bạn bè" -> "Thân thiết": Khi thiện cảm đạt > 60 và tin tưởng > 50.
  + "Thân thiết" -> "Người yêu": Khi thiện cảm đạt > 80, tin tưởng > 70 và có lời tỏ tình được chấp nhận.
  + Thái độ của nhân vật thay đổi rõ rệt (dựa vào loveStyle) khi thăng tiến mối quan hệ (ví dụ: từ lạnh nhạt sang ngượng ngùng, rồi chủ động quan tâm).
</Variable_rules>`
  }
];
