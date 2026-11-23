import { logger } from './logger';

/**
 * GitHub Client
 * Provides utilities for interacting with GitHub API through MCP
 */
export class GitHubClient {
  /**
   * Post a comment on a GitHub Pull Request
   * This would typically use the GitHub MCP server to make API calls
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @param commentBody - Markdown body of the comment
   * @returns true if successful, false otherwise
   */
  async postPRComment(
    owner: string,
    repo: string,
    prNumber: number,
    commentBody: string
  ): Promise<boolean> {
    try {
      logger.info(`Posting comment to ${owner}/${repo}#${prNumber}`);

      // Check if GitHub token is available
      if (!process.env.GITHUB_TOKEN) {
        logger.warn('GITHUB_TOKEN not set - skipping PR comment. Set GITHUB_TOKEN to enable automated comments.');
        return false;
      }

      // Note: In a real implementation with MCP integration, this would use:
      // const result = await mcpClient.tool('github', 'create_issue_comment', {
      //   owner,
      //   repo,
      //   issue_number: prNumber,
      //   body: commentBody
      // });

      // For now, we'll use the native GitHub API via fetch
      const url = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `token ${process.env.GITHUB_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ body: commentBody })
      });

      if (!response.ok) {
        const errorData = await response.text();
        logger.error(`Failed to post PR comment: ${response.statusText} - ${errorData}`);
        return false;
      }

      logger.info(`Successfully posted comment to ${owner}/${repo}#${prNumber}`);
      return true;
    } catch (error) {
      logger.error('Error posting PR comment:', error);
      return false;
    }
  }

  /**
   * Get Pull Request details
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns PR details or null if fetch fails
   */
  async getPRDetails(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<any | null> {
    try {
      if (!process.env.GITHUB_TOKEN) {
        logger.debug('GITHUB_TOKEN not set - cannot fetch PR details');
        return null;
      }

      const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `token ${process.env.GITHUB_TOKEN}`
        }
      });

      if (!response.ok) {
        logger.error(`Failed to fetch PR details: ${response.statusText}`);
        return null;
      }

      return await response.json();
    } catch (error) {
      logger.error('Error fetching PR details:', error);
      return null;
    }
  }
}

// Export singleton instance
export const githubClient = new GitHubClient();
