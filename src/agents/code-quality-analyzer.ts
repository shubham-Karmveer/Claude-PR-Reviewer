import { CODE_QUALITY_ANALYZER_PROMPT } from '../prompts';
import { CodeQualityResultJSONSchema } from '../types/analysis-results';
import { mcpServersConfig } from '../config/mcp.config';

// Code Quality Analyzer agent definition
export const codeQualityAnalyzer = {
  name: 'Code Quality Analyzer',
  description: 'Analyzes code for quality issues, security vulnerabilities, and best practices',
  instructions: CODE_QUALITY_ANALYZER_PROMPT,
  model: 'sonnet',
  mcp_servers: {
    eslint: mcpServersConfig.eslint
  }
};
