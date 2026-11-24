import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth.js", () => ({ getInstallationClient: vi.fn() }));
vi.mock("./audit.js", () => ({ recordBranchAudit: vi.fn(async () => ({ savedToDb: false })) }));

import { getInstallationClient } from "./auth.js";
import { executeBranchCleanup, rollbackBranchCleanup } from "./executor.js";
import { buildCleanupPlan, buildCleanupPlanTs, type PlannedAction, type RepoFile } from "./planner.js";

function useFakeOctokit(overrides: { defaultBranch?: string; getRef?: () => Promise<unknown> } = {}) {
  const fake = {
    rest: {
      repos: {
        get: vi.fn(async () => ({ data: { default_branch: overrides.defaultBranch ?? "main" } })),
      },
      git: {
        getRef: vi.fn(overrides.getRef ?? (async () => ({ data: { object: { sha: "base" } } }))),
        getCommit: vi.fn(async () => ({ data: { tree: { sha: "basetree" } } })),
        createBlob: vi.fn(async () => ({ data: { sha: "blob1" } })),
        createTree: vi.fn(async () => ({ data: { sha: "tree1" } })),
        createCommit: vi.fn(async () => ({ data: { sha: "commit1" } })),
        createRef: vi.fn(async () => ({})),
        deleteRef: vi.fn(async () => ({})),
      },
      pulls: {
        create: vi.fn(async () => ({ data: { number: 7, html_url: "https://github.com/o/r/pull/7" } })),
      },
    },
  };
  vi.mocked(getInstallationClient).mockResolvedValue(fake as never);
  return fake;
}

const base = { installationId: 1, owner: "o", repo: "r", actorId: "tester" };
const sampleAction: PlannedAction = {
  type: "CREATE_OR_UPDATE",
  newPath: ".gitignore",
  content: "x\n",
  reason: "test",
};

describe("security guard", () => {
  afterEach(() => vi.useRealTimers());

  it.each(["main", "master", "feature/x", "orbithub-x"])(
    "rollback rejects branch %s",
    async (branchName) => {
      useFakeOctokit();
      await expect(rollbackBranchCleanup({ ...base, branchName })).rejects.toThrow("SECURITY_VIOLATION");
    }
  );

  it("rollback rejects the repo's default branch", async () => {
    useFakeOctokit({ defaultBranch: "develop" });
    await expect(rollbackBranchCleanup({ ...base, branchName: "develop" })).rejects.toThrow(
      "SECURITY_VIOLATION"
    );
  });

  it("rollback allows orbithub/ branches and deletes only that ref", async () => {
    const fake = useFakeOctokit();
    const res = await rollbackBranchCleanup({ ...base, branchName: "orbithub/cleanup-1" });
    expect(res.deleted).toBe(true);
    expect(fake.rest.git.deleteRef).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      ref: "heads/orbithub/cleanup-1",
    });
  });

  it("execute throws SECURITY_VIOLATION and writes nothing if target equals the default branch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T03:04:00Z"));
    const fake = useFakeOctokit({ defaultBranch: "orbithub/cleanup-202601020304" });
    await expect(executeBranchCleanup({ ...base, actions: [sampleAction] })).rejects.toThrow(
      "SECURITY_VIOLATION"
    );
    expect(fake.rest.git.createRef).not.toHaveBeenCalled();
    expect(fake.rest.git.createBlob).not.toHaveBeenCalled();
  });

  it("execute creates an orbithub/ branch and opens a PR into the default branch", async () => {
    const fake = useFakeOctokit();
    const res = await executeBranchCleanup({ ...base, actions: [sampleAction] });
    expect(res.branchName).toMatch(/^orbithub\/cleanup-\d{12}$/);
    expect(res.prUrl).toBe("https://github.com/o/r/pull/7");
    expect(fake.rest.git.createTree).toHaveBeenCalledWith(
      expect.objectContaining({ base_tree: "basetree" })
    );
    expect(fake.rest.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ base: "main", head: res.branchName })
    );
  });
});

describe("empty repository", () => {
  it.each([404, 409])("throws the Arabic empty-repo error when getRef fails with %i", async (status) => {
    useFakeOctokit({
      getRef: async () => {
        throw Object.assign(new Error("boom"), { status });
      },
    });
    await expect(executeBranchCleanup({ ...base, actions: [sampleAction] })).rejects.toThrow(
      "فاضي (مفيش ولا commit)"
    );
  });

  it("does not hide unrelated errors", async () => {
    useFakeOctokit({
      getRef: async () => {
        throw Object.assign(new Error("server down"), { status: 500 });
      },
    });
    await expect(executeBranchCleanup({ ...base, actions: [sampleAction] })).rejects.toThrow("server down");
  });
});

const blob = (path: string, sha = `sha-${path}`): RepoFile => ({ path, sha, type: "blob", mode: "100644" });

const files: RepoFile[] = [
  blob("logo.png"),
  blob("photo.jpg"),
  blob("report.pdf"),
  blob("thesis.docx"),
  blob("debug.log"),
  blob(".DS_Store"),
  blob("main.cpp"),
  blob("app.ts"),
  blob("index.js"),
  blob("tool.py"),
  blob("sub/deep.png"),
  { path: "sub", sha: "t1", type: "tree" },
];
const readme = "# T\n![a](logo.png)\n<img src=\"./photo.jpg\">\n![keep](other/logo.png)\n";

const engineExists = existsSync(fileURLToPath(new URL("../../cpp/planner_engine.exe", import.meta.url)));

describe.each([
  ["buildCleanupPlan (C++ engine if built, else TS)", buildCleanupPlan],
  ["buildCleanupPlanTs (fallback)", buildCleanupPlanTs],
])("planner rules: %s", (_name, plan) => {
  const actions = plan(files, readme, null);
  const move = (p: string) => actions.find((a) => a.type === "MOVE" && a.oldPath === p);

  it("moves root images to assets/", () => {
    expect(move("logo.png")?.newPath).toBe("assets/logo.png");
    expect(move("photo.jpg")?.newPath).toBe("assets/photo.jpg");
    expect(move("logo.png")?.sha).toBe("sha-logo.png");
  });

  it("moves root docs to docs/", () => {
    expect(move("report.pdf")?.newPath).toBe("docs/report.pdf");
    expect(move("thesis.docx")?.newPath).toBe("docs/thesis.docx");
  });

  it("collects temp files into .gitignore", () => {
    const gi = actions.find((a) => a.newPath === ".gitignore");
    expect(gi?.type).toBe("CREATE_OR_UPDATE");
    expect(gi?.content).toContain("debug.log");
    expect(gi?.content).toContain(".DS_Store");
  });

  it("rewrites relative image paths in README.md but not unrelated ones", () => {
    const rd = actions.find((a) => a.newPath === "README.md");
    expect(rd?.content).toContain("![a](assets/logo.png)");
    expect(rd?.content).toContain('src="assets/photo.jpg"');
    expect(rd?.content).toContain("![keep](other/logo.png)");
  });

  it("never moves source code or nested files", () => {
    for (const p of ["main.cpp", "app.ts", "index.js", "tool.py", "sub/deep.png"]) {
      expect(actions.some((a) => a.oldPath === p || a.newPath.endsWith(p))).toBe(false);
    }
  });

  it("keeps existing .gitignore lines and does not duplicate entries", () => {
    const a = plan(files, null, "node_modules\ndebug.log").find((x) => x.newPath === ".gitignore");
    expect(a?.content?.startsWith("node_modules\ndebug.log\n")).toBe(true);
    expect(a?.content?.match(/debug\.log/g)).toHaveLength(1);
    expect(a?.content).toContain(".DS_Store");
  });
});

describe.skipIf(!engineExists)("C++ engine parity", () => {
  it("returns the same plan as the TypeScript implementation", () => {
    expect(buildCleanupPlan(files, readme, "node_modules")).toEqual(
      buildCleanupPlanTs(files, readme, "node_modules")
    );
  });
});

describe("ts fallback when engine output is unusable", () => {
  beforeEach(() => vi.resetModules());
  it("buildCleanupPlan returns an array for an empty repo", () => {
    expect(buildCleanupPlan([], null, null)).toEqual([]);
  });
});
