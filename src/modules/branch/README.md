# Branch Module / موديول الفروع

Cleans a GitHub repo through a GitHub App **without cloning**: it moves images/docs into folders, updates `.gitignore` and README image links, then opens a Pull Request from an isolated `orbithub/cleanup-YYYYMMDDHHmm` branch. It never writes to `main`, `master` or the default branch.

بينظّم ريبو على GitHub عن طريق GitHub App **من غير clone**: بينقل الصور والمستندات لمجلداتها، وبيحدّث `.gitignore` وروابط الصور في README، وبعدين بيفتح Pull Request من فرع معزول `orbithub/cleanup-YYYYMMDDHHmm`. عمره ما بيكتب على `main` أو `master` أو الفرع الأساسي.

## Structure / الهيكل

| File / الملف | Role / الدور |
|---|---|
| `auth.ts` | GitHub App login; returns a temporary (1 hour) installation client, never stored. / تسجيل دخول الـ App وتوكن مؤقت. |
| `planner.ts` | `buildCleanupPlan` builds the Dry-Run plan. Uses the C++ engine, falls back to TypeScript (`buildCleanupPlanTs`) if the `.exe` is missing or fails. / بيطلع خطة المعاينة. |
| `executor.ts` | `executeBranchCleanup` (6 Git Data API steps + PR) and `rollbackBranchCleanup`; enforces the branch security guard. / التنفيذ والتراجع وحاجز الأمان. |
| `audit.ts` | `recordBranchAudit`: saves EXECUTE / ROLLBACK records to Postgres (Drizzle) if a `db` is passed, otherwise logs to the terminal. / سجل العمليات. |
| `index.ts` | Public entrypoint with Zod validation. **Import only from here.** / الواجهة اللي التيم يستوردها. |
| `../../cpp/` | C++17 OOP engine: `RepoNodes.hpp` (Composite), `Rules.hpp` (Strategy), `PlannerEngine.hpp`, `main.cpp`. / محرك C++ للتخطيط. |
| `branch.test.ts` | Vitest unit tests. / اختبارات. |

## Usage / الاستخدام

```ts
import {
  previewBranchCleanup,
  runBranchCleanup,
  undoBranchCleanup,
} from "./modules/branch/index.js";

const ctx = { installationId: 123456, owner: "my-user", repo: "my-repo" };

// 1. Dry-Run: nothing is changed / معاينة بس
const actions = await previewBranchCleanup(ctx);

// 2. Execute after user approval / تنفيذ بعد موافقة المستخدم
const { prUrl, branchName } = await runBranchCleanup({
  ...ctx,
  actions,
  actorId: "user-42",
  // db,  // optional Drizzle connection for audit logs / اختياري
});

// 3. Undo: deletes the orbithub/ branch, the PR closes / تراجع
await undoBranchCleanup({ ...ctx, branchName, actorId: "user-42" });
```

Empty repos (no commits) throw a clear Arabic error. / الريبو الفاضي بيرمي رسالة عربي واضحة.

## Environment / المتغيرات

In `.env` (never commit it / ماترفعوش على Git):

```
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
```

The key is a single line with `\n` for line breaks. The App needs **Contents** and **Pull requests** (Read & write).
المفتاح في سطر واحد وفيه `\n`. والـ App محتاج صلاحيات Contents و Pull requests (Read & write).

## Commands / الأوامر

```powershell
npm run build:cpp   # rebuild the C++ engine (needs g++) / إعادة بناء محرك C++
npm run typecheck   # TypeScript check
npm test            # unit tests (Vitest)
npm start           # live run via src/test.ts / تجربة فعلية
```

Set `PLANNER_DEBUG=1` to see which engine ran (`C++` or `TypeScript`). `*.exe` is git-ignored, so each machine must run `npm run build:cpp` once.
`*.exe` متجاهل في Git، فكل جهاز لازم يشغّل `npm run build:cpp` مرة.
