import { App } from "octokit";

let cachedApp: App | undefined;

// ننشئ الـ App أول مرة نحتاجه بس، ونتأكد إن المتغيرات موجودة قبل الاستخدام
function getApp(): App {
  if (cachedApp) return cachedApp;

  const appId = process.env.GITHUB_APP_ID;
  const rawKey = process.env.GITHUB_PRIVATE_KEY;
  if (!appId || !rawKey) {
    throw new Error(
      "GITHUB_APP_ID و GITHUB_PRIVATE_KEY لازم يكونوا موجودين في ملف .env"
    );
  }

  cachedApp = new App({
    appId,
    privateKey: rawKey.replace(/\\n/g, "\n"),
  });
  return cachedApp;
}

/**
 * بترجع Octokit بتوكن مؤقت (ساعة واحدة) للـ installation.
 * التوكن مش بيتخزن عندنا؛ المكتبة بتطلبه عند الحاجة.
 */
export async function getInstallationClient(installationId: number) {
  return getApp().getInstallationOctokit(installationId);
}
