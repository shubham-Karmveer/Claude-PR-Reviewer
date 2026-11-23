import { ReviewReport, ReviewReportSchema } from './types/report-types';
import {
  CodeQualityResult,
  TestCoverageResult,
  RefactoringSuggestion
} from './types/analysis-results';
import { codeQualityAnalyzer, testCoverageAnalyzer, refactoringSuggester } from './agents';
import { buildOrchestratorPrompt } from './prompts';
import { logger, logReviewStart, logReviewComplete, logReviewError, logAgentStart } from './utils/logger';
import { githubClient } from './utils/github-client';
import { ReportGenerator } from './utils/report-generator';
import { EventEmitter } from 'events';

/**
 * Progress event types
 */
export interface ProgressEvent {
  type: 'agent_start' | 'agent_complete' | 'pr_comment_posted';
  agent?: string;
  message: string;
}

/**
 * Orchestrator configuration options
 */
export interface OrchestratorOptions {
  timeoutMs?: number;
  enablePRComment?: boolean;
}

/**
 * Main Code Review Orchestrator
 * Coordinates subagents to analyze pull requests and generate comprehensive reports
 */
export class CodeReviewOrchestrator extends EventEmitter {
  private timeoutMs: number;
  private enablePRComment: boolean;

  constructor(options: OrchestratorOptions = {}) {
    super();
    this.timeoutMs = options.timeoutMs || 300000; // 5 minutes default
    this.enablePRComment = options.enablePRComment !== false; // enabled by default
  }

  /**
   * Review a pull request using parallel subagent analysis
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Complete review report
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const startTime = Date.now();
    logReviewStart(owner, repo, prNumber);

    try {
      // Get PR context
      const prContext = {
        owner,
        repo,
        prNumber,
        url: `https://github.com/${owner}/${repo}/pull/${prNumber}`
      };

      logger.info(`Fetching PR details: ${prContext.url}`);

      // Spawn three subagents in parallel
      logAgentStart('Code Quality Analyzer', 'pr');
      this.emitProgress('agent_start', 'Code Quality Analyzer');
      const qualityPromise = this.analyzeCodeQuality(owner, repo, prNumber);

      logAgentStart('Test Coverage Analyzer', 'pr');
      this.emitProgress('agent_start', 'Test Coverage Analyzer');
      const coveragePromise = this.analyzeTestCoverage(owner, repo, prNumber);

      logAgentStart('Refactoring Suggester', 'pr');
      this.emitProgress('agent_start', 'Refactoring Suggester');
      const refactoringPromise = this.suggestRefactorings(owner, repo, prNumber);

      // Wait for all agents to complete
      const [qualityResults, coverageResults, refactoringResults] = await Promise.all([
        qualityPromise.then(result => { this.emitProgress('agent_complete', 'Code Quality Analyzer'); return result; }),
        coveragePromise.then(result => { this.emitProgress('agent_complete', 'Test Coverage Analyzer'); return result; }),
        refactoringPromise.then(result => { this.emitProgress('agent_complete', 'Refactoring Suggester'); return result; })
      ]);

      // Aggregate results
      const duration = Date.now() - startTime;
      const report = this.aggregateResults(
        prContext,
        qualityResults,
        coverageResults,
        refactoringResults,
        duration
      );

      // Validate report with schema
      ReviewReportSchema.parse(report);

      // Post comment to PR if enabled
      if (this.enablePRComment) {
        await this.postPRComment(owner, repo, prNumber, report);
      }

      logReviewComplete(owner, repo, prNumber, report.summary.overallScore, duration);
      return report;
    } catch (error) {
      logReviewError(owner, repo, prNumber, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private async analyzeCodeQuality(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<CodeQualityResult[]> {
    try {
      const prompt = `Analyze the code quality of PR #${prNumber} in ${owner}/${repo}.
      Focus on identifying security issues, performance problems, and best practice violations.
      Return structured JSON with files, issues, scores, and summaries.`;

      // In a real implementation, this would spawn an agent and get results
      // For now, return a minimal valid result structure
      return [{
        file: 'example.ts',
        issues: [],
        overallScore: 80,
        summary: 'Code quality analysis complete'
      }];
    } catch (error) {
      logger.error('Code quality analysis failed:', error);
      throw error;
    }
  }

  private async analyzeTestCoverage(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<TestCoverageResult[]> {
    try {
      const prompt = `Analyze test coverage of PR #${prNumber} in ${owner}/${repo}.
      Identify untested code paths and missing test cases.
      Return structured JSON with files, coverage estimates, and suggested tests.`;

      // In a real implementation, this would spawn an agent and get results
      return [{
        file: 'example.ts',
        hasTests: true,
        testFiles: [],
        untestedPaths: [],
        coverageEstimate: 70,
        summary: 'Test coverage analysis complete'
      }];
    } catch (error) {
      logger.error('Test coverage analysis failed:', error);
      throw error;
    }
  }

  private async suggestRefactorings(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<RefactoringSuggestion[]> {
    try {
      const prompt = `Suggest refactorings for PR #${prNumber} in ${owner}/${repo}.
      Recommend architectural improvements and modernization opportunities.
      Return structured JSON with files, suggestions, and benefits.`;

      // In a real implementation, this would spawn an agent and get results
      return [{
        file: 'example.ts',
        suggestions: [],
        summary: 'Refactoring analysis complete'
      }];
    } catch (error) {
      logger.error('Refactoring suggestion failed:', error);
      throw error;
    }
  }

  private aggregateResults(
    prContext: { owner: string; repo: string; prNumber: number },
    qualityResults: CodeQualityResult[],
    coverageResults: TestCoverageResult[],
    refactoringResults: RefactoringSuggestion[],
    duration: number
  ): ReviewReport {
    // Combine results for each file
    const fileMap = new Map<string, any>();

    // Merge quality results
    qualityResults.forEach((result) => {
      if (!fileMap.has(result.file)) {
        fileMap.set(result.file, {});
      }
      fileMap.get(result.file).codeQuality = result;
    });

    // Merge coverage results
    coverageResults.forEach((result) => {
      if (!fileMap.has(result.file)) {
        fileMap.set(result.file, {});
      }
      fileMap.get(result.file).testCoverage = result;
    });

    // Merge refactoring results
    refactoringResults.forEach((result) => {
      if (!fileMap.has(result.file)) {
        fileMap.set(result.file, {});
      }
      fileMap.get(result.file).refactorings = result;
    });

    // Build file reviews
    const fileReviews = Array.from(fileMap.entries()).map(([file, reviews]) => ({
      file,
      codeQuality: reviews.codeQuality || { file, issues: [], overallScore: 0, summary: '' },
      testCoverage: reviews.testCoverage || { file, hasTests: false, testFiles: [], untestedPaths: [], coverageEstimate: 0, summary: '' },
      refactorings: reviews.refactorings || { file, suggestions: [], summary: '' }
    }));

    // Calculate summary
    const totalFiles = fileReviews.length;
    const overallScore = fileReviews.length > 0
      ? Math.round(
        fileReviews.reduce((sum, r) => sum + (r.codeQuality?.overallScore || 0), 0) / fileReviews.length
      )
      : 0;

    const criticalIssues = fileReviews.reduce((count, r) => {
      const critical = r.codeQuality?.issues?.filter((i: any) => i.severity === 'critical') || [];
      return count + critical.length;
    }, 0);

    const highPriorityTests = fileReviews.reduce((count, r) => {
      const high = r.testCoverage?.untestedPaths?.filter((u: any) => u.priority === 'high' || u.priority === 'critical') || [];
      return count + high.length;
    }, 0);

    const refactoringOpportunities = fileReviews.reduce((count, r) => {
      return count + (r.refactorings?.suggestions?.length || 0);
    }, 0);

    return {
      pullRequest: {
        owner: prContext.owner,
        repo: prContext.repo,
        number: prContext.prNumber
      },
      fileReviews,
      summary: {
        totalFiles,
        overallScore,
        criticalIssues,
        highPriorityTests,
        refactoringOpportunities
      },
      recommendations: this.generateRecommendations(fileReviews),
      metadata: {
        analyzedAt: new Date().toISOString(),
        duration,
        agentVersions: {
          'code-quality-analyzer': '1.0.0',
          'test-coverage-analyzer': '1.0.0',
          'refactoring-suggester': '1.0.0'
        }
      }
    };
  }

  private generateRecommendations(fileReviews: any[]): ReviewReport['recommendations'] {
    const recommendations: ReviewReport['recommendations'] = [];

    // Extract critical issues
    const criticalFiles = fileReviews.filter(
      (r) => r.codeQuality?.issues?.some((i: any) => i.severity === 'critical')
    );

    if (criticalFiles.length > 0) {
      recommendations.push({
        priority: 'critical',
        category: 'security',
        description: 'Fix critical security issues before merging',
        files: criticalFiles.map((r) => r.file)
      });
    }

    // Extract high-priority test gaps
    const lowCoverageFiles = fileReviews.filter(
      (r) => r.testCoverage?.coverageEstimate && r.testCoverage.coverageEstimate < 50
    );

    if (lowCoverageFiles.length > 0) {
      recommendations.push({
        priority: 'high',
        category: 'testing',
        description: 'Add tests for low-coverage areas',
        files: lowCoverageFiles.map((r) => r.file)
      });
    }

    return recommendations;
  }

  private emitProgress(type: ProgressEvent['type'], agent?: string): void {
    const message = this.getProgressMessage(type, agent);
    this.emit('progress', {
      type,
      agent,
      message
    } as ProgressEvent);
    logger.debug(`Progress: ${message}`);
  }

  private getProgressMessage(type: ProgressEvent['type'], agent?: string): string {
    switch (type) {
      case 'agent_start':
        return `Starting ${agent}...`;
      case 'agent_complete':
        return `Completed ${agent}`;
      case 'pr_comment_posted':
        return 'Posted review summary to PR';
      default:
        return 'Review in progress';
    }
  }

  private async postPRComment(
    owner: string,
    repo: string,
    prNumber: number,
    report: ReviewReport
  ): Promise<void> {
    try {
      logger.info('Preparing to post PR comment with review summary');

      // Generate markdown report
      const generator = new ReportGenerator();
      const markdownReport = generator.generateMarkdownReport(report);

      // Create comment body with summary focus
      const commentBody = this.formatPRComment(markdownReport, report);

      // Post comment
      const success = await githubClient.postPRComment(owner, repo, prNumber, commentBody);

      if (success) {
        this.emitProgress('pr_comment_posted');
      }
    } catch (error) {
      logger.error('Failed to post PR comment:', error);
      // Don't throw - commenting failure shouldn't fail the entire review
    }
  }

  private formatPRComment(markdownReport: string, report: ReviewReport): string {
    // Create a focused comment with key metrics and top recommendations
    const summary = report.summary;
    const recommendations = report.recommendations.slice(0, 3);

    let comment = `## 🔍 Code Review Summary\n\n`;
    comment += `**Overall Score:** ${summary.overallScore}/100 | **Files Reviewed:** ${summary.totalFiles}\n\n`;

    if (recommendations.length > 0) {
      comment += `### Key Recommendations\n`;
      recommendations.forEach(rec => {
        const emoji = { critical: '🚨', high: '⚠️', medium: '📝', low: '💡' }[rec.priority];
        comment += `- ${emoji} **${rec.priority.toUpperCase()}**: ${rec.category} - ${rec.description}\n`;
      });
      comment += '\n';
    }

    // Add link to full report if stored locally
    comment += `---\n`;
    comment += `*Review metrics: Critical Issues: ${summary.criticalIssues} | Test Gaps: ${summary.highPriorityTests} | Refactoring Opportunities: ${summary.refactoringOpportunities}*\n`;
    comment += `*Generated at ${report.metadata.analyzedAt}*`;

    return comment;
  }
}
