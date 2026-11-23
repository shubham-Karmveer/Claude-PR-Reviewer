import { REFACTORING_SUGGESTER_PROMPT } from '../prompts';
import { RefactoringSuggestionJSONSchema } from '../types/analysis-results';
import { mcpServersConfig } from '../config/mcp.config';

// Extract model identifier from ANTHROPIC_MODEL env var
// Maps full model names (claude-sonnet-4-5-...) to SDK identifiers (sonnet, opus, haiku)
const getModelIdentifier = (): 'sonnet' | 'opus' | 'haiku' => {
  const model = process.env.ANTHROPIC_MODEL || '';
  if (model.includes('opus')) return 'opus';
  if (model.includes('haiku')) return 'haiku';
  return 'sonnet'; // default
};

// Refactoring Suggester agent definition
export const refactoringSuggester = {
  name: 'Refactoring Suggester',
  description: 'Recommends architectural improvements and refactoring opportunities',
  prompt: REFACTORING_SUGGESTER_PROMPT,
  model: getModelIdentifier(),
  tools: ['Read', 'Grep', 'Glob', 'Skill'],
  mcp_servers: {
    github: mcpServersConfig.github,
    eslint: mcpServersConfig.eslint
  }
};
