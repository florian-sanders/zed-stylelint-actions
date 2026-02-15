import * as github from '@actions/github';

export type Octokit = ReturnType<typeof github.getOctokit>;

export interface LspReleaseInfo {
  tagName: string;
  version: string;
  body: string;
  tarballUrl: string;
}

export async function getLatestLspRelease(octokit: Octokit): Promise<LspReleaseInfo> {
  const { data } = await octokit.rest.repos.getLatestRelease({
    owner: 'stylelint',
    repo: 'vscode-stylelint'
  });
  
  return {
    tagName: data.tag_name,
    version: data.tag_name.replace(/^v/, ''),
    body: data.body || '',
    tarballUrl: data.tarball_url || ''
  };
}

export async function findOpenLspUpdatePr(octokit: Octokit, owner: string, repo: string): Promise<number | null> {
  const prs = await octokit.paginate(octokit.rest.pulls.list, {
    owner,
    repo,
    state: 'open',
  });

  const lspPr = prs.find((pr: { head: { ref: string } }) => pr.head.ref.startsWith('update-lsp-'));
  return lspPr ? lspPr.number : null;
}
