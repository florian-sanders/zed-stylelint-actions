import { info } from '@actions/core';
import { rmRF, cp } from '@actions/io';
import { readdir, mkdtemp, access, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execWithLog } from './exec.js';

export interface BuildLspResult {
  lspPath: string;
  files: string[];
}

/**
 * Build the LSP from vscode-stylelint source.
 * Downloads, builds, and copies the language server to the specified output path.
 */
export async function buildLsp(version: string, outputPath = 'lsp'): Promise<BuildLspResult> {
  const tag = version;
  info(`Building LSP version ${version} (${tag})`);

  const tempDir = await mkdtemp(join(tmpdir(), 'vscode-stylelint-'));
  info(`Build directory: ${tempDir}`);

  try {
    info('Cloning vscode-stylelint repository...');
    await execWithLog('git', [
      'clone',
      '--depth', '1',
      '--branch', tag,
      'https://github.com/stylelint/vscode-stylelint.git',
      tempDir
    ]);

    const packageJsonPath = join(tempDir, 'package.json');
    try {
      await access(packageJsonPath);
    } catch {
      throw new Error(`package.json not found in cloned repository at ${tag}`);
    }

    info('Installing npm dependencies...');
    await execWithLog('npm', ['ci'], {
      cwd: tempDir,
      env: {
        ...process.env,
        npm_config_cache: join(tempDir, '.npm-cache')
      }
    });

    info('Building language server bundle...');
    await execWithLog('npm', ['run', 'build-bundle'], { cwd: tempDir });

    const distPath = join(tempDir, 'dist');
    try {
      const distStat = await stat(distPath);
      if (!distStat.isDirectory()) {
        throw new Error('dist is not a directory');
      }
    } catch {
      throw new Error(`dist directory not found after build at ${distPath}`);
    }

    const distFiles = await readdir(distPath);
    info(`Built files in dist/: ${distFiles.join(', ')}`);

    info(`Cleaning ${outputPath}/ directory...`);
    await rmRF(outputPath);

    info(`Copying built files to ${outputPath}/...`);
    await cp(distPath, outputPath, { recursive: true, force: true });

    const lspFiles = await readdir(outputPath);
    info(`Files in ${outputPath}/: ${lspFiles.join(', ')}`);

    if (lspFiles.length === 0) {
      throw new Error(`No files copied to ${outputPath}/`);
    }

    return { lspPath: outputPath, files: lspFiles };

  } finally {
    info('Cleaning up build directory...');
    await rmRF(tempDir);
  }
}
