import { appendSnapshot, type PortfolioHistory, type PortfolioSnapshot } from "./portfolio-history";

const HISTORY_PATH = "data/portfolio-history.json";

interface GitHubContentResponse {
  content: string;
  sha: string;
}

interface GitHubStoreOptions {
  token: string;
  repository: string;
  branch: string;
}

function githubHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function historyUrl(options: GitHubStoreOptions): string {
  return `https://api.github.com/repos/${options.repository}/contents/${HISTORY_PATH}?ref=${encodeURIComponent(options.branch)}`;
}

function decodeHistory(content: string): PortfolioHistory {
  return JSON.parse(
    Buffer.from(content.replace(/\n/g, ""), "base64").toString("utf8"),
  ) as PortfolioHistory;
}

async function readGitHubContent(options: GitHubStoreOptions): Promise<GitHubContentResponse> {
  const response = await fetch(historyUrl(options), {
    headers: githubHeaders(options.token),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`GitHub history read failed (${response.status})`);
  }
  return (await response.json()) as GitHubContentResponse;
}

export async function readPortfolioHistoryOnGitHub(
  options: GitHubStoreOptions,
): Promise<PortfolioHistory> {
  const current = await readGitHubContent(options);
  return decodeHistory(current.content);
}

export async function appendSnapshotOnGitHub(
  snapshot: PortfolioSnapshot,
  options: GitHubStoreOptions,
): Promise<void> {
  const current = await readGitHubContent(options);
  const updated = appendSnapshot(decodeHistory(current.content), snapshot);
  const writeResponse = await fetch(historyUrl(options).split("?ref=")[0], {
    method: "PUT",
    headers: {
      ...githubHeaders(options.token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: `data: record portfolio snapshot ${snapshot.recordedAt.slice(0, 10)}`,
      content: Buffer.from(`${JSON.stringify(updated, null, 2)}\n`).toString("base64"),
      sha: current.sha,
      branch: options.branch,
    }),
  });

  if (!writeResponse.ok) {
    const details = await writeResponse.text();
    throw new Error(`GitHub history write failed (${writeResponse.status}): ${details}`);
  }
}
