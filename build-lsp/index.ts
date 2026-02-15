import { getInput, info, setOutput, setFailed } from '@actions/core';
import { execWithLog, getExecOutput } from '../shared/src/exec.js';
import { buildLsp } from '../shared/src/lsp.js';

async function run(): Promise<void> {
  try {
    const version = getInput('version', { required: true });
    const gitUserName = getInput('git-user-name');
    const gitUserEmail = getInput('git-user-email');

    const { lspPath } = await buildLsp(version);

    // Configure git for commit
    info('Configuring git...');
    await execWithLog('git', ['config', 'user.name', gitUserName]);
    await execWithLog('git', ['config', 'user.email', gitUserEmail]);

    // Stage the changes
    info('Staging changes...');
    await execWithLog('git', ['add', lspPath]);

    // Check if there are changes to commit
    const gitStatus = await getExecOutput('git', ['status', '--porcelain', lspPath]);

    if (!gitStatus) {
      info('No changes to commit (LSP files identical)');
      setOutput('committed', 'false');
    } else {
      info('Committing changes...');
      await execWithLog('git', [
        'commit',
        '-m', `chore: update language server to v${version}`,
        '-m', `Update vscode-stylelint language server to v${version}`,
        '-m', 'Built from https://github.com/stylelint/vscode-stylelint'
      ]);
      info('Successfully committed LSP changes');
      setOutput('committed', 'true');
    }

    setOutput('lsp-path', lspPath);

  } catch (error) {
    setFailed(error instanceof Error ? error.message : 'Unknown error');
  }
}

run();
