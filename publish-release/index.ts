import { getInput, info, setOutput, setFailed } from '@actions/core';
import { getOctokit, context } from '@actions/github';
import { readFile, writeFile, rm } from 'fs/promises';
import { execSync } from 'child_process';
import { readExtensionToml, getLspVersion } from '../shared/src/toml.js';
import { buildLsp } from '../shared/src/lsp.js';

interface Prerelease {
  id: number;
  tag: string;
}

async function findPrerelease(octokit: ReturnType<typeof getOctokit>, owner: string, repo: string, version: string): Promise<Prerelease | null> {
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

  info(`✅ Promoted release v${version}: ${release.html_url}`);
  return { id: release.id, url: release.html_url };
}

async function createReleaseFromScratch(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  version: string,
  lspVersion: string,
  body: string
): Promise<{ id: number; url: string }> {
  // Build LSP
  await buildLsp(lspVersion);

  // Create tarball
  const tarName = `stylelint-language-server-v${lspVersion}.tar.gz`;
  info(`Creating ${tarName}...`);
  execSync(`tar -czf "${tarName}" lsp/`);

  // Create SHA256
  const shaName = `stylelint-language-server-v${lspVersion}.sha256`;
  info(`Creating ${shaName}...`);
  const shaOutput = execSync(`sha256sum "${tarName}"`).toString();
  await writeFile(shaName, shaOutput);

  // Create release
  info(`Creating release v${version}...`);
  const { data: release } = await octokit.rest.repos.createRelease({
    owner,
    repo,
    tag_name: version,
    name: `v${version}`,
    body,
    draft: false,
    prerelease: false
  });
  info(`Created release: ${release.html_url}`);

  // Upload assets
  info(`Uploading ${tarName}...`);
  const tarData = await readFile(tarName);
  await octokit.rest.repos.uploadReleaseAsset({
    owner,
    repo,
    release_id: release.id,
    name: tarName,
    data: tarData as unknown as string,
    headers: { 'content-type': 'application/gzip' }
  });

  info(`Uploading ${shaName}...`);
  const shaData = await readFile(shaName, 'utf-8');
  await octokit.rest.repos.uploadReleaseAsset({
    owner,
    repo,
    release_id: release.id,
    name: shaName,
    data: shaData,
    headers: { 'content-type': 'text/plain' }
  });

  // Cleanup
  await rm(tarName, { force: true });
  await rm(shaName, { force: true });
  await rm('lsp', { recursive: true, force: true });

  info(`✅ Release v${version} complete`);
  return { id: release.id, url: release.html_url };
}

async function verifyLspUpdateCommit(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  sha: string
): Promise<{ isValid: boolean; message: string }> {
  info(`Verifying commit ${sha}...`);

  const { data: commit } = await octokit.rest.repos.getCommit({
    owner,
    repo,
    ref: sha
  });

  const author = commit.commit.author?.name;
  const message = commit.commit.message;

  info(`Commit author: ${author}`);
  info(`Commit message: ${message.split('\n')[0]}`);

  // Check author
  if (author !== 'github-actions[bot]') {
    return {
      isValid: false,
      message: `Skipping: Commit author is '${author}', expected 'github-actions[bot]'`
    };
  }

  // Check message pattern
  if (!message.startsWith('chore: update language server to')) {
    return {
      isValid: false,
      message: `Skipping: Commit message doesn't match LSP update pattern`
    };
  }

  return { isValid: true, message: 'Commit verified as LSP update' };
}

async function run(): Promise<void> {
  try {
    const token = getInput('github-token', { required: true });
    const octokit = getOctokit(token);
    const { owner, repo } = context.repo;

    // Get the commit SHA from context
    const sha = context.sha;

    // Verify this is an LSP update commit
    const verification = await verifyLspUpdateCommit(octokit, owner, repo, sha);

    if (!verification.isValid) {
      info(verification.message);
      setOutput('skipped', 'true');
      setOutput('reason', verification.message);
      return;
    }

    info(verification.message);

    // Read versions from extension.toml
    const extensionToml = await readExtensionToml();
    const version = extensionToml.version;
    const lspVersion = getLspVersion(extensionToml);

    info(`Extension version: ${version}`);
    info(`LSP version: ${lspVersion}`);

    // Check for existing prerelease
    const prerelease = await findPrerelease(octokit, owner, repo, version);

    if (!prerelease) {
      info(`No prerelease found for v${version}. Skipping promotion.`);
      setOutput('skipped', 'true');
      setOutput('reason', 'No prerelease found for this version');
      return;
    }

    // Get release body from CHANGELOG.md
    const body = await getReleaseBody(version);

    // Promote the prerelease
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
