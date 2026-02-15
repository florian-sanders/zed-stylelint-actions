import * as core from '@actions/core';
import * as io from '@actions/io';
import * as exec from '@actions/exec';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execWithLog, getExecOutput } from '../shared/src/exec.js';

async function run(): Promise<void> {
  try {
    const version = core.getInput('version', { required: true });
    const gitUserName = core.getInput('git-user-name');
    const gitUserEmail = core.getInput('git-user-email');
    const tag = version;
    
    core.info(`Building LSP version ${version} (${tag})`);
    
    // Create temp directory for build
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-stylelint-'));
    core.info(`Build directory: ${tempDir}`);

    try {
      // Clone vscode-stylelint at specific tag
      core.info('Cloning vscode-stylelint repository...');
      await execWithLog('git', [
        'clone',
        '--depth', '1',
        '--branch', tag,
        'https://github.com/stylelint/vscode-stylelint.git',
        tempDir
      ]);

      // Verify package.json exists
      const packageJsonPath = path.join(tempDir, 'package.json');
      try {
        await fs.access(packageJsonPath);
      } catch {
        throw new Error(`package.json not found in cloned repository at ${tag}`);
      }

      // Install dependencies
      core.info('Installing npm dependencies...');
      await execWithLog('npm', ['ci'], { 
        cwd: tempDir,
        env: {
          ...process.env,
          // Prevent npm from writing to ~/.npm for faster CI
          npm_config_cache: path.join(tempDir, '.npm-cache')
        }
      });

      // Build the language server bundle
      core.info('Building language server bundle...');
      await execWithLog('npm', ['run', 'build-bundle'], { cwd: tempDir });

      // Verify dist directory was created
      const distPath = path.join(tempDir, 'dist');
      try {
        const distStat = await fs.stat(distPath);
        if (!distStat.isDirectory()) {
          throw new Error('dist is not a directory');
        }
      } catch {
        throw new Error(`dist directory not found after build at ${distPath}`);
      }

      // List dist contents for debugging
      const distFiles = await fs.readdir(distPath);
      core.info(`Built files in dist/: ${distFiles.join(', ')}`);

      // Clean existing lsp/ directory
      const lspPath = 'lsp';
      core.info(`Cleaning ${lspPath}/ directory...`);
      await io.rmRF(lspPath);

      // Copy dist to lsp/
      core.info(`Copying built files to ${lspPath}/...`);
      await io.cp(distPath, lspPath, { recursive: true, force: true });

      // Verify copy succeeded
      const lspFiles = await fs.readdir(lspPath);
      core.info(`Files in ${lspPath}/: ${lspFiles.join(', ')}`);

      if (lspFiles.length === 0) {
        throw new Error(`No files copied to ${lspPath}/`);
      }

      // Configure git for commit
      core.info('Configuring git...');
      await execWithLog('git', ['config', 'user.name', gitUserName]);
      await execWithLog('git', ['config', 'user.email', gitUserEmail]);

      // Stage the changes
      core.info('Staging changes...');
      await execWithLog('git', ['add', lspPath]);
      
      // Check if there are changes to commit
      const gitStatus = await getExecOutput('git', ['status', '--porcelain', lspPath]);
      
      if (!gitStatus) {
        core.info('No changes to commit (LSP files identical)');
        core.setOutput('committed', 'false');
      } else {
        // Commit the changes
        core.info('Committing changes...');
        await execWithLog('git', [
          'commit',
          '-m', `chore: update language server to v${version}`,
          '-m', `Update vscode-stylelint language server to v${version}`,
          '-m', 'Built from https://github.com/stylelint/vscode-stylelint'
        ]);
        core.info('Successfully committed LSP changes');
        core.setOutput('committed', 'true');
      }

      core.setOutput('lsp-path', lspPath);

    } finally {
      // Cleanup temp directory
      core.info('Cleaning up build directory...');
      await io.rmRF(tempDir);
    }

  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Unknown error');
  }
}

run();
