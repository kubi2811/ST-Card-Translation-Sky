/**
 * autoCreatorPrompts.ts — System prompts cho từng bước pipeline
 * v3: Blueprint-aware, prompt override support
 */

import type {
  CardBlueprint,
  BasicInfoStepConfig,
  RegexStepConfig,
  MvuzodStepConfig,
  SystemPromptStepConfig,
  FirstMessageStepConfig,
  MesExampleStepConfig,
  PromptMode,
} from '../../types/autoCreator.types';

const JSON_FORMAT_REQUIREMENT = `
TRẢ VỀ KẾT QUẢ DƯỚI DẠNG JSON. CHỈ XUẤT JSON KHÔNG KÈM THEO BẤT KỲ VĂN BẢN NÀO KHÁC BÊN NGOÀI (KHÔNG CODE BLOCK, KHÔNG MARKDOWN).
`;

/** Apply user prompt override */
function applyOverride(basePrompt: string, override?: string, mode: PromptMode = 'default'): string {
  if (!override?.trim()) return basePrompt;
  switch (mode) {
    case 'replace': return override;
    case 'append': return `${basePrompt}\n\n--- YÊU CẦU BỔ SUNG TỪ NGƯỜI DÙNG ---\n${override}`;
    default: return basePrompt;
  }
}

/** Build blueprint context injection */
function blueprintContext(bp: CardBlueprint | null): string {
  if (!bp) return '';
  return `
--- CARD BLUEPRINT (Phase 0 Analysis) ---
Nhân vật: ${bp.characterProfile.name}
Xuất thân: ${bp.characterProfile.origin}
Ngoại hình: ${bp.characterProfile.appearance}
Tính cách: ${bp.characterProfile.personality}
Kỹ năng: ${bp.characterProfile.abilities.join(', ')}
Mối quan hệ: ${bp.characterProfile.relationships.join(', ')}

Thế giới: ${bp.worldStructure.genre} — ${bp.worldStructure.setting}
Hệ thống: ${bp.worldStructure.systems.join(', ')}
Thế lực: ${bp.worldStructure.factions.join(', ')}

Tone: ${bp.toneAndStyle.narrativeVoice}, ${bp.toneAndStyle.mood}
Ngôn ngữ: ${bp.toneAndStyle.language}
Độ phức tạp: ${bp.estimatedComplexity}
`;
}

export function buildBasicInfoPrompt(idea: string, config: BasicInfoStepConfig, bp: CardBlueprint | null): string {
  const base = `
Bạn là chuyên gia tạo character card cho SillyTavern. Hãy tạo thông tin cơ bản cho nhân vật dựa trên ý tưởng sau.
Ý TƯỞNG: "${idea}"
${blueprintContext(bp)}

CẤU HÌNH:
- Ngôn ngữ: ${config.language}
- Bao gồm Personality: ${config.includePersonality}
- Bao gồm Scenario: ${config.includeScenario}

QUY TẮC QUAN TRỌNG VỀ ĐỊNH DẠNG "DESCRIPTION":
- Nếu ý tưởng yêu cầu tạo một Hệ thống (System), Game Master, Người Kể Chuyện (Narrator) hoặc môi trường Game/RPG: TUYỆT ĐỐI KHÔNG mô tả nó như một con người hay chatbot cá nhân (không ghi tên định danh cá nhân, ngoại hình, thực thể). Thay vào đó, mục "description" CHỈ TẬP TRUNG mô tả bối cảnh thế giới, văn phong, cơ chế game, giao diện và quy tắc vận hành.
- Nếu là thẻ nhân vật bình thường: Viết mô tả chi tiết, khách quan ở ngôi thứ 3.

Yêu cầu định dạng JSON chính xác:
{
  "name": "Tên nhân vật (ngắn gọn)",
  "description": "Mô tả nhân vật (nếu là nhân vật) HOẶC mô tả hệ thống/cơ chế/bối cảnh (nếu là System/Game Master). Tuân thủ đúng Quy tắc quan trọng ở trên (ít nhất 200 từ, ngôi 3, khách quan)",
  "personality": "Mô tả tính cách (nếu được yêu cầu, ít nhất 100 từ)",
  "scenario": "Bối cảnh hiện tại (nếu được yêu cầu, ít nhất 50 từ)"
}
${JSON_FORMAT_REQUIREMENT}
`;
  return applyOverride(base, config.promptOverride, config.promptMode);
}

export function buildLorebookBatchPrompt(idea: string, cardContext: string, bp: CardBlueprint | null): string {
  const topicHints = bp?.suggestedEntryTopics
    ?.map(t => `- [${t.category}] ${t.title}: ${t.description} (priority: ${t.priority})`)
    .join('\n') ?? '';

  return `
Đây là tiến trình tạo hàng loạt Lorebook tự động cho ý tưởng card sau:
Ý TƯỞNG: "${idea}"
${blueprintContext(bp)}

${topicHints ? `--- CHỦ ĐỀ GỢI Ý TỪ BLUEPRINT ---\n${topicHints}\n` : ''}

NGỮ CẢNH HIỆN TẠI:
${cardContext}
`;
}

export function buildRegexPrompt(idea: string, cardContext: string, config: RegexStepConfig, bp: CardBlueprint | null): string {
  const base = `
Bạn là chuyên gia viết Regex Scripts cho SillyTavern. Dựa trên ý tưởng card và ngữ cảnh, hãy tạo ${config.count} regex scripts phù hợp.
Loại regex được yêu cầu: ${config.types.join(', ')}.

Ý TƯỞNG: "${idea}"
${blueprintContext(bp)}

NGỮ CẢNH:
${cardContext}

Yêu cầu định dạng JSON array:
[
  {
    "scriptName": "Tên script",
    "regex": "Mẫu regex cần tìm",
    "replaceString": "Chuỗi thay thế (có thể chứa HTML/CSS)",
    "placement": [1, 2],
    "minDepth": null,
    "maxDepth": null,
    "markdownOnly": false,
    "promptOnly": false
  }
]
${JSON_FORMAT_REQUIREMENT}
`;
  return applyOverride(base, config.promptOverride, config.promptMode);
}

export function buildMvuzodPrompt(idea: string, cardContext: string, config: MvuzodStepConfig, bp: CardBlueprint | null): string {
  const varHints = bp?.suggestedVariables
    ?.map(v => `- ${v.path} (${v.type}): ${v.description} [nhóm: ${v.group}]`)
    .join('\n') ?? '';

  const base = `
Bạn là chuyên gia về hệ thống biến trạng thái MVUZOD cho SillyTavern. Hãy tạo MVUZOD schema và các entries cần thiết.

Ý TƯỞNG: "${idea}"
${blueprintContext(bp)}

${varHints ? `--- BIẾN GỢI Ý TỪ BLUEPRINT ---\n${varHints}\n` : ''}

NGỮ CẢNH LOREBOOK (đã tạo từ bước trước):
${cardContext}

CẤU HÌNH:
- Auto-detect từ lorebook: ${config.autoDetect}
- Tạo InitVar: ${config.createInitVar}
- Tạo Update Rules: ${config.createUpdateRules}
- Tạo Variable List: ${config.createVarList}

Yêu cầu định dạng JSON chính xác:
{
  "schema": {
    "version": "1.0",
    "fields": [
      {
        "path": "/Group/VarName",
        "type": "number|string|boolean",
        "label": "Tên hiển thị",
        "defaultValue": 0,
        "constraints": { "min": 0, "max": 100 },
        "description": "Mô tả cho AI"
      }
    ]
  },
  "initVarEntry": "Nội dung cho [initvar] dưới dạng YAML/JSON (nếu được yêu cầu)",
  "updateRulesEntry": "Nội dung cho [mvu_update]Quy tắc cập nhật biến (nếu được yêu cầu)",
  "varListEntry": "Nội dung hiển thị biến (nếu được yêu cầu)"
}

QUY TẮC BẮT BUỘC VỀ SCHEMA:
- MỌI field (kể cả field lồng trong "children") BẮT BUỘC phải có key "constraints" — nếu không có ràng buộc nào thì dùng object rỗng {}.
- "constraints.enumValues" (nếu dùng) phải là MẢNG chuỗi, ví dụ ["Thấp","Trung","Cao"].
- MỌI field phải có đủ "path", "type", "label", "defaultValue".
${JSON_FORMAT_REQUIREMENT}
`;
  return applyOverride(base, config.promptOverride, config.promptMode);
}

export function buildSystemPromptPrompt(idea: string, cardContext: string, config: SystemPromptStepConfig, bp: CardBlueprint | null): string {
  const base = `
Hãy tạo system prompt hướng dẫn AI cách đóng vai nhân vật này. System prompt phải chi tiết, bao gồm quy tắc viết, phong cách, và các lưu ý quan trọng.
Ý TƯỞNG: "${idea}"
${blueprintContext(bp)}

NGỮ CẢNH:
${cardContext}

CẤU HÌNH:
- Tạo Depth Prompt: ${config.includeDepthPrompt}
- Depth level: ${config.depthValue}

Yêu cầu định dạng JSON chính xác:
{
  "system_prompt": "Nội dung system prompt chi tiết (ít nhất 200 từ)",
  "depth_prompt": "Nội dung depth prompt (nếu có, ít nhất 100 từ)"
}
${JSON_FORMAT_REQUIREMENT}
`;
  return applyOverride(base, config.promptOverride, config.promptMode);
}

export function buildFirstMessagePrompt(idea: string, cardContext: string, config: FirstMessageStepConfig, bp: CardBlueprint | null): string {
  const base = `
Hãy tạo first message mở đầu câu chuyện và ${config.alternateGreetings} alternate greetings.
First message phải viết chi tiết, sống động, mô tả bối cảnh, hành động và cảm xúc nhân vật.
Ý TƯỞNG: "${idea}"
${blueprintContext(bp)}

NGỮ CẢNH:
${cardContext}

Yêu cầu định dạng JSON chính xác:
{
  "first_mes": "Lời mở đầu chính (ít nhất 150 từ, viết theo ngôi và tone phù hợp)...",
  "alternate_greetings": [
    "Lời mở đầu phụ 1 (khác bối cảnh/mood)...",
    "Lời mở đầu phụ 2..."
  ]
}
${JSON_FORMAT_REQUIREMENT}
`;
  return applyOverride(base, config.promptOverride, config.promptMode);
}

export function buildMesExamplePrompt(idea: string, cardContext: string, config: MesExampleStepConfig, bp: CardBlueprint | null): string {
  const base = `
Hãy tạo ${config.exampleCount} đoạn hội thoại mẫu (Message Examples) giữa {{user}} và {{char}}.
Mỗi đoạn phải thể hiện tính cách nhân vật, phong cách viết, và format đối thoại.
Ý TƯỞNG: "${idea}"
${blueprintContext(bp)}

NGỮ CẢNH:
${cardContext}

Yêu cầu định dạng JSON chính xác:
{
  "mes_example": "<START>\\n{{user}}: ...\\n{{char}}: ...\\n<START>\\n{{user}}: ...\\n{{char}}: ..."
}
${JSON_FORMAT_REQUIREMENT}
`;
  return applyOverride(base, config.promptOverride, config.promptMode);
}
