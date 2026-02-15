import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { execWithLog } from '../shared/src/exec.js';

async function createTarball(sourceDir: string, outputPath: string): Promise<void> {
  const parentDir = path.dirname(outputPath);
  await fs.mkdir(parentDir, { recursive: true });
  
  const absoluteOutput = path.resolve(outputPath);
  core.info(`Creating tarball: ${outputPath} from ${sourceDir}`);
  await execWithLog('tar', ['-czf', absoluteOutput, '.'], { cwd: sourceDir });
}

async function calculateSHA256(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function run(): Promise<void> {
  try {
    const lspVersion = core.getInput('lsp-version', { required: true });
    const version = core.getInput('version') || lspVersion;
    const token = core.getInput('github-token', { required: true });
    const isDraft = core.getInput('draft') !== 'false'; // Default true
    const isPrerelease = core.getInput('prerelease') === 'true';
    const body = core.getInput('body') || `Draft release for LSP v${lspVersion}`;

    // Warn if both draft and prerelease are set — prefer prerelease since
    // draft assets are not publicly accessible (return 404 on direct URL)
    if (isDraft && isPrerelease) {
      core.warning('Both draft and prerelease are set. Using prerelease (not draft) since draft assets are not publicly downloadable.');
    }
    
    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    // Create asset file paths
    const tarballName = `stylelint-language-server-v${lspVersion}.tar.gz`;
    const sha256Name = `stylelint-language-server-v${lspVersion}.sha256`;
    
    // Verify lsp/ directory exists
    try {
      await fs.access('lsp');
    } catch {
      throw new Error('lsp/ directory not found. Run build-lsp action first.');
    }

    // Create tarball archive
    core.info('Creating tarball archive...');
    await createTarball('lsp', tarballName);
    
    // Get file size for logging
    const tarballStat = await fs.stat(tarballName);
    core.info(`Tarball created: ${tarballName} (${(tarballStat.size / 1024).toFixed(2)} KB)`);
    
    // Calculate SHA256
    core.info('Calculating SHA256 checksum...');
    const sha256 = await calculateSHA256(tarballName);
    await fs.writeFile(sha256Name, `${sha256}  ${tarballName}\n`);
    core.info(`SHA256: ${sha256}`);

    // Read tarball as Buffer (not string) to preserve binary data integrity.
    // Octokit's uploadReleaseAsset accepts Buffer for binary files.
    const tarballData = await fs.readFile(tarballName);
    const sha256Data = await fs.readFile(sha256Name, 'utf-8');

    // Try to find existing release
    let release;
    try {
      const { data: existingRelease } = await octokit.rest.repos.getReleaseByTag({
        owner,
        repo,
        tag: version
      });
      
      release = existingRelease;
      core.info(`Found existing release: ${release.html_url}`);
      
      // Delete existing assets if present
      for (const assetName of [tarballName, sha256Name]) {
        const existing = release.assets.find(a => a.name === assetName);
        if (existing) {
          core.info(`Deleting existing asset: ${assetName}`);
          await octokit.rest.repos.deleteReleaseAsset({
            owner,
            repo,
            asset_id: existing.id
          });
        }
      }
      
    } catch (error) {
      // Release doesn't exist, create it
      const status = (error as { status?: number }).status;
      if (status === 404) {
        // When prerelease is set, don't create as draft (assets must be public)
        const effectiveDraft = isDraft && !isPrerelease;
        const label = isPrerelease ? 'prerelease' : effectiveDraft ? 'draft ' : '';
        core.info(`Creating new ${label}release v${version}...`);
        const { data: newRelease } = await octokit.rest.repos.createRelease({
          owner,
          repo,
          tag_name: version,
          name: `v${version}`,
          body,
          draft: effectiveDraft,
          prerelease: isPrerelease
        });
        release = newRelease;
      } else {
        throw error;
      }
    }

    // Upload tarball asset
    core.info(`Uploading ${tarballName}...`);
    await octokit.rest.repos.uploadReleaseAsset({
      owner,
      repo,
      release_id: release.id,
      name: tarballName,
      // Buffer is accepted at runtime despite type declaration expecting string
      data: tarballData as unknown as string,
      headers: {
        'content-type': 'application/gzip'
      }
    });

    // Upload SHA256 asset
    core.info(`Uploading ${sha256Name}...`);
    await octokit.rest.repos.uploadReleaseAsset({
      owner,
      repo,
      release_id: release.id,
      name: sha256Name,
      data: sha256Data,
      headers: {
        'content-type': 'text/plain'
      }
    });

    core.setOutput('release-id', release.id.toString());
    core.setOutput('release-url', release.html_url);
    core.setOutput('upload-url', release.upload_url);
    core.info(`✅ Release ready: ${release.html_url}`);

    // Cleanup local files
    core.info('Cleaning up local files...');
    await fs.unlink(tarballName);
    await fs.unlink(sha256Name);
    
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Unknown error');
  }
}

run();
