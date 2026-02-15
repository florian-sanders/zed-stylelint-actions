import { getInput, info, setOutput, setFailed } from '@actions/core';
import { getOctokit, context } from '@actions/github';
import { readFile } from 'fs/promises';

async function run(): Promise<void> {
  try {
    const version = getInput('version', { required: true });
    const lspVersion = getInput('lsp-version', { required: true });
    const body = getInput('body') || `Release v${version}`;
    const token = getInput('github-token', { required: true });

    const octokit = getOctokit(token);
    const { owner, repo } = context.repo;

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

    // Upload LSP tarball
    const tarName = `stylelint-language-server-v${lspVersion}.tar.gz`;
    info(`Uploading ${tarName}...`);
    const tarData = await readFile(tarName);
    await octokit.rest.repos.uploadReleaseAsset({
      owner,
      repo,
      release_id: release.id,
      name: tarName,
      // Buffer is accepted at runtime despite type declaration expecting string
      data: tarData as unknown as string,
      headers: {
        'content-type': 'application/gzip'
      }
    });
    info(`Uploaded ${tarName}`);

    // Upload SHA256
    const shaName = `stylelint-language-server-v${lspVersion}.sha256`;
    info(`Uploading ${shaName}...`);
    const shaData = await readFile(shaName, 'utf-8');
    await octokit.rest.repos.uploadReleaseAsset({
      owner,
      repo,
      release_id: release.id,
      name: shaName,
      data: shaData,
      headers: {
        'content-type': 'text/plain'
      }
    });
    info(`Uploaded ${shaName}`);

    setOutput('release-id', release.id.toString());
    setOutput('release-url', release.html_url);
    info(`✅ Release v${version} complete`);

  } catch (error) {
    setFailed(error instanceof Error ? error.message : 'Unknown error');
  }
}

run();
