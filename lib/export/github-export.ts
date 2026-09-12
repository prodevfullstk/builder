/**
 * GitHub REST & Git Database API Integration
 * Handles authentication verification, repository creation, and atomic tree commits.
 */

export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  name: string | null;
  html_url: string;
  public_repos: number;
}

export interface CreatedRepo {
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
  isPrivate: boolean;
}

const GITHUB_API = 'https://api.github.com';

function getHeaders(token: string) {
  return {
    Authorization: `Bearer ${token.trim()}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * Verify GitHub Personal Access Token and fetch user profile
 */
export async function verifyGitHubToken(
  token: string
): Promise<{ success: boolean; user?: GitHubUser; error?: string }> {
  if (!token || !token.trim()) {
    return { success: false, error: 'GitHub token is required.' };
  }

  try {
    const res = await fetch(`${GITHUB_API}/user`, {
      headers: getHeaders(token),
    });

    if (!res.ok) {
      if (res.status === 401) {
        return { success: false, error: 'Invalid or expired GitHub token. Please check your token permissions (requires "repo" scope).' };
      }
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.message || `GitHub API error: ${res.statusText}` };
    }

    const data = await res.json();
    return {
      success: true,
      user: {
        login: data.login,
        id: data.id,
        avatar_url: data.avatar_url,
        name: data.name || data.login,
        html_url: data.html_url,
        public_repos: data.public_repos || 0,
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to connect to GitHub.' };
  }
}

/**
 * Create a new repository under authenticated user's account
 */
export async function createGitHubRepository(
  token: string,
  options: {
    name: string;
    description?: string;
    isPrivate: boolean;
  }
): Promise<{ success: boolean; repo?: CreatedRepo; error?: string }> {
  const sanitizedName = options.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-');

  if (!sanitizedName) {
    return { success: false, error: 'Please specify a valid repository name.' };
  }

  try {
    const res = await fetch(`${GITHUB_API}/user/repos`, {
      method: 'POST',
      headers: getHeaders(token),
      body: JSON.stringify({
        name: sanitizedName,
        description: options.description?.trim() || 'Built with Opendrok AI Web Builder',
        private: options.isPrivate,
        auto_init: true, // Auto initialize with README so branch exists immediately
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 422) {
        return {
          success: false,
          error: `Repository "${sanitizedName}" already exists on your GitHub account. Please use a different name.`,
        };
      }
      return { success: false, error: data.message || 'Failed to create GitHub repository.' };
    }

    return {
      success: true,
      repo: {
        name: data.name,
        full_name: data.full_name,
        html_url: data.html_url,
        default_branch: data.default_branch || 'main',
        isPrivate: data.private,
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error while creating repository.' };
  }
}

/**
 * Push all project files to the repository via GitHub Git Database Tree API
 */
export async function pushProjectToGitHub(
  token: string,
  owner: string,
  repo: string,
  files: Record<string, string>,
  commitMessage: string = 'Initial commit from Opendrok AI Web Builder',
  onProgress?: (status: string) => void
): Promise<{ success: boolean; commitUrl?: string; repoUrl?: string; error?: string }> {
  const headers = getHeaders(token);

  try {
    onProgress?.('Fetching repository branch info...');

    // 1. Get repository info to identify default branch
    const repoInfoRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers });
    if (!repoInfoRes.ok) {
      return { success: false, error: 'Could not access repository metadata.' };
    }
    const repoInfo = await repoInfoRes.json();
    const branch = repoInfo.default_branch || 'main';

    // 2. Fetch the latest commit on default branch (retry a few times if auto_init is settling)
    let baseCommitSha = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      const refRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${branch}`, { headers });
      if (refRes.ok) {
        const refData = await refRes.json();
        baseCommitSha = refData.object.sha;
        break;
      }
      await new Promise((r) => setTimeout(r, 1200));
    }

    if (!baseCommitSha) {
      return {
        success: false,
        error: `Could not locate branch ${branch} on repository. Ensure repo is initialized.`,
      };
    }

    // 3. Get base tree SHA from base commit
    onProgress?.('Preparing file tree...');
    const commitRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/commits/${baseCommitSha}`, { headers });
    if (!commitRes.ok) {
      return { success: false, error: 'Could not fetch base commit tree.' };
    }
    const commitData = await commitRes.json();
    const baseTreeSha = commitData.tree.sha;

    // 4. Build tree elements for project files
    const treeItems: Array<{ path: string; mode: string; type: string; content: string }> = [];

    // Ensure standard .gitignore exists
    const hasGitignore = Object.keys(files).some((p) => p.replace(/^\/+/, '') === '.gitignore');
    if (!hasGitignore) {
      treeItems.push({
        path: '.gitignore',
        mode: '100644',
        type: 'blob',
        content: `node_modules/\n.DS_Store\ndist/\ndist-ssr/\n*.local\n.env\n.env.*.local\n`,
      });
    }

    // Ensure README.md exists
    const hasReadme = Object.keys(files).some((p) => p.replace(/^\/+/, '').toLowerCase() === 'readme.md');
    if (!hasReadme) {
      treeItems.push({
        path: 'README.md',
        mode: '100644',
        type: 'blob',
        content: `# ${repo}\n\nBuilt and deployed using [Opendrok AI Web Builder](https://builder-zeta-beige.vercel.app).\n\n## 🚀 Getting Started\n\n\`\`\`bash\n# Install dependencies\npnpm install\n# or\nnpm install\n\n# Start development server\npnpm run dev\n# or\nnpm run dev\n\`\`\`\n\n## 📦 Build for Production\n\n\`\`\`bash\npnpm run build\n\`\`\`\n`,
      });
    }

    // Add all user project files
    for (const [pathKey, content] of Object.entries(files)) {
      const cleanPath = pathKey.replace(/^\/+/, '');
      if (!cleanPath) continue;

      treeItems.push({
        path: cleanPath,
        mode: '100644',
        type: 'blob',
        content: content,
      });
    }

    onProgress?.(`Uploading ${treeItems.length} files to Git tree...`);

    // 5. Create new tree
    const treeRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeItems,
      }),
    });

    if (!treeRes.ok) {
      const treeErr = await treeRes.json().catch(() => ({}));
      return { success: false, error: treeErr.message || 'Failed to create Git tree.' };
    }
    const treeData = await treeRes.json();
    const newTreeSha = treeData.sha;

    // 6. Create commit
    onProgress?.('Creating commit...');
    const newCommitRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/commits`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: commitMessage,
        tree: newTreeSha,
        parents: [baseCommitSha],
      }),
    });

    if (!newCommitRes.ok) {
      const commitErr = await newCommitRes.json().catch(() => ({}));
      return { success: false, error: commitErr.message || 'Failed to create Git commit.' };
    }
    const newCommitData = await newCommitRes.json();
    const newCommitSha = newCommitData.sha;

    // 7. Update branch reference safely (no force push)
    // Check if remote branch has moved since we fetched baseCommitSha
    const latestRefRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${branch}`, { headers });
    if (latestRefRes.ok) {
      const latestRefData = await latestRefRes.json();
      const currentRemoteSha = latestRefData.object?.sha;
      if (currentRemoteSha && currentRemoteSha !== baseCommitSha) {
        return {
          success: false,
          error: `Push rejected: remote branch "${branch}" has changed (head is ${currentRemoteSha}, expected ${baseCommitSha}). Remote conflict detected; non-fast-forward overwrites are prohibited.`,
        };
      }
    }

    onProgress?.(`Updating ${branch} branch reference safely...`);
    const updateRefRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        sha: newCommitSha,
        force: false,
      }),
    });

    if (!updateRefRes.ok) {
      const refErr = await updateRefRes.json().catch(() => ({}));
      return {
        success: false,
        error: refErr.message || 'Failed to update branch reference. The remote branch may have moved or force push was rejected.',
      };
    }

    onProgress?.('Pushed successfully!');
    return {
      success: true,
      commitUrl: `https://github.com/${owner}/${repo}/commit/${newCommitSha}`,
      repoUrl: `https://github.com/${owner}/${repo}`,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Unexpected error during GitHub push.' };
  }
}
