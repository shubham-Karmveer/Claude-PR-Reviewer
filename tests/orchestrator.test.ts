import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CodeReviewOrchestrator } from '../src/orchestrator';
import { ReviewReportSchema } from '../src/types/report-types';

/**
 * Tests for CodeReviewOrchestrator
 *
 * These tests mock the Claude Agent SDK query() function to avoid making real API calls
 * and test the orchestrator's ability to aggregate results and validate schemas.
 */

// Mock the Claude Agent SDK
let callCount = 0;

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(async function* mockQuery() {
    // Return different outputs based on which call this is (each agent type)
    // Call 1: Code Quality, Call 2: Test Coverage, Call 3: Refactoring

    const mockCodeQualityOutput = JSON.stringify([
      {
        file: 'src/example.ts',
        issues: [
          {
            line: 10,
            severity: 'high',
            category: 'security',
            description: 'Potential SQL injection vulnerability',
            suggestion: 'Use parameterized queries'
          }
        ],
        overallScore: 75,
        summary: 'Found security issues in file'
      }
    ]);

    const mockTestCoverageOutput = JSON.stringify([
      {
        file: 'src/example.ts',
        hasTests: false,
        testFiles: [],
        untestedPaths: [
          {
            type: 'function' as const,
            location: 'queryDatabase() at line 10',
            priority: 'high' as const,
            reasoning: 'Database interaction functions should be tested',
            suggestedTest: 'Test queryDatabase with mock database connection'
          }
        ],
        coverageEstimate: 50,
        summary: 'Missing tests for critical paths'
      }
    ]);

    const mockRefactoringOutput = JSON.stringify([
      {
        file: 'src/example.ts',
        suggestions: [
          {
            type: 'extract-function' as const,
            location: 'queryDatabase() at line 10',
            impact: 'medium' as const,
            description: 'Extract database query logic into separate utility',
            before: 'const result = db.query(sql)',
            after: 'const result = queryDB(sql)',
            benefits: 'Better testability and reusability'
          }
        ],
        summary: 'Found opportunities to improve code organization'
      }
    ]);

    callCount++;
    let output = mockCodeQualityOutput;

    if (callCount % 3 === 2) {
      output = mockTestCoverageOutput;
    } else if (callCount % 3 === 0) {
      output = mockRefactoringOutput;
    }

    yield {
      type: 'assistant',
      content: output
    };
  })
}));

describe('CodeReviewOrchestrator', () => {
  describe('Configuration', () => {
    it('should initialize with default options', () => {
      const orchestrator = new CodeReviewOrchestrator();
      expect(orchestrator).toBeDefined();
    });

    it('should accept custom timeout configuration', () => {
      const customTimeoutMs = 60000;
      const orchestrator = new CodeReviewOrchestrator({ timeoutMs: customTimeoutMs });
      expect(orchestrator).toBeDefined();
    });
  });

  describe('reviewPullRequest', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      callCount = 0; // Reset call counter for each test
    });

    it('should return a ReviewReport', async () => {
      const orchestrator = new CodeReviewOrchestrator({ enablePRComment: false });
      const report = await orchestrator.reviewPullRequest('test', 'repo', 1);

      expect(report).toBeDefined();
      expect(report.pullRequest).toBeDefined();
      expect(report.pullRequest.owner).toBe('test');
      expect(report.pullRequest.repo).toBe('repo');
      expect(report.pullRequest.number).toBe(1);
    });

    it('should include fileReviews in the report', async () => {
      const orchestrator = new CodeReviewOrchestrator({ enablePRComment: false });
      const report = await orchestrator.reviewPullRequest('test', 'repo', 1);

      expect(report.fileReviews).toBeDefined();
      expect(Array.isArray(report.fileReviews)).toBe(true);
    });

    it('should include summary in the report', async () => {
      const orchestrator = new CodeReviewOrchestrator({ enablePRComment: false });
      const report = await orchestrator.reviewPullRequest('test', 'repo', 1);

      expect(report.summary).toBeDefined();
      expect(report.summary.totalFiles).toBeGreaterThanOrEqual(0);
      expect(report.summary.overallScore).toBeGreaterThanOrEqual(0);
    });

    it('should include metadata in the report', async () => {
      const orchestrator = new CodeReviewOrchestrator({ enablePRComment: false });
      const report = await orchestrator.reviewPullRequest('test', 'repo', 1);

      expect(report.metadata).toBeDefined();
      expect(report.metadata.analyzedAt).toBeDefined();
      expect(report.metadata.duration).toBeGreaterThanOrEqual(0);
      expect(report.metadata.agentVersions).toBeDefined();
    });

    it('should validate output with Zod schema', async () => {
      const orchestrator = new CodeReviewOrchestrator({ enablePRComment: false });
      const report = await orchestrator.reviewPullRequest('test', 'repo', 1);

      // This should not throw if the schema is valid
      expect(() => ReviewReportSchema.parse(report)).not.toThrow();
    });
  });

  describe('Integration', () => {
    // These tests require actual API keys and should be skipped in CI
    it.skip('should review a real small PR', async () => {
      // TODO: Test with a real public PR
      // NOTE: Only run manually with valid API keys
      const orchestrator = new CodeReviewOrchestrator();
      const report = await orchestrator.reviewPullRequest('facebook', 'react', 1);

      expect(report).toBeDefined();
      expect(report.pullRequest.number).toBe(1);
    });
  });
});
