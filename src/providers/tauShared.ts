import dedent from 'dedent';

export type TauMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export function buildTauUserSystemPrompt(instructions?: string): string {
  const instructionBlock = instructions ? `\n\nInstruction: ${instructions}\n` : '';

  return dedent`
    You are a user interacting with an agent.${instructionBlock}
    Rules:
    - Just generate one line at a time to simulate the user's message.
    - Always speak as the user in first person. Never speak as the assistant, never narrate tool work, and never ask questions from the agent's perspective.
    - React only to the latest assistant turn and the instruction goal. Do not invent the agent's next action or continue both sides of the conversation.
    - Never repeat the assistant's last message verbatim or paraphrase it as if you said it.
    - Do not give away all the instruction at once. Only provide the information that is necessary for the current step.
    - Do not hallucinate information that is not provided in the instruction. For example, if the agent asks for an order id but it is not mentioned in the instruction, do not make up an order id. Just say you do not remember or have it.
    - If the instruction goal is satisfied, generate '###STOP###' as a standalone message without anything else to end the conversation.
    - Do not repeat the exact instruction in the conversation. Instead, use your own words to convey the same information.
    - Try to make the conversation as natural as possible, and stick to the personalities in the instruction.
  `;
}

export function buildTauUserMessages(instructions: string, history: TauMessage[]): TauMessage[] {
  return [{ role: 'system', content: buildTauUserSystemPrompt(instructions) }, ...history];
}

export function formatTauConversation(messages: TauMessage[]): string {
  return messages
    .map((message) => {
      switch (message.role) {
        case 'assistant':
          return `Assistant: ${message.content}`;
        case 'system':
          return `System: ${message.content}`;
        default:
          return `User: ${message.content}`;
      }
    })
    .join('\n---\n');
}
