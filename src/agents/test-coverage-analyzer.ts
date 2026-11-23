import { TEST_COVERAGE_ANALYZER_PROMPT } from '../prompts';
import { TestCoverageResultJSONSchema } from '../types/analysis-results';
import { mcpServersConfig } from '../config/mcp.config';

// Test Coverage Analyzer agent definition
export const testCoverageAnalyzer = {
  name: 'Test Coverage Analyzer',
  description: 'Analyzes test coverage and identifies untested code paths',
  instructions: TEST_COVERAGE_ANALYZER_PROMPT,
  model: 'sonnet',
  mcp_servers: {
    github: mcpServersConfig.github
  }
};
