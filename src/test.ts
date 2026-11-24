import "dotenv/config";
import { z } from "zod";
import { getInstallationClient } from "./modules/branch/auth.js";
import { buildCleanupPlan, type RepoFile } from "./modules/branch/planner.js";
import { executeBranchCleanup } from "./modules/branch/executor.js";

// 1. حط بياناتك هنا
const input = z
  .object({
    installationId: z.number().int().positive(),
    owner: z.string().min(1).refine((v) => v !== "YOUR_GITHUB_USERNAME", {
      message: "غيّر YOUR_GITHUB_USERNAME باسم حسابك على GitHub",
    }),
    repo: z.string().min(1),
  })
  .parse({
    installationId:185482321,
    owner: "mohamedabdallahalsayed-code", // اسم حسابك أو المنظمة
    repo: "test", // اسم الريبو التجريبي
  });

const env = z
  .object({
    GITHUB_APP_ID: z.string().min(1),
    GITHUB_PRIVATE_KEY: z.string().min(1),
  })
  .parse(process.env);
void env;

async function readTextFile(
  octokit: Awaited<ReturnType<typeof getInstallationClient>>,
  path: string
): Promise<string | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: input.owner,
      repo: input.repo,
      path,
    });
    if (!Array.isArray(data) && data.type === "file" && "content" in data) {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
  } catch {
    // الملف مش موجود
  }
  return null;
}

async function runTest() {
  const { installationId, owner, repo } = input;
  const octokit = await getInstallationClient(installationId);

  // 2. الفرع الأساسي وشجرة الملفات
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
    throw new Error("الريبو فاضي (مفيش commits). ارفع ملفات الأول.");
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

  // 3. README و .gitignore الحاليين
  const readmeContent = await readTextFile(octokit, "README.md");
  const gitignoreContent = await readTextFile(octokit, ".gitignore");

  // 4. Dry-Run
  const plan = buildCleanupPlan(files, readmeContent, gitignoreContent);
  console.log("خطة التعديلات المقترحة (Dry-Run):");
  console.dir(plan, { depth: null });

  if (plan.length === 0) {
    console.log("الريبو نظيف ومفيش حاجة محتاجة ترتيب.");
    return;
  }

  // 5. تنفيذ وفتح PR
  const result = await executeBranchCleanup({
    installationId,
    owner,
    repo,
    actions: plan,
    actorId: "local-test",
  });
  console.log("تم! افتح الرابط ده:", result.prUrl);
}

runTest().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
