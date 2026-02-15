import { getInput, setOutput, setFailed, info, warning } from '@actions/core';
import { getOctokit, context } from '@actions/github';
import { exec } from '@actions/exec';
import { findOpenLspUpdatePr, type Octokit } from '../shared/src/github.js';

async function run(): Promise<void> {
  try {
    const token = getInput('github-token', { required: true });
    const octokit: Octokit = getOctokit(token);
    const { owner, repo } = context.repo;

    // Configure git first (before any operations)
    info('Configuring git...');
    await exec('git', ['config', 'user.name', 'github-actions[bot]']);
    await exec('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com']);

    // Fetch main branch
    info('Fetching main branch...');
    await exec('git', ['fetch', 'origin', 'main']);

    // Find open LSP update PR
    info('Looking for open LSP update PR...');
    const pr = await findOpenLspUpdatePr(octokit, owner, repo);

    if (!pr) {
      info('No open LSP update PR found');
      setOutput('found', 'false');
      setOutput('rebased', 'false');
      return;
    }

    info(`Found PR #${pr.number} on branch ${pr.branch} (head: ${pr.headSha})`);
    setOutput('found', 'true');
    setOutput('pr-number', pr.number.toString());
    setOutput('branch', pr.branch);

    // Check if rebase is needed by comparing merge bases
    info('Checking if rebase is needed...');
    
    // Get the current HEAD of main
    let mainHead = '';
    await exec('git', ['rev-parse', 'origin/main'], {
      listeners: {
        stdout: (data: Buffer) => { mainHead += data.toString(); }
      }
    });
    mainHead = mainHead.trim();

    // Get the merge base between PR branch and main
    let mergeBase = '';
    await exec('git', ['merge-base', pr.headSha, mainHead], {
      listeners: {
        stdout: (data: Buffer) => { mergeBase += data.toString(); }
      }
    });
    mergeBase = mergeBase.trim();

    if (mergeBase === mainHead) {
      info('PR branch is already up to date with main - no rebase needed');
      setOutput('rebased', 'false');
      return;
    }

    info(`Rebase needed: PR base ${mergeBase} != main ${mainHead}`);

    // Perform rebase
    info(`Rebasing branch ${pr.branch} onto main...`);
    const rebaseExitCode = await exec('git', ['rebase', 'origin/main', pr.headSha], {
      ignoreReturnCode: true
    });

    if (rebaseExitCode !== 0) {
      // Rebase failed - abort and report
      info('Rebase failed - aborting...');
      await exec('git', ['rebase', '--abort'], { ignoreReturnCode: true });
      const errorMsg = 'Rebase failed due to conflicts — manual intervention needed';
      warning(errorMsg);
      setOutput('rebased', 'false');
      setOutput('error', errorMsg);
      return;
    }

    // Push rebased branch
    info('Pushing rebased branch...');
    const pushExitCode = await exec('git', ['push', '--force-with-lease', 'origin', `HEAD:${pr.branch}`], {
      ignoreReturnCode: true
    });

    if (pushExitCode !== 0) {
      const errorMsg = 'Failed to push rebased branch - branch may have been updated';
      warning(errorMsg);
      setOutput('rebased', 'false');
      setOutput('error', errorMsg);
      return;
    }

    info(`✅ Successfully rebased PR #${pr.number} and pushed to ${pr.branch}`);
    setOutput('rebased', 'true');
    setOutput('error', '');

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    setFailed(errorMsg);
    setOutput('rebased', 'false');
    setOutput('error', errorMsg);
  }
}

run();
