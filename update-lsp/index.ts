import { getInput, info, setOutput, setFailed } from '@actions/core';
import { getOctokit, context } from '@actions/github';
import { exec } from '@actions/exec';
import { readFile, writeFile, access } from 'fs/promises';
import { createHash } from 'crypto';
import { readExtensionToml, getLspVersion } from '../shared/src/toml.js';
import { getLatestLspRelease, findOpenLspUpdatePr } from '../shared/src/github.js';
import { buildLsp } from '../shared/src/lsp.js';
import { execWithLog } from '../shared/src/exec.js';

interface UpdateResult {
  version: string;
  changelog: string;
  prNumber: number;
  prUrl: string;
  releaseUrl: string;
}

async function checkForUpdate(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  manualVersion?: string
): Promise<{ needed: boolean; version: string; changelog: string } | null> {
  // Check for existing PR first
  info('Checking for existing LSP update PRs...');
  const existingPr = await findOpenLspUpdatePr(octokit, owner, repo);
  if (existingPr) {
    info(`Found existing LSP update PR #${existingPr} - skipping`);
    return null;
  }

  if (manualVersion) {
    info(`Using manual version: ${manualVersion}`);
    return {
      needed: true,
      version: manualVersion,
      changelog: `Manual update to v${manualVersion}`
    };
  }

  // Read current version
  const toml = await readExtensionToml();
  const currentVersion = getLspVersion(toml);
  info(`Current LSP version: ${currentVersion}`);

  // Get latest release
  info('Fetching latest vscode-stylelint release...');
  const latest = await getLatestLspRelease(octokit);
  info(`Latest LSP version: ${latest.version}`);

  if (latest.version === currentVersion) {
    info('Already up to date');
    return { needed: false, version: currentVersion, changelog: '' };
  }

  info(`Update available: ${currentVersion} -> ${latest.version}`);
  return {
    needed: true,
    version: latest.version,
    changelog: latest.body
  };
}

async function updateVersionFiles(version: string): Promise<void> {
  info(`Updating version files to ${version}...`);

  // Update extension.toml
  let extensionToml = await readFile('extension.toml', 'utf-8');
  extensionToml = extensionToml.replace(
    /^(lsp_required_version\s*=\s*)"[^"]*"/m,
    `$1"${version}"`
  );
  extensionToml = extensionToml.replace(
    /^(version\s*=\s*)"[^"]*"/m,
    `$1"${version}"`
  );
  await writeFile('extension.toml', extensionToml);
  info('Updated extension.toml');

  // Update Cargo.toml
  let cargoToml = await readFile('Cargo.toml', 'utf-8');
  cargoToml = cargoToml.replace(
    /^(version\s*=\s*)"[^"]*"/m,
    `$1"${version}"`
  );
  await writeFile('Cargo.toml', cargoToml);
  info('Updated Cargo.toml');

  // Update config.rs if it exists
  try {
    await access('src/config.rs');
    let configRs = await readFile('src/config.rs', 'utf-8');
    configRs = configRs.replace(
      /const EXTENSION_VERSION: &str = "[^"]*"/,
      `const EXTENSION_VERSION: &str = "${version}"`
    );
    configRs = configRs.replace(
      /const LSP_VERSION: &str = "[^"]*"/,
      `const LSP_VERSION: &str = "${version}"`
    );
    await writeFile('src/config.rs', configRs);
    info('Updated src/config.rs');
  } catch {
    // config.rs doesn't exist, skip
  }
}

async function commitChanges(version: string): Promise<boolean> {
  info('Configuring git...');
  await exec('git', ['config', 'user.name', 'github-actions[bot]']);
  await exec('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com']);

  info('Staging changes...');
  await exec('git', ['add', 'extension.toml', 'Cargo.toml', 'Cargo.lock', 'src/config.rs', 'lsp/'], { ignoreReturnCode: true });

  // Check if there are changes
  const exitCode = await exec('git', ['diff', '--cached', '--quiet'], { ignoreReturnCode: true });

  if (exitCode === 0) {
    info('No changes to commit');
    return false;
  }

  info('Committing changes...');
  await exec('git', ['commit', '-m', `chore: update language server to v${version}`]);
  return true;
}

async function createPrerelease(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  version: string
): Promise<{ id: number; url: string }> {
  const tarballName = `stylelint-language-server-v${version}.tar.gz`;
  const sha256Name = `stylelint-language-server-v${version}.sha256`;

  // Create tarball
  info(`Creating ${tarballName}...`);
  await execWithLog('tar', ['-czf', tarballName, 'lsp/']);

  // Calculate SHA256
  const tarData = await readFile(tarballName);
  const sha256 = createHash('sha256').update(tarData).digest('hex');
  await writeFile(sha256Name, `${sha256}  ${tarballName}\n`);
  info(`SHA256: ${sha256}`);

  // Create prerelease
  info(`Creating prerelease v${version}...`);
  const { data: release } = await octokit.rest.repos.createRelease({
    owner,
    repo,
    tag_name: version,
    name: `v${version}`,
    body: `Prerelease for LSP v${version}\n\nThis is a prerelease created for testing. It will be promoted to a full release when the update PR is merged.`,
    draft: false,
    prerelease: true
  });

  // Upload assets
  info(`Uploading ${tarballName}...`);
  await octokit.rest.repos.uploadReleaseAsset({
    owner,
    repo,
    release_id: release.id,
    name: tarballName,
    data: tarData as unknown as string,
    headers: { 'content-type': 'application/gzip' }
  });

  const sha256Data = await readFile(sha256Name, 'utf-8');
  info(`Uploading ${sha256Name}...`);
  await octokit.rest.repos.uploadReleaseAsset({
    owner,
    repo,
    release_id: release.id,
    name: sha256Name,
    data: sha256Data,
    headers: { 'content-type': 'text/plain' }
  });

  // Cleanup
  await execWithLog('rm', ['-f', tarballName, sha256Name]);

  info(`✅ Prerelease ready: ${release.html_url}`);
  return { id: release.id, url: release.html_url };
}

async function createPullRequest(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  version: string,
  changelog: string,
  releaseUrl: string
): Promise<{ number: number; url: string }> {
  const branch = `update-lsp-${version}`;

  // Check if branch exists
  let branchExists = false;
  try {
    await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    branchExists = true;
  } catch {
    // Branch doesn't exist
  }

  // Push branch
  if (branchExists) {
    info(`Force pushing to existing branch ${branch}...`);
    await exec('git', ['push', 'origin', `HEAD:${branch}`, '--force']);
  } else {
    info(`Creating and pushing new branch ${branch}...`);
    await exec('git', ['checkout', '-b', branch]);
    await exec('git', ['push', 'origin', branch]);
  }

  const body = `## Update Language Server to v${version}

Updates the vscode-stylelint language server to v${version}.

### Changes from upstream

${changelog}

### Prerelease

A [prerelease](${releaseUrl}) has been created with the LSP assets attached.
You can test the extension by installing it from this prerelease.

---
*This PR was automatically created by the Update LSP workflow.*`;

  // Check for existing PR
  const { data: existingPrs } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: 'open',
    head: `${owner}:${branch}`,
    base: 'main'
  });

  if (existingPrs.length > 0) {
    const pr = existingPrs[0];
    info(`Updating existing PR #${pr.number}...`);
    await octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: pr.number,
      title: `chore: update language server to v${version}`,
      body
    });
    return { number: pr.number, url: pr.html_url };
  }

  // Create new PR
  info('Creating pull request...');
  const { data: pr } = await octokit.rest.pulls.create({
    owner,
    repo,
    title: `chore: update language server to v${version}`,
    body,
    head: branch,
    base: 'main'
  });

  info(`✅ Created PR #${pr.number}: ${pr.html_url}`);
  return { number: pr.number, url: pr.html_url };
}

async function run(): Promise<void> {
  try {
    const token = getInput('github-token', { required: true });
    const manualVersion = getInput('version') || undefined;

    const octokit = getOctokit(token);
    const { owner, repo } = context.repo;

    // Check if update is needed
    const check = await checkForUpdate(octokit, owner, repo, manualVersion);

    if (!check) {
      // Existing PR found
      setOutput('updated', 'false');
      return;
    }

    if (!check.needed) {
      info('No update needed');
      setOutput('updated', 'false');
      setOutput('version', check.version);
      return;
    }

    const version = check.version;
    info(`Updating to v${version}...`);

    // Build LSP
    await buildLsp(version);

    // Update version files
    await updateVersionFiles(version);

    // Commit changes
    await commitChanges(version);

    // Create prerelease
    const release = await createPrerelease(octokit, owner, repo, version);

    // Create PR
    const pr = await createPullRequest(octokit, owner, repo, version, check.changelog, release.url);

    setOutput('updated', 'true');
    setOutput('version', version);
    setOutput('pr-number', pr.number.toString());
    setOutput('pr-url', pr.url);
    setOutput('release-url', release.url);

    info(`✅ Update complete: PR #${pr.number}`);

  } catch (error) {
    setFailed(error instanceof Error ? error.message : 'Unknown error');
  }
}

run();
