import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";

interface AskUserInput {
  question: string;
  options: string[];
}

export const askUserQuestionTool: ToolDefinition = {
  name: "ask_user_question",
  description: "Ask the user a multiple-choice question and wait for their answer. Use when you need clarification before proceeding, or want to offer the user choices about how to approach a task. Options should be 2-4 concise choices.",
  inputSchema: {
    properties: {
      question: {
        type: "string",
        description: "The question to ask the user",
      },
      options: {
        type: "array",
        items: { type: "string" },
        description: "2-4 options for the user to choose from",
        minItems: 2,
        maxItems: 4,
      },
    },
    required: ["question", "options"],
  },
  isDestructive: false,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { question, options } = input as AskUserInput;

    if (!options || options.length < 2) {
      return { toolUseId: "", content: "Error: need at least 2 options", isError: true };
    }

    const askUser = ctx.askUser;

    if (askUser) {
      const answer = await askUser(question, options);
      return { toolUseId: "", content: answer, isError: false };
    } else {
      const { createInterface } = await import("node:readline");
      return new Promise((resolve) => {
        process.stdout.write(`\n${question}\n`);
        options.forEach((opt, i) => process.stdout.write(`  ${i + 1}. ${opt}\n`));
        process.stdout.write("\nYour choice (number): ");
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        rl.once("line", (line) => {
          rl.close();
          const idx = parseInt(line.trim()) - 1;
          const answer = options[idx] ?? options[0];
          resolve({ toolUseId: "", content: answer, isError: false });
        });
      });
    }
  },
};
