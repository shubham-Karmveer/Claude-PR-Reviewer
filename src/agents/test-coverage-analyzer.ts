import { TEST_COVERAGE_ANALYZER_PROMPT } from '../prompts';
import { TestCoverageResultJSONSchema } from '../types/analysis-results';
import { mcpServersConfig } from '../config/mcp.config';

// Extract model identifier from ANTHROPIC_MODEL env var
// Maps full model names (claude-sonnet-4-5-...) to SDK identifiers (sonnet, opus, haiku)
const getModelIdentifier = (): 'sonnet' | 'opus' | 'haiku' => {
  const model = process.env.ANTHROPIC_MODEL || '';
  if (model.includes('opus')) return 'opus';
  if (model.includes('haiku')) return 'haiku';
  return 'sonnet'; // default
};

// Test Coverage Analyzer agent definition
export const testCoverageAnalyzer = {
  name: 'Test Coverage Analyzer',
  description: 'Analyzes test coverage and identifies untested code paths',
  prompt: TEST_COVERAGE_ANALYZER_PROMPT,
  model: getModelIdentifier(),
  tools: ['Read', 'Grep', 'Glob', 'Skill'],
  mcp_servers: {
    github: mcpServersConfig.github
  }
};
