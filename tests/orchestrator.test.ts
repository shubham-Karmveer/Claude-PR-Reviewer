import { describe, it, expect } from 'vitest';
import { CodeReviewOrchestrator } from '../src/orchestrator';
import { ReviewReportSchema } from '../src/types/report-types';

/**
 * Tests for CodeReviewOrchestrator
 *
 * TODO: Implement these tests
 *
 * Tips:
 * - Use vitest mocking for MCP servers
 * - Mock rate limiter to avoid delays
 * - Test both success and failure paths
 */

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
    it('should return a ReviewReport', async () => {
      const orchestrator = new CodeReviewOrchestrator();
      const report = await orchestrator.reviewPullRequest('test', 'repo', 1);

      expect(report).toBeDefined();
      expect(report.pullRequest).toBeDefined();
      expect(report.pullRequest.owner).toBe('test');
      expect(report.pullRequest.repo).toBe('repo');
      expect(report.pullRequest.number).toBe(1);
    });

    it('should include fileReviews in the report', async () => {
      const orchestrator = new CodeReviewOrchestrator();
      const report = await orchestrator.reviewPullRequest('test', 'repo', 1);

      expect(report.fileReviews).toBeDefined();
      expect(Array.isArray(report.fileReviews)).toBe(true);
    });

    it('should include summary in the report', async () => {
      const orchestrator = new CodeReviewOrchestrator();
      const report = await orchestrator.reviewPullRequest('test', 'repo', 1);

      expect(report.summary).toBeDefined();
      expect(report.summary.totalFiles).toBeGreaterThanOrEqual(0);
      expect(report.summary.overallScore).toBeGreaterThanOrEqual(0);
    });

    it('should include metadata in the report', async () => {
      const orchestrator = new CodeReviewOrchestrator();
      const report = await orchestrator.reviewPullRequest('test', 'repo', 1);

      expect(report.metadata).toBeDefined();
      expect(report.metadata.analyzedAt).toBeDefined();
      expect(report.metadata.duration).toBeGreaterThanOrEqual(0);
      expect(report.metadata.agentVersions).toBeDefined();
    });

    it('should validate output with Zod schema', async () => {
      const orchestrator = new CodeReviewOrchestrator();
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
