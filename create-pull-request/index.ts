import * as core from '@actions/core';
import * as github from '@actions/github';
import * as exec from '@actions/exec';

async function run(): Promise<void> {
  try {
    const token = core.getInput('token', { required: true });
    const branch = core.getInput('branch', { required: true });
    const base = core.getInput('base') || 'main';
    const title = core.getInput('title', { required: true });
    const body = core.getInput('body') || '';
    const draft = core.getInput('draft') === 'true';
    const maintainerCanModify = core.getInput('maintainer-can-modify') !== 'false';

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    // Configure git
    core.info('Configuring git...');
    await exec.exec('git', ['config', 'user.name', 'github-actions[bot]']);
    await exec.exec('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com']);

    // Check if branch exists remotely
    core.info(`Checking if branch ${branch} exists...`);
    let branchExists = false;
    try {
      await octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`
      });
      branchExists = true;
      core.info('Branch exists remotely');
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 404) {
        core.info('Branch does not exist remotely');
      } else {
        throw error;
      }
    }

    // Push branch
    if (branchExists) {
      core.info(`Force pushing to existing branch ${branch}...`);
      await exec.exec('git', ['push', 'origin', `HEAD:${branch}`, '--force']);
    } else {
      core.info(`Creating and pushing new branch ${branch}...`);
      await exec.exec('git', ['checkout', '-b', branch]);
      await exec.exec('git', ['push', 'origin', branch]);
    }

    // Check for existing PR
    core.info('Checking for existing PR...');
    const { data: existingPrs } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: 'open',
      head: `${owner}:${branch}`,
      base
    });

    if (existingPrs.length > 0) {
      const existingPr = existingPrs[0];
      core.info(`Found existing PR #${existingPr.number}`);

      // Update the existing PR
      core.info('Updating existing PR...');
      await octokit.rest.pulls.update({
        owner,
        repo,
        pull_number: existingPr.number,
        title,
        body,
        maintainer_can_modify: maintainerCanModify
      });

      core.setOutput('pull-request-number', existingPr.number);
      core.setOutput('pull-request-url', existingPr.html_url);
      core.info(`Updated PR #${existingPr.number}: ${existingPr.html_url}`);
      return;
    }

    // Create new PR
    core.info('Creating new pull request...');
    const { data: pr } = await octokit.rest.pulls.create({
      owner,
      repo,
      title,
      body,
      head: branch,
      base,
      draft,
      maintainer_can_modify: maintainerCanModify
    });

    core.setOutput('pull-request-number', pr.number);
    core.setOutput('pull-request-url', pr.html_url);
    core.info(`Created PR #${pr.number}: ${pr.html_url}`);

    // Request review from repo owner
    try {
      await octokit.rest.pulls.requestReviewers({
        owner,
        repo,
        pull_number: pr.number,
        reviewers: [owner]
      });
      core.info(`Requested review from ${owner}`);
    } catch (error) {
      core.warning(`Failed to request review: ${error}`);
    }

  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Unknown error');
  }
}

run();
