export interface GithubConfig {
  token: string;
  repo: string; // e.g. "username/repo"
  branch: string; // e.g. "main"
}

export interface PublishResult {
  success: boolean;
  message?: string;
  contentUrl?: string;
}

export async function checkGithubFile(config: GithubConfig, path: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${config.repo}/contents/${path}?ref=${config.branch}`;
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${config.token}`
      }
    });
    if (response.ok) {
      const data = await response.json();
      return data.sha;
    }
    return null;
  } catch (error) {
    console.error('Check file error:', error);
    return null;
  }
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join('');
  return btoa(binString);
}

export async function publishToGithub(config: GithubConfig, path: string, content: string, commitMessage: string): Promise<PublishResult> {
  const existingSha = await checkGithubFile(config, path);
  const url = `https://api.github.com/repos/${config.repo}/contents/${path}`;
  const payload: any = {
    message: commitMessage || `Update ${path}`,
    content: utf8ToBase64(content),
    branch: config.branch
  };

  if (existingSha) {
    payload.sha = existingSha;
  }

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const data = await response.json();
      return { success: true, contentUrl: data.content?.html_url || '' };
    } else {
      const err = await response.json();
      return { success: false, message: err.message || 'Unknown error publishing to GitHub' };
    }
  } catch (error: any) {
    return { success: false, message: error.message || 'Network error' };
  }
}