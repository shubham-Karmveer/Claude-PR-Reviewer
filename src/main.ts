import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import ora from 'ora';
import { CodeReviewOrchestrator, ProgressEvent } from './orchestrator';
import { ReportGenerator } from './utils/report-generator';
import { logger } from './utils/logger';

// Load environment variables
dotenv.config();

/**
 * Main entry point for the Claude Multi-Agent Code Review System
 * Usage: npm run dev <owner> <repo> <pr-number>
 */
async function main() {
  const [owner, repo, prStr] = process.argv.slice(2);

  // Validate command line arguments
  if (!owner || !repo || !prStr) {
    console.error('Usage: npm run dev <owner> <repo> <pr-number>');
    console.error('Example: npm run dev facebook react 12345');
    process.exit(1);
  }

  const prNumber = parseInt(prStr, 10);
  if (isNaN(prNumber) || prNumber <= 0) {
    console.error('Error: PR number must be a positive integer');
    process.exit(1);
  }

  // Validate authentication
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const hasAwsCredentials =
    !!process.env.AWS_ACCESS_KEY_ID && !!process.env.AWS_SECRET_ACCESS_KEY;

  if (!hasAnthropicKey && !hasAwsCredentials) {
    console.error('Error: No authentication method configured');
    console.error('Please set ONE of the following:');
    console.error('  1. ANTHROPIC_API_KEY for Anthropic API');
    console.error('  2. AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY for AWS Bedrock');
    process.exit(1);
  }

  if (hasAwsCredentials) {
    if (!process.env.AWS_REGION) {
      console.error('Error: AWS_REGION is required for Bedrock authentication');
      process.exit(1);
    }
    logger.info('Using AWS Bedrock authentication');
  } else {
    logger.info('Using Anthropic API authentication');
  }

  // Validate ANTHROPIC_MODEL
  if (!process.env.ANTHROPIC_MODEL) {
    console.error('Error: ANTHROPIC_MODEL environment variable is required');
    console.error('Examples:');
    console.error('  - For Anthropic API: claude-sonnet-4-5-20250929');
    console.error('  - For AWS Bedrock: us.anthropic.claude-sonnet-4-5-20250929-v1:0');
    process.exit(1);
  }

  try {
    // Create orchestrator and run review with progress tracking
    logger.info(`Starting code review for ${owner}/${repo}#${prNumber}`);
    const orchestrator = new CodeReviewOrchestrator({ enablePRComment: true });

    // Set up progress tracking with ora spinners
    const agentSpinners = new Map<string, ReturnType<typeof ora>>();
    const agents = ['Code Quality Analyzer', 'Test Coverage Analyzer', 'Refactoring Suggester'];
    let prCommentPosted = false;

    // Listen to progress events
    orchestrator.on('progress', (event: ProgressEvent) => {
      switch (event.type) {
        case 'agent_start':
          if (event.agent && !agentSpinners.has(event.agent)) {
            const spinner = ora(`${event.agent}: Analyzing...`).start();
            agentSpinners.set(event.agent, spinner);
          }
          break;

        case 'agent_complete':
          if (event.agent && agentSpinners.has(event.agent)) {
            const spinner = agentSpinners.get(event.agent)!;
            spinner.succeed(`${event.agent}: Complete ✓`);
            agentSpinners.delete(event.agent);
          }
          break;

        case 'pr_comment_posted':
          if (!prCommentPosted) {
            prCommentPosted = true;
            console.log('\n📝 Review summary posted to PR comment\n');
          }
          break;
      }
    });

    const report = await orchestrator.reviewPullRequest(owner, repo, prNumber);

    // Clean up any remaining spinners
    agentSpinners.forEach((spinner) => {
      spinner.stop();
    });

    // Generate reports
    const reportDir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const reportName = `${owner}-${repo}-pr-${prNumber}`;
    const generator = new ReportGenerator();

    // Generate Markdown report
    const mdReport = generator.generateMarkdownReport(report);
    const mdPath = path.join(reportDir, `${reportName}.md`);
    fs.writeFileSync(mdPath, mdReport);
    logger.info(`Markdown report saved to: ${mdPath}`);

    // Generate HTML report
    const htmlReport = generator.generateHTMLReport(report);
    const htmlPath = path.join(reportDir, `${reportName}.html`);
    fs.writeFileSync(htmlPath, htmlReport);
    logger.info(`HTML report saved to: ${htmlPath}`);

    // Generate JSON report
    const jsonReport = generator.generateJSONReport(report);
    const jsonPath = path.join(reportDir, `${reportName}.json`);
    fs.writeFileSync(jsonPath, jsonReport);
    logger.info(`JSON report saved to: ${jsonPath}`);

    logger.info('Code review complete');
    console.log(`\n✨ Code review complete!\n`);
    console.log(`📊 Reports generated in ${reportDir}\n`);
    console.log(`📄 Report Files:`);
    console.log(`  - Markdown: ${mdPath}`);
    console.log(`  - HTML: ${htmlPath}`);
    console.log(`  - JSON: ${jsonPath}\n`);
  } catch (error) {
    logger.error('Code review failed:', error);
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
