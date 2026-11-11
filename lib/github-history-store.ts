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

interface PublicHistoryOptions {
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

function rawHistoryUrl(options: PublicHistoryOptions): string {
  const branchPath = options.branch.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${options.repository}/${branchPath}/${HISTORY_PATH}`;
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

export async function readPortfolioHistoryFromRawUrl(
  options: PublicHistoryOptions,
): Promise<PortfolioHistory> {
  const response = await fetch(rawHistoryUrl(options), {
    next: { revalidate: 300 },
  });
  if (!response.ok) {
    throw new Error(`GitHub raw history read failed (${response.status})`);
  }
  return (await response.json()) as PortfolioHistory;
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

/** Public read-only daily per-token reference. 404 = no snapshot (not zero price). */
export async function readDailyPositionHistoryFromRawUrl(
  options: PublicHistoryOptions,
  date: string,
): Promise<import("./position-change").DailyPositionHistory | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid daily history date");
  const branchPath = options.branch.split("/").map(encodeURIComponent).join("/");
  const url = `https://raw.githubusercontent.com/${options.repository}/${branchPath}/data/position-history/${date}.json`;
  const response = await fetch(url, { next: { revalidate: 300 } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub position history read failed (${response.status})`);
  const history = await response.json() as import("./position-change").DailyPositionHistory;
  if (history.version !== 1 || history.date !== date || !Array.isArray(history.wallets)) {
    throw new Error("Invalid GitHub daily position history");
  }
  return history;
}
