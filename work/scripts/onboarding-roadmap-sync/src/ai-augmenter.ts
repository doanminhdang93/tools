import Anthropic from "@anthropic-ai/sdk";
import { withRetry } from "./chunking.ts";
import type { Block } from "./html-to-blocks.ts";

const SYSTEM_PROMPT = `You are an onboarding mentor at Avada — the X Team builds Shopify apps using NodeJS, ReactJS, Firebase, and Google Cloud.

Given a documentation page that a new developer (dev mới) needs to read for their onboarding, generate two things:

1. A "Checklist" — 4–6 concrete, actionable items the dev should complete to demonstrate they have internalized the material. Each item must be verifiable (something a mentor can check). Prefer concrete tooling/code/actions over abstract understanding. Examples of GOOD checklist items: "Cài KoaJS bằng npm và tạo route /hello trả về 'world'", "Push code mẫu lên GitLab trong nhánh dev/<tên>". Examples of BAD: "Hiểu KoaJS", "Đọc xong tài liệu" (too generic).

2. "Questions to discuss with mentor" — 2–4 open-ended discussion questions that encourage critical thinking, not factual recall. Examples of GOOD: "Trong tình huống nào bạn sẽ chọn KoaJS thay vì Express?". Examples of BAD: "KoaJS là gì?" (factual).

Output language: Vietnamese. Be specific to the content of the docs page — do NOT produce generic onboarding advice.`;

export type Augmentation = {
  checklist: string[];
  questions: string[];
};

const SCHEMA = {
  type: "object",
  properties: {
    checklist: {
      type: "array",
      items: { type: "string" },
      description: "4–6 concrete, verifiable actions for the dev",
    },
    questions: {
      type: "array",
      items: { type: "string" },
      description: "2–4 open-ended discussion questions for the mentor",
    },
  },
  required: ["checklist", "questions"],
  additionalProperties: false,
};

const MAX_INPUT_CHARS = 30000;

export function makeAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

export async function generateAugmentation(
  client: Anthropic,
  args: { title: string; contentText: string },
): Promise<Augmentation> {
  const truncated =
    args.contentText.length > MAX_INPUT_CHARS
      ? args.contentText.slice(0, MAX_INPUT_CHARS)
      : args.contentText;

  const response = await withRetry(() =>
    client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 2048,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: `Task title: ${args.title}\n\n--- Docs content ---\n${truncated}`,
        },
      ],
    }),
  );

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) {
    throw new Error("AI augmenter returned no text block");
  }
  const parsed = JSON.parse(textBlock.text) as Augmentation;
  if (!Array.isArray(parsed.checklist) || !Array.isArray(parsed.questions)) {
    throw new Error("AI augmenter returned malformed JSON");
  }
  return parsed;
}

export function augmentationToBlocks(augmentation: Augmentation): Block[] {
  const blocks: Block[] = [];

  blocks.push({ type: "divider", divider: {} });

  blocks.push({
    type: "heading_2",
    heading_2: {
      rich_text: [richTextOf("✅ Checklist trước khi đánh Done")],
      color: "default",
      is_toggleable: false,
    },
  });

  for (const item of augmentation.checklist) {
    blocks.push({
      type: "to_do",
      to_do: {
        rich_text: [richTextOf(item)],
        checked: false,
        color: "default",
      },
    });
  }

  blocks.push({ type: "divider", divider: {} });

  blocks.push({
    type: "heading_2",
    heading_2: {
      rich_text: [richTextOf("💬 Questions to discuss with mentor")],
      color: "default",
      is_toggleable: false,
    },
  });

  for (const question of augmentation.questions) {
    blocks.push({
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [richTextOf(question)],
        color: "default",
      },
    });
  }

  return blocks;
}

function richTextOf(content: string) {
  return {
    type: "text" as const,
    text: { content, link: null },
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: "default" as const,
    },
    plain_text: content,
    href: null,
  };
}
