import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import type { PlannedAction } from "./planner.js";

// 1. تعريف شكل الجدول في قاعدة بيانات PostgreSQL
export const branchAuditLogs = pgTable("branch_audit_logs", {
  id: serial("id").primaryKey(), // رقم مسلسل تلقائي لكل عملية (1, 2, 3...)
  actorId: text("actor_id").notNull(), // مين المستخدم اللي طلب العملية
  owner: text("owner").notNull(), // صاحب الريبو على GitHub
  repo: text("repo").notNull(), // اسم الريبو
  branchName: text("branch_name").notNull(), // اسم الفرع المعزول اللي اتعمل
  prNumber: integer("pr_number"), // رقم الـ Pull Request
  prUrl: text("pr_url"), // رابط الـ Pull Request
  actionType: text("action_type").notNull(), // نوع العملية: EXECUTE أو ROLLBACK
  changes: jsonb("changes").$type<PlannedAction[]>().notNull(), // قائمة الملفات اللي اتغيرت
  createdAt: timestamp("created_at").defaultNow().notNull(), // توقيت العملية بالثانية
});

// شكل البيانات اللي الدالة بتستقبلها
export interface AuditEntry {
  actorId: string;
  owner: string;
  repo: string;
  branchName: string;
  prNumber?: number;
  prUrl?: string;
  actionType: "EXECUTE" | "ROLLBACK";
  changes: PlannedAction[];
}

// 2. دالة تسجيل العملية
export async function recordBranchAudit(entry: AuditEntry, db?: any) {
  // لو باقي الفريق مرروا اتصال قاعدة بيانات حقيقي (Supabase / Neon)
  if (db) {
    await db.insert(branchAuditLogs).values(entry);
    return { savedToDb: true };
  }

  // لو بنجرب الكود محلياً من غير داتابيز لسه، بنطبع السجل في الـ Terminal
  console.log("📝 [AUDIT LOG RECORDED]:", JSON.stringify(entry, null, 2));
  return { savedToDb: false };
}