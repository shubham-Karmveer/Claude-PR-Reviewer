import { REFACTORING_SUGGESTER_PROMPT } from '../prompts';
import { RefactoringSuggestionJSONSchema } from '../types/analysis-results';
import { mcpServersConfig } from '../config/mcp.config';

// Refactoring Suggester agent definition
export const refactoringSuggester = {
  name: 'Refactoring Suggester',
  description: 'Recommends architectural improvements and refactoring opportunities',
  instructions: REFACTORING_SUGGESTER_PROMPT,
  model: 'sonnet',
  mcp_servers: {
    github: mcpServersConfig.github,
    eslint: mcpServersConfig.eslint
  }
};
