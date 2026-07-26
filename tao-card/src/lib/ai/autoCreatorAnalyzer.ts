/**
 * autoCreatorAnalyzer.ts — Phase 0: AI phân tích ý tưởng → Card Blueprint
 * v3: Blueprint trung gian giúp tất cả các bước sau nhất quán
 */

import type { CardBlueprint } from '../../types/autoCreator.types';
import type { ProxyProfile, GenerationParams } from '../../types';
import { callAI } from './client';

const BLUEPRINT_SYSTEM_PROMPT = `Bạn là chuyên gia phân tích ý tưởng character card cho SillyTavern.
Nhiệm vụ: phân tích ý tưởng của người dùng và tạo ra một "Card Blueprint" — bản thiết kế chi tiết làm nền tảng cho toàn bộ quá trình tạo card.

Trả về JSON object (KHÔNG code block, KHÔNG markdown) với cấu trúc chính xác sau:
{
  "characterProfile": {
    "name": "Tên nhân vật (ngắn gọn, phù hợp)",
    "origin": "Xuất thân, lý lịch",
    "appearance": "Ngoại hình chi tiết",
    "personality": "Tính cách chi tiết",
    "abilities": ["Kỹ năng 1", "Kỹ năng 2"],
    "relationships": ["Mối quan hệ 1"]
  },
  "worldStructure": {
    "genre": "Thể loại (romance, adventure, xianxia, sci-fi...)",
    "setting": "Bối cảnh thế giới",
    "systems": ["Hệ thống 1 (ma thuật, chiến đấu, RPG...)"],
    "factions": ["Thế lực 1", "Thế lực 2"]
  },
  "suggestedEntryTopics": [
    {
      "category": "worldview|character|npc|location|system|event",
      "title": "Tên entry",
      "description": "Mô tả ngắn nội dung",
      "priority": 1-10,
      "suggestedPosition": 0 hoặc 1,
      "suggestedConstant": true/false
    }
  ],
  "suggestedVariables": [
    {
      "path": "/Group/VarName",
      "type": "number|string|boolean",
      "defaultValue": "giá trị mặc định",
      "description": "Mô tả biến",
      "group": "Tên nhóm"
    }
  ],
  "toneAndStyle": {
    "narrativeVoice": "Ngôi kể (ngôi 3, ngôi 2...)",
    "language": "Ngôn ngữ chính",
    "mood": "Tone/mood (u ám, tươi sáng, hài hước...)"
  },
  "estimatedComplexity": "simple|medium|complex"
}

QUY TẮC:
- suggestedEntryTopics: đề xuất 15-40 chủ đề tùy complexity
- suggestedVariables: đề xuất 5-20 biến cần track
- Phân loại entry đúng category và đặt suggestedPosition/suggestedConstant theo best practices SillyTavern
- worldview entries: position=0, constant=true, order thấp
- character entries: position=1, constant tùy thẻ đơn/nhiều
- npc/location/event: position=1, constant=false (selective)
- ĐỐI VỚI HỆ THỐNG/GAME MASTER/NARRATOR: Nếu ý tưởng là môi trường Game/RPG/Hệ thống, KHÔNG tạo characterProfile như một thực thể cá nhân (không ghi tên định danh, ngoại hình cá nhân). Phần characterProfile và thế giới quan (worldStructure) phải tập trung mô tả bối cảnh, cơ chế hoạt động, luật chơi và văn phong (narrative style).`;

export async function analyzeIdea(
  idea: string,
  profile: ProxyProfile,
  params: GenerationParams,
  /** (#43) Signal từ nút Dừng — Phase 0 cũng phải chết ngay, không để call bay tiếp. */
  signal?: AbortSignal,
): Promise<CardBlueprint> {
  const response = await callAI({
    profile,
    params,
    messages: [
      { role: 'system', content: BLUEPRINT_SYSTEM_PROMPT },
      { role: 'user', content: `Phân tích ý tưởng sau và tạo Card Blueprint:\n\n${idea}` },
    ],
    signal,
  });

  const trimmed = response.text.trim();
  let parsed: CardBlueprint | null = null;

  // Try parse strategies
  try { parsed = JSON.parse(trimmed) as CardBlueprint; } catch { /* ignore */ }
  if (!parsed) {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/);
    if (fence) { try { parsed = JSON.parse(fence[1].trim()) as CardBlueprint; } catch { /* ignore */ } }
  }
  if (!parsed) {
    const objMatch = trimmed.match(/\{[\s\S]+\}/);
    if (objMatch) { try { parsed = JSON.parse(objMatch[0]) as CardBlueprint; } catch { /* ignore */ } }
  }

  if (!parsed) {
    throw new Error('Phase 0: Không thể parse Blueprint từ AI response');
  }

  // Validate essential fields
  if (!parsed.characterProfile?.name) {
    parsed.characterProfile = {
      ...parsed.characterProfile,
      name: 'Nhân vật',
      origin: parsed.characterProfile?.origin || '',
      appearance: parsed.characterProfile?.appearance || '',
      personality: parsed.characterProfile?.personality || '',
      abilities: parsed.characterProfile?.abilities || [],
      relationships: parsed.characterProfile?.relationships || [],
    };
  }
  if (!parsed.suggestedEntryTopics) parsed.suggestedEntryTopics = [];
  if (!parsed.suggestedVariables) parsed.suggestedVariables = [];
  if (!parsed.estimatedComplexity) parsed.estimatedComplexity = 'medium';

  return parsed;
}
