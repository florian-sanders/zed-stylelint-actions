import * as fs from 'fs/promises';
import * as path from 'path';
import toml from 'toml';

export interface ExtensionToml {
  version: string;
  language_servers?: {
    'stylelint-lsp'?: {
      lsp_required_version?: string;
    };
  };
}

export async function readExtensionToml(filePath = 'extension.toml'): Promise<ExtensionToml> {
  const content = await fs.readFile(filePath, 'utf-8');
  return toml.parse(content) as ExtensionToml;
}

/**
 * Write version fields to extension.toml and keep Cargo.toml in sync.
 *
 * The extension version defaults to the LSP version (release version matches
 * the language server version) unless explicitly overridden.
 */
export async function writeExtensionToml(data: ExtensionToml, filePath = 'extension.toml'): Promise<void> {
  let content = await fs.readFile(filePath, 'utf-8');

  const lspVersion = data.language_servers?.['stylelint-lsp']?.lsp_required_version;

  if (lspVersion) {
    content = content.replace(
      /^(lsp_required_version\s*=\s*)"[^"]*"/m,
      `$1"${lspVersion}"`,
    );
  }

  // Default extension version to LSP version (release version matches language server version)
  const extensionVersion = data.version || lspVersion;
  if (extensionVersion) {
    content = content.replace(
      /^(version\s*=\s*)"[^"]*"/m,
      `$1"${extensionVersion}"`,
    );
  }

  await fs.writeFile(filePath, content, 'utf-8');

  // Keep Cargo.toml version in sync
  if (extensionVersion) {
    const cargoPath = path.join(path.dirname(filePath), 'Cargo.toml');
    try {
      let cargoContent = await fs.readFile(cargoPath, 'utf-8');
      cargoContent = cargoContent.replace(
        /^(version\s*=\s*)"[^"]*"/m,
        `$1"${extensionVersion}"`,
      );
      await fs.writeFile(cargoPath, cargoContent, 'utf-8');
    } catch {
      // Cargo.toml may not exist in test environments
    }
  }
}
