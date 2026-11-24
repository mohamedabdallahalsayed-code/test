import { getInstallationClient } from "./auth.js";
import type { PlannedAction } from "./planner.js";
import { recordBranchAudit, type AuditEntry } from "./audit.js";

// فشل التسجيل ما يوقعش العملية بعد ما الـ PR اتفتح فعلاً
async function auditSafely(entry: AuditEntry, db?: unknown): Promise<void> {
  try {
    await recordBranchAudit(entry, db);
  } catch (err) {
    console.error("AUDIT_FAILED:", err);
  }
}

/**
 * حاجز أمان: يرفض main / master / الفرع الافتراضي، ويرفض أي فرع مش بيبدأ بـ orbithub/
 */
function assertSafeBranchName(branchName: string, defaultBranch: string): void {
  const clean = branchName.replace(/^refs\/heads\//, "");
  const forbidden = ["main", "master", defaultBranch].map((b) => b.toLowerCase());

  if (forbidden.includes(clean.toLowerCase()) || !clean.startsWith("orbithub/")) {
    throw new Error(
      `SECURITY_VIOLATION: ممنوع التعامل مع الفرع (${branchName}). لازم الفرع يبدأ بـ orbithub/ ومايكونش الفرع الأساسي.`
    );
  }
}

function isHttpStatus(err: unknown, ...codes: number[]): boolean {
  const status = (err as { status?: number } | null)?.status;
  return typeof status === "number" && codes.includes(status);
}

type TreeItem = {
  path: string;
  mode: "100644" | "100755" | "040000" | "160000" | "120000";
  type: "blob";
  sha: string | null;
};

function toMode(mode: string | undefined): TreeItem["mode"] {
  return mode === "100755" || mode === "120000" ? mode : "100644";
}

/** YYYYMMDDHHmm بتوقيت UTC */
function timestamp(): string {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
}

export async function executeBranchCleanup(params: {
  installationId: number;
  owner: string;
  repo: string;
  actions: PlannedAction[];
  actorId: string;
  db?: unknown;
}) {
  const { installationId, owner, repo, actions, actorId, db } = params;
  const safeAudit = (entry: AuditEntry) => auditSafely(entry, db);

  if (actions.length === 0) {
    throw new Error("مفيش تعديلات لتنفيذها.");
  }

  const octokit = await getInstallationClient(installationId);

  const { data: repoInfo } = await octokit.rest.repos.get({ owner, repo });
  const defaultBranch = repoInfo.default_branch;

  const newBranchName = `orbithub/cleanup-${timestamp()}`;
  assertSafeBranchName(newBranchName, defaultBranch);

  // الخطوة 1: base_sha
  let baseSha: string;
  try {
    const { data: refData } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${defaultBranch}`,
    });
    baseSha = refData.object.sha;
  } catch (err) {
    if (isHttpStatus(err, 404, 409)) {
      throw new Error(
        `الريبو ${owner}/${repo} فاضي (مفيش ولا commit). ارفع commit واحد على الأقل وجرب تاني.`
      );
    }
    throw err;
  }

  // الـ base_tree لازم يكون sha بتاع الـ tree، مش الـ commit
  const { data: baseCommit } = await octokit.rest.git.getCommit({
    owner,
    repo,
    commit_sha: baseSha,
  });

  // الخطوة 2: blobs للملفات الجديدة/المعدلة
  const treeItems: TreeItem[] = [];
  for (const action of actions) {
    if (action.type === "CREATE_OR_UPDATE" && action.content !== undefined) {
      const { data: blob } = await octokit.rest.git.createBlob({
        owner,
        repo,
        content: action.content,
        encoding: "utf-8",
      });
      treeItems.push({
        path: action.newPath,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
    } else if (action.type === "MOVE" && action.oldPath && action.sha) {
      treeItems.push({
        path: action.newPath,
        mode: toMode(action.mode),
        type: "blob",
        sha: action.sha,
      });
      // sha: null = حذف من المسار القديم
      treeItems.push({
        path: action.oldPath,
        mode: toMode(action.mode),
        type: "blob",
        sha: null,
      });
    }
  }

  if (treeItems.length === 0) {
    throw new Error("الخطة مفيهاش أي عنصر قابل للتنفيذ.");
  }

  // الخطوة 3: tree جديد فوق القديم
  const { data: newTree } = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: baseCommit.tree.sha,
    tree: treeItems,
  });

  // الخطوة 4: commit
  const { data: newCommit } = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: "chore(orbithub): organize repository structure and assets",
    tree: newTree.sha,
    parents: [baseSha],
  });

  // الخطوة 5: الفرع الجديد
  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${newBranchName}`,
    sha: newCommit.sha,
  });

  // الخطوة 6: Pull Request
  const summary = actions.map((a) => `- **${a.newPath}**: ${a.reason}`).join("\n");
  const { data: pr } = await octokit.rest.pulls.create({
    owner,
    repo,
    title: "OrbitHub: تنظيف وترتيب هيكل المشروع",
    head: newBranchName,
    base: defaultBranch,
    body: `تم إنشاء هذا الطلب تلقائياً بواسطة **OrbitHub**.\n\n### التغييرات:\n${summary}\n\n> راجع الملفات ثم اضغط **Merge pull request** لو موافق.\n\n> 💡 توصية: فعّل **Branch Protection Rules** على الفرع الأساسي (${defaultBranch}) عشان محدش يكتب عليه مباشرة.`,
  });

  await safeAudit({
    actorId,
    owner,
    repo,
    branchName: newBranchName,
    prNumber: pr.number,
    prUrl: pr.html_url,
    actionType: "EXECUTE",
    changes: actions,
  });

  return {
    branchName: newBranchName,
    prNumber: pr.number,
    prUrl: pr.html_url,
    commitSha: newCommit.sha,
  };
}

/** تراجع: بيمسح فرع orbithub/ فقط، فالـ PR بيتقفل لوحده */
export async function rollbackBranchCleanup(params: {
  installationId: number;
  owner: string;
  repo: string;
  branchName: string;
  actorId: string;
  db?: unknown;
}) {
  const { installationId, owner, repo, branchName, actorId, db } = params;
  const safeAudit = (entry: AuditEntry) => auditSafely(entry, db);

  const octokit = await getInstallationClient(installationId);
  const { data: repoInfo } = await octokit.rest.repos.get({ owner, repo });
  assertSafeBranchName(branchName, repoInfo.default_branch);

  const clean = branchName.replace(/^refs\/heads\//, "");
  await octokit.rest.git.deleteRef({ owner, repo, ref: `heads/${clean}` });

  await safeAudit({
    actorId,
    owner,
    repo,
    branchName: clean,
    actionType: "ROLLBACK",
    changes: [],
  });

  return { deleted: true, branchName: clean };
}
