import { z } from "zod";
import { getInstallationClient } from "./auth.js";
import { buildCleanupPlan, type PlannedAction, type RepoFile } from "./planner.js";
import { executeBranchCleanup, rollbackBranchCleanup } from "./executor.js";

export type { PlannedAction } from "./planner.js";

const repoRef = z.object({
  installationId: z.number().int().positive(),
  owner: z.string().min(1),
  repo: z.string().min(1),
});

const plannedAction = z.object({
  type: z.enum(["MOVE", "CREATE_OR_UPDATE"]),
  oldPath: z.string().optional(),
  newPath: z.string().min(1),
  sha: z.string().optional(),
  mode: z.string().optional(),
  content: z.string().optional(),
  reason: z.string(),
});

const runSchema = repoRef.extend({
  actions: z.array(plannedAction).min(1),
  actorId: z.string().min(1),
  db: z.unknown().optional(),
});

const undoSchema = repoRef.extend({
  branchName: z.string().min(1),
  actorId: z.string().min(1),
  db: z.unknown().optional(),
});

async function readTextFile(
  octokit: Awaited<ReturnType<typeof getInstallationClient>>,
  owner: string,
  repo: string,
  path: string
): Promise<string | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
    if (!Array.isArray(data) && data.type === "file" && "content" in data) {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
  } catch {
    // الملف مش موجود
  }
  return null;
}

/** Dry-Run: بيرجع الخطة من غير ما يغير أي حاجة */
export async function previewBranchCleanup(
  input: z.input<typeof repoRef>
): Promise<PlannedAction[]> {
  const { installationId, owner, repo } = repoRef.parse(input);
  const octokit = await getInstallationClient(installationId);

  const { data: repoInfo } = await octokit.rest.repos.get({ owner, repo });
  let headSha: string;
  try {
    const { data: ref } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${repoInfo.default_branch}`,
    });
    headSha = ref.object.sha;
  } catch {
    throw new Error(`الريبو ${owner}/${repo} فاضي (مفيش commits).`);
  }

  const { data: treeData } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: headSha,
    recursive: "1",
  });

  const files: RepoFile[] = [];
  for (const item of treeData.tree) {
    if (item.path && item.sha && item.type) {
      files.push({
        path: item.path,
        sha: item.sha,
        type: item.type,
        ...(item.mode ? { mode: item.mode } : {}),
      });
    }
  }

  const readme = await readTextFile(octokit, owner, repo, "README.md");
  const gitignore = await readTextFile(octokit, owner, repo, ".gitignore");
  return buildCleanupPlan(files, readme, gitignore);
}

/** بينفذ الخطة على فرع orbithub/ ويفتح PR */
export async function runBranchCleanup(input: z.input<typeof runSchema>) {
  const parsed = runSchema.parse(input);
  return executeBranchCleanup(parsed as Parameters<typeof executeBranchCleanup>[0]);
}

/** بيمسح فرع orbithub/ (والـ PR بيتقفل) */
export async function undoBranchCleanup(input: z.input<typeof undoSchema>) {
  return rollbackBranchCleanup(undoSchema.parse(input));
}
