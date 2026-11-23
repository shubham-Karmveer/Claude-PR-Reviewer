import { CODE_QUALITY_ANALYZER_PROMPT } from '../prompts';
import { CodeQualityResultJSONSchema } from '../types/analysis-results';
import { mcpServersConfig } from '../config/mcp.config';

// Extract model identifier from ANTHROPIC_MODEL env var
// Maps full model names (claude-sonnet-4-5-...) to SDK identifiers (sonnet, opus, haiku)
const getModelIdentifier = (): 'sonnet' | 'opus' | 'haiku' => {
  const model = process.env.ANTHROPIC_MODEL || '';
  if (model.includes('opus')) return 'opus';
  if (model.includes('haiku')) return 'haiku';
  return 'sonnet'; // default
};

// Code Quality Analyzer agent definition
export const codeQualityAnalyzer = {
  name: 'Code Quality Analyzer',
  description: 'Analyzes code for quality issues, security vulnerabilities, and best practices',
  prompt: CODE_QUALITY_ANALYZER_PROMPT,
  model: getModelIdentifier(),
  tools: ['Read', 'Grep', 'Glob', 'Skill'],
  mcp_servers: {
    eslint: mcpServersConfig.eslint
  }
};
