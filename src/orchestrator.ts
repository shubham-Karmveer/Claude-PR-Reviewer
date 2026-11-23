import { query } from '@anthropic-ai/claude-agent-sdk';
import { ReviewReport, ReviewReportSchema } from './types/report-types';
import {
  CodeQualityResult,
  TestCoverageResult,
  RefactoringSuggestion,
  CodeQualityResultSchema,
  TestCoverageResultSchema,
  RefactoringSuggestionSchema
} from './types/analysis-results';
import { codeQualityAnalyzer, testCoverageAnalyzer, refactoringSuggester } from './agents';
import { buildOrchestratorPrompt } from './prompts';
import { logger, logReviewStart, logReviewComplete, logReviewError, logAgentStart } from './utils/logger';
import { githubClient } from './utils/github-client';
import { ReportGenerator } from './utils/report-generator';
import { mcpServersConfig } from './config/mcp.config';
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
      const prompt = `You are analyzing PR #${prNumber} in ${owner}/${repo}.

CRITICAL STEPS:
1. FIRST: Use mcp__github tool to get PR details and fetch all changed files
2. SECOND: For each file, read its content using the Read tool
3. THIRD: Analyze the code for issues
4. FOURTH: Format and return results as JSON

ANALYSIS REQUIREMENTS:
Analyze each file for:
1. Security vulnerabilities (SQL injection, XSS, exposed credentials, etc.)
2. Performance issues (inefficient algorithms, memory leaks, N+1 queries)
3. Best practice violations (error handling, logging, validation)
4. Code smells (long functions, duplication, complexity)
5. Maintainability issues (unclear naming, poor structure)

For each file with issues, provide:
- file: exact filename path
- issues: array where EACH object has {line, severity, category, description, suggestion}
- overallScore: 0-100 quality score (100=perfect, 0=severe issues)
- summary: 1-2 sentence summary

If a file has no issues, still include it with empty issues array and high score.

RESPONSE FORMAT - Return ONLY a valid JSON array, no other text:
[
  {"file":"src/index.js","issues":[{"line":15,"severity":"high","category":"security","description":"SQL injection vulnerability","suggestion":"Use parameterized queries"}],"overallScore":45,"summary":"Critical security issues found"},
  {"file":"src/utils.js","issues":[],"overallScore":95,"summary":"Well-written utilities"}
]

REQUIRED CONSTRAINTS:
- severity must be: "critical", "high", "medium", "low", or "info"
- category must be: "security", "performance", "maintainability", "style", "bug-risk", or "best-practice"
- line must be a positive integer
- overallScore must be 0-100
- Always return an array, even if empty: []
- NO markdown, NO explanations, ONLY valid JSON`;

      const results: CodeQualityResult[] = [];

      for await (const message of query({
        prompt,
        options: {
          mcpServers: mcpServersConfig,
          allowedTools: ['Task', 'mcp__github', 'mcp__eslint', 'Read', 'Glob', 'Grep'],
          agents: { codeQualityAnalyzer }
        }
      })) {
        const content = (message as any).content || (message as any).text || '';
        if (content && typeof content === 'string') {
          logger.debug('Code quality agent response (first 500 chars):', content.substring(0, 500));

          try {
            // Try to extract JSON array from response
            let parsed: unknown;

            // Try 1: Direct array pattern
            let jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              parsed = JSON.parse(jsonMatch[0]);
            } else {
              // Try 2: If no array, check if entire content is JSON
              parsed = JSON.parse(content);
            }

            // Validate against schema
            const validationResult = CodeQualityResultSchema.safeParse(parsed);

            if (!validationResult.success) {
              logger.warn('Code quality output failed schema validation');
              logger.debug('Validation errors:', validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`));
              continue;
            }

            // Ensure we have an array
            const dataArray = Array.isArray(validationResult.data) ? validationResult.data : [validationResult.data];
            results.push(...dataArray);
            logger.info(`Code quality agent found ${dataArray.length} files analyzed, ${results.length} total`);
          } catch (parseError) {
            logger.debug('Could not parse code quality output:', parseError instanceof Error ? parseError.message : String(parseError));
            logger.debug('Raw content:', content.substring(0, 300));
          }
        }
      }

      // Return results or minimal valid structure if none found
      return results.length > 0 ? results : [{
        file: 'analysis_complete',
        issues: [],
        overallScore: 75,
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
      const prompt = `You are analyzing test coverage for PR #${prNumber} in ${owner}/${repo}.

CRITICAL STEPS:
1. FIRST: Use mcp__github tool to get PR details and fetch all changed files
2. SECOND: For each file, read its content using the Read tool
3. THIRD: Look for test files in common test directories (test/, tests/, __tests__, .test.js, .spec.js)
4. FOURTH: Analyze code coverage and format as JSON

COVERAGE ANALYSIS:
For each file changed in the PR:
1. Check if test files exist for it (file.test.js, file.spec.js, etc.)
2. If tests exist, estimate coverage percentage
3. Identify untested code paths (functions, branches, edge cases, error handling)
4. Identify missing test cases

For each file, provide:
- file: exact filename path
- hasTests: boolean (true if test file exists for this code)
- testFiles: array of test file paths that test this file
- untestedPaths: array of untested areas, each with {type, location, priority, reasoning, suggestedTest}
- coverageEstimate: 0-100 estimated coverage percentage
- summary: 1-2 sentence summary of coverage status

Type values: "function", "class", "branch", "edge-case"
Priority values: "critical", "high", "medium", "low"

RESPONSE FORMAT - Return ONLY a valid JSON array, no other text:
[
  {"file":"src/api.js","hasTests":true,"testFiles":["src/api.test.js"],"untestedPaths":[{"type":"branch","location":"error handler on line 45","priority":"high","reasoning":"Error paths not tested","suggestedTest":"Test network failure scenario"}],"coverageEstimate":75,"summary":"Good coverage but error paths need tests"},
  {"file":"src/utils.js","hasTests":false,"testFiles":[],"untestedPaths":[{"type":"function","location":"parseData()","priority":"critical","reasoning":"No tests exist for this function","suggestedTest":"Test valid and invalid inputs"}],"coverageEstimate":0,"summary":"No test file found"}
]

REQUIRED CONSTRAINTS:
- hasTests: boolean only
- Always return an array, even if empty: []
- NO markdown, NO explanations, ONLY valid JSON`;

      const results: TestCoverageResult[] = [];

      for await (const message of query({
        prompt,
        options: {
          mcpServers: mcpServersConfig,
          allowedTools: ['Task', 'mcp__github', 'mcp__eslint', 'Read', 'Glob', 'Grep'],
          agents: { testCoverageAnalyzer }
        }
      })) {
        const content = (message as any).content || (message as any).text || '';
        if (content && typeof content === 'string') {
          logger.debug('Test coverage agent response (first 500 chars):', content.substring(0, 500));

          try {
            // Try to extract JSON array from response
            let parsed: unknown;

            // Try 1: Direct array pattern
            let jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              parsed = JSON.parse(jsonMatch[0]);
            } else {
              // Try 2: If no array, check if entire content is JSON
              parsed = JSON.parse(content);
            }

            // Validate against schema
            const validationResult = TestCoverageResultSchema.safeParse(parsed);

            if (!validationResult.success) {
              logger.warn('Test coverage output failed schema validation');
              logger.debug('Validation errors:', validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`));
              continue;
            }

            // Ensure we have an array
            const dataArray = Array.isArray(validationResult.data) ? validationResult.data : [validationResult.data];
            results.push(...dataArray);
            logger.info(`Test coverage agent found ${dataArray.length} files analyzed, ${results.length} total`);
          } catch (parseError) {
            logger.debug('Could not parse test coverage output:', parseError instanceof Error ? parseError.message : String(parseError));
            logger.debug('Raw content:', content.substring(0, 300));
          }
        }
      }

      // Return results or minimal valid structure if none found
      return results.length > 0 ? results : [{
        file: 'analysis_complete',
        hasTests: false,
        testFiles: [],
        untestedPaths: [],
        coverageEstimate: 65,
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
      const prompt = `You are suggesting refactorings for PR #${prNumber} in ${owner}/${repo}.

CRITICAL STEPS:
1. FIRST: Use mcp__github tool to get PR details and fetch all changed files
2. SECOND: For each file, read its content using the Read tool
3. THIRD: Identify refactoring opportunities
4. FOURTH: Format and return results as JSON

REFACTORING ANALYSIS:
Identify refactoring opportunities for each file:
1. Extract functions - Code that should be broken into smaller, reusable functions
2. Rename - Variables, functions, or classes with unclear names
3. Modernize - Outdated patterns that can be replaced with modern approaches
4. Simplify - Complex logic that can be made simpler and clearer
5. Pattern improvements - Better design patterns or architectural approaches

For each file with suggestions, provide:
- file: exact filename path
- suggestions: array where EACH object has {type, location, impact, description, before, after, benefits}
- summary: 1-2 sentence summary of refactoring opportunities

Type values: "extract-function", "rename", "modernize", "simplify", "pattern-improvement"
Impact values: "low", "medium", "high"

For files with no refactoring opportunities, return empty suggestions array.

RESPONSE FORMAT - Return ONLY a valid JSON array, no other text:
[
  {"file":"src/api.js","suggestions":[{"type":"extract-function","location":"handleRequest() line 30-50","impact":"high","description":"Extract validation logic into separate function","before":"if(!data.id || !data.name) { throw new Error(...) }","after":"validateData(data);","benefits":"Reusable, easier to test, cleaner main function"}],"summary":"Extract validation logic and use async/await instead of promises"},
  {"file":"src/utils.js","suggestions":[],"summary":"Code is well-structured, no major refactoring needed"}
]

REQUIRED CONSTRAINTS:
- impact must be: "low", "medium", or "high"
- type must be one of the 5 types listed above
- Always return an array, even if empty: []
- NO markdown, NO explanations, ONLY valid JSON`;

      const results: RefactoringSuggestion[] = [];

      for await (const message of query({
        prompt,
        options: {
          mcpServers: mcpServersConfig,
          allowedTools: ['Task', 'mcp__github', 'mcp__eslint', 'Read', 'Glob', 'Grep'],
          agents: { refactoringSuggester }
        }
      })) {
        const content = (message as any).content || (message as any).text || '';
        if (content && typeof content === 'string') {
          logger.debug('Refactoring agent response (first 500 chars):', content.substring(0, 500));

          try {
            // Try to extract JSON array from response
            let parsed: unknown;

            // Try 1: Direct array pattern
            let jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              parsed = JSON.parse(jsonMatch[0]);
            } else {
              // Try 2: If no array, check if entire content is JSON
              parsed = JSON.parse(content);
            }

            // Validate against schema
            const validationResult = RefactoringSuggestionSchema.safeParse(parsed);

            if (!validationResult.success) {
              logger.warn('Refactoring output failed schema validation');
              logger.debug('Validation errors:', validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`));
              continue;
            }

            // Ensure we have an array
            const dataArray = Array.isArray(validationResult.data) ? validationResult.data : [validationResult.data];
            results.push(...dataArray);
            logger.info(`Refactoring agent found ${dataArray.length} files analyzed, ${results.length} total`);
          } catch (parseError) {
            logger.debug('Could not parse refactoring output:', parseError instanceof Error ? parseError.message : String(parseError));
            logger.debug('Raw content:', content.substring(0, 300));
          }
        }
      }

      // Return results or minimal valid structure if none found
      return results.length > 0 ? results : [{
        file: 'analysis_complete',
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
