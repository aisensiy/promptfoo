import { describe, expect, it } from 'vitest';
import { buildTauUserSystemPrompt } from '../../src/providers/tauShared';

describe('tauShared', () => {
  it('should reinforce user-only turn generation', () => {
    const prompt = buildTauUserSystemPrompt('Book a flight');

    expect(prompt).toContain('Always speak as the user in first person.');
    expect(prompt).toContain('Never speak as the assistant, never narrate tool work');
    expect(prompt).toContain("Do not invent the agent's next action");
    expect(prompt).toContain("Never repeat the assistant's last message verbatim");
  });
});
