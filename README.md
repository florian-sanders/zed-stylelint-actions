# zed-stylelint-actions

Reusable GitHub Actions for Zed extension CI/CD workflows.

## Available Actions

- `update-lsp` - Check for updates, build LSP, create prerelease, and open PR
- `publish-release` - Publish a release (promotes prerelease or builds from scratch)
- `build-lsp` - Build the LSP server and commit changes
- `check-lsp-version` - Check for LSP version updates
- `create-draft-release` - Create a draft GitHub release
- `create-pull-request` - Create a pull request

## Usage

```yaml
- uses: florian-sanders/zed-stylelint-actions/build-lsp@v1
  with:
    # action inputs...
```

## Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build actions:
   ```bash
   npm run build
   ```

3. Type check:
   ```bash
   npm run typecheck
   ```

## Releasing

Push to `main` and create a tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The release workflow will automatically update the `v1` major version tag.
