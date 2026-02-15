import { getInput, info, setOutput, setFailed } from '@actions/core';
import { getOctokit, context } from '@actions/github';

async function run(): Promise<void> {
  try {
    const version = getInput('version', { required: true });
    const body = getInput('body') || `Release v${version}`;
    const token = getInput('github-token', { required: true });

    const octokit = getOctokit(token);
    const { owner, repo } = context.repo;

    // Get existing release by tag
    info(`Looking for release with tag: ${version}`);
    const { data: release } = await octokit.rest.repos.getReleaseByTag({
      owner,
      repo,
      tag: version
    });

    info(`Found release: ${release.html_url} (draft: ${release.draft}, prerelease: ${release.prerelease})`);

    // Update release to non-draft, non-prerelease
    info('Promoting to full release...');
    const { data: updatedRelease } = await octokit.rest.repos.updateRelease({
      owner,
      repo,
      release_id: release.id,
      name: `v${version}`,
      body,
      draft: false,
      prerelease: false
    });

    setOutput('release-id', updatedRelease.id.toString());
    setOutput('release-url', updatedRelease.html_url);
    info(`✅ Published release v${version}: ${updatedRelease.html_url}`);

  } catch (error) {
    setFailed(error instanceof Error ? error.message : 'Unknown error');
  }
}

run();
