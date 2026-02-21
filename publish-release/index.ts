import { getInput, info, setOutput, setFailed } from '@actions/core';
import { getOctokit, context } from '@actions/github';
import { readFile } from 'fs/promises';
import { readExtensionToml, getLspVersion } from '../shared/src/toml.js';

interface Prerelease {
  id: number;
  tag: string;
}

async function findPrerelease(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  version: string
): Promise<Prerelease | null> {
  info(`Looking for prerelease with tag: ${version}`);

  const { data: releases } = await octokit.rest.repos.listReleases({
    owner,
    repo,
    per_page: 100
  });

  const release = releases.find(r => (r.prerelease || r.draft) && r.tag_name === version);

  if (!release) {
    info(`No prerelease/draft found for ${version}`);
    return null;
  }

  info(`Found ${release.prerelease ? 'prerelease' : 'draft'}: ${release.html_url}`);
  return { id: release.id, tag: release.tag_name };
}

async function getReleaseBody(version: string): Promise<string> {
  try {
    const changelog = await readFile('CHANGELOG.md', 'utf-8');
    const lines = changelog.split('\n');
    const bodyLines: string[] = [];
    let inSection = false;

    for (const line of lines) {
      if (/^## \[?v?/.test(line)) {
        if (inSection) break;
        inSection = true;
        continue;
      }
      if (inSection) {
        bodyLines.push(line);
        if (bodyLines.length >= 20) break;
      }
    }

    return bodyLines.join('\n').trim() || `Release v${version}`;
  } catch {
    return `Release v${version}`;
  }
}

async function promotePrerelease(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  releaseId: number,
  version: string,
  body: string
): Promise<{ id: number; url: string }> {
  info('Promoting to full release...');

  const { data: release } = await octokit.rest.repos.updateRelease({
    owner,
    repo,
    release_id: releaseId,
    name: `v${version}`,
    body,
    draft: false,
    prerelease: false
  });

  info(`Promoted release v${version}: ${release.html_url}`);
  return { id: release.id, url: release.html_url };
}

function isUpdateLspBranch(branchName: string | undefined): boolean {
  if (!branchName) return false;
  return /^update-lsp-/.test(branchName);
}

async function run(): Promise<void> {
  try {
    const token = getInput('github-token', { required: true });
    const octokit = getOctokit(token);
    const { owner, repo } = context.repo;

    const eventName = context.eventName;

    if (eventName === 'pull_request') {
      const pr = context.payload.pull_request;
      
      if (!pr?.merged) {
        info('PR was not merged, skipping');
        setOutput('skipped', 'true');
        setOutput('reason', 'PR was not merged');
        return;
      }

      const headBranch = pr.head?.ref as string | undefined;
      
      if (!isUpdateLspBranch(headBranch)) {
        info(`PR branch '${headBranch}' is not an update-lsp-* branch, skipping`);
        setOutput('skipped', 'true');
        setOutput('reason', `Not an update-lsp-* branch: ${headBranch}`);
        return;
      }

      info(`PR merged from update-lsp branch: ${headBranch}`);
    } else if (eventName === 'workflow_dispatch') {
      info('Manual trigger - will attempt to promote any existing prerelease');
    } else {
      info(`Event '${eventName}' is not supported, skipping`);
      setOutput('skipped', 'true');
      setOutput('reason', `Unsupported event: ${eventName}`);
      return;
    }

    const extensionToml = await readExtensionToml();
    const version = extensionToml.version;
    const lspVersion = getLspVersion(extensionToml);

    info(`Extension version: ${version}`);
    info(`LSP version: ${lspVersion}`);

    const prerelease = await findPrerelease(octokit, owner, repo, version);

    if (!prerelease) {
      info(`No prerelease found for v${version}. Skipping promotion.`);
      setOutput('skipped', 'true');
      setOutput('reason', 'No prerelease found for this version');
      return;
    }

    const body = await getReleaseBody(version);

    const result = await promotePrerelease(octokit, owner, repo, prerelease.id, version, body);

    setOutput('skipped', 'false');
    setOutput('promoted', 'true');
    setOutput('release-id', result.id.toString());
    setOutput('release-url', result.url);

  } catch (error) {
    setFailed(error instanceof Error ? error.message : 'Unknown error');
  }
}

run();
