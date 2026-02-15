import * as core from '@actions/core';
import * as github from '@actions/github';
import { readExtensionToml } from '../shared/src/toml.js';
import { getLatestLspRelease, findOpenLspUpdatePr } from '../shared/src/github.js';

async function run(): Promise<void> {
  try {
    const token = core.getInput('github-token', { required: true });
    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    // Read current version from extension.toml
    core.info('Reading current LSP version from extension.toml...');
    const toml = await readExtensionToml();
    const currentVersion = toml.language_servers?.['stylelint-lsp']?.lsp_required_version || '';
    core.info(`Current LSP version: ${currentVersion || 'not set'}`);

    // Get latest release from vscode-stylelint
    core.info('Fetching latest vscode-stylelint release...');
    const latestRelease = await getLatestLspRelease(octokit);
    core.info(`Latest LSP version: ${latestRelease.version}`);

    // Set outputs
    core.setOutput('latest-version', latestRelease.version);
    core.setOutput('current-version', currentVersion);
    core.setOutput('changelog', latestRelease.body);

    // Check for existing PR first (sequential approach)
    core.info('Checking for existing LSP update PRs...');
    const existingPr = await findOpenLspUpdatePr(octokit, owner, repo);
    core.setOutput('existing-pr', existingPr?.toString() || '');

    if (existingPr) {
      core.info(`Found existing LSP update PR #${existingPr} - skipping new update`);
      core.setOutput('update-needed', 'false');
      return;
    }

    // Check if update needed
    const updateNeeded = latestRelease.version !== currentVersion;
    core.setOutput('update-needed', updateNeeded.toString());

    if (updateNeeded) {
      core.info(`Update needed: ${currentVersion} -> ${latestRelease.version}`);
    } else {
      core.info('Already up to date');
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Unknown error');
  }
}

run();
