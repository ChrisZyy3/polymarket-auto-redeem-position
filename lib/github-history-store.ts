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

export async function appendSnapshotOnGitHub(
  snapshot: PortfolioSnapshot,
  options: GitHubStoreOptions,
): Promise<void> {
  const url = `https://api.github.com/repos/${options.repository}/contents/${HISTORY_PATH}?ref=${encodeURIComponent(options.branch)}`;
  const readResponse = await fetch(url, { headers: githubHeaders(options.token) });
  if (!readResponse.ok) {
    throw new Error(`GitHub history read failed (${readResponse.status})`);
  }

  const current = (await readResponse.json()) as GitHubContentResponse;
  const history = JSON.parse(
    Buffer.from(current.content.replace(/\n/g, ""), "base64").toString("utf8"),
  ) as PortfolioHistory;
  const updated = appendSnapshot(history, snapshot);
  const writeResponse = await fetch(url.split("?ref=")[0], {
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
