import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface PlannedAction {
  type: "MOVE" | "CREATE_OR_UPDATE";
  oldPath?: string;
  newPath: string;
  sha?: string;
  mode?: string;
  content?: string;
  reason: string;
}

export interface RepoFile {
  path: string;
  sha: string;
  type: string;
  mode?: string;
}

const ASSET_EXTS = new Set(["png", "jpg", "jpeg", "svg", "gif", "webp"]);
const DOC_EXTS = new Set(["pdf", "docx", "pptx"]);
const TEMP_EXTS = new Set(["log", "tmp"]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Dry-Run: بتاخد ملفات الريبو وبترجع قائمة تعديلات مقترحة من غير ما تنفذ حاجة.
 * ملفات الكود عمرها ما بتتنقل.
 */
export function buildCleanupPlanTs(
  files: RepoFile[],
  readmeContent: string | null,
  existingGitignore: string | null = null
): PlannedAction[] {
  const actions: PlannedAction[] = [];
  const movedImages: Array<{ from: string; to: string }> = [];
  const tempFiles: string[] = [];

  for (const file of files) {
    // ملفات الروت بس (مش مجلدات ومش ملفات جوه مجلدات فرعية)
    if (file.type !== "blob" || file.path.includes("/")) continue;

    const name = file.path;
    const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";

    if (name === ".DS_Store" || TEMP_EXTS.has(ext)) {
      tempFiles.push(name);
    } else if (ASSET_EXTS.has(ext)) {
      const to = `assets/${name}`;
      actions.push({
        type: "MOVE",
        oldPath: name,
        newPath: to,
        sha: file.sha,
        ...(file.mode ? { mode: file.mode } : {}),
        reason: "نقل الصورة إلى assets/",
      });
      movedImages.push({ from: name, to });
    } else if (DOC_EXTS.has(ext)) {
      actions.push({
        type: "MOVE",
        oldPath: name,
        newPath: `docs/${name}`,
        sha: file.sha,
        ...(file.mode ? { mode: file.mode } : {}),
        reason: "نقل المستند إلى docs/",
      });
    }
    // أي امتداد تاني (كود وغيره) بيفضل مكانه
  }

  // تحديث روابط الصور في README (markdown و html) بمطابقة اسم الملف بالظبط
  if (readmeContent && movedImages.length > 0) {
    let updated = readmeContent;
    for (const img of movedImages) {
      const re = new RegExp(
        `(\\]\\(\\s*<?|src\\s*=\\s*["']|href\\s*=\\s*["'])(?:\\./)?${escapeRegExp(img.from)}(?=[>)"'\\s#?])`,
        "g"
      );
      updated = updated.replace(re, (_m, prefix: string) => `${prefix}${img.to}`);
    }
    if (updated !== readmeContent) {
      actions.push({
        type: "CREATE_OR_UPDATE",
        newPath: "README.md",
        content: updated,
        reason: "تحديث روابط الصور في README.md بعد نقلها",
      });
    }
  }

  // .gitignore: نضيف الجديد بس ونحافظ على القديم
  if (tempFiles.length > 0) {
    const existing = existingGitignore ?? "";
    const existingLines = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
    const toAdd = tempFiles.filter((f) => !existingLines.has(f));
    if (toAdd.length > 0) {
      const base = existing === "" || existing.endsWith("\n") ? existing : existing + "\n";
      actions.push({
        type: "CREATE_OR_UPDATE",
        newPath: ".gitignore",
        content: `${base}# Added by OrbitHub\n${toAdd.join("\n")}\n`,
        reason: "إضافة الملفات المؤقتة إلى .gitignore",
      });
    }
  }

  return actions;
}

const ENGINE_PATH = fileURLToPath(new URL("../../cpp/planner_engine.exe", import.meta.url));

function b64(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

function isPlannedActionArray(v: unknown): v is PlannedAction[] {
  return (
    Array.isArray(v) &&
    v.every(
      (a) =>
        a &&
        typeof a === "object" &&
        (a.type === "MOVE" || a.type === "CREATE_OR_UPDATE") &&
        typeof a.newPath === "string" &&
        typeof a.reason === "string"
    )
  );
}

/** C++ engine أولاً، ولو مش موجود أو فشل بنرجع للـ TypeScript */
export function buildCleanupPlan(
  files: RepoFile[],
  readmeContent: string | null,
  existingGitignore: string | null = null
): PlannedAction[] {
  const debug = process.env.PLANNER_DEBUG === "1";
  const rootBlobs = files.filter((f) => f.type === "blob" && !f.path.includes("/"));
  const unsafe = rootBlobs.some((f) => /[\t\r\n]/.test(f.path + f.sha + (f.mode ?? "")));

  if (!unsafe && existsSync(ENGINE_PATH)) {
    try {
      const lines = rootBlobs.map((f) => `FILE\t${f.path}\t${f.sha}\t${f.mode ?? ""}`);
      if (readmeContent) lines.push(`README\t${b64(readmeContent)}`);
      if (existingGitignore) lines.push(`GITIGNORE\t${b64(existingGitignore)}`);

      const out = execFileSync(ENGINE_PATH, [], {
        input: lines.join("\n") + "\n",
        encoding: "utf-8",
        timeout: 10_000,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      });
      const parsed: unknown = JSON.parse(out);
      if (isPlannedActionArray(parsed)) {
        if (debug) console.error("[planner] engine: C++");
        return parsed;
      }
    } catch (err) {
      if (debug) console.error("[planner] C++ failed, using TypeScript:", err);
    }
  }

  if (debug) console.error("[planner] engine: TypeScript");
  return buildCleanupPlanTs(files, readmeContent, existingGitignore);
}
