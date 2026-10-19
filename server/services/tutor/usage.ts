/**
 * AI Tutor — daily minutes per student.
 *
 * A student's day is the calendar date in India (Asia/Kolkata), so the allowance resets at
 * midnight IST for everyone. Usage is added in small increments while a tutor session is
 * active (not while paused); concurrent sessions of one student add up atomically.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { tutorUsageDaily } from "@shared/schema";

/** "YYYY-MM-DD" in Asia/Kolkata for `at`. */
export function istDay(at: Date = new Date()): string {
  // IST has no daylight saving: UTC+05:30 all year.
  const shifted = new Date(at.getTime() + 330 * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** The student key usage is counted under: the signed student id, else the widget visitor. */
export function tutorStudentKey(studentId: string | null | undefined, visitorId: string | null | undefined): string {
  const s = String(studentId ?? "").trim();
  if (s) return `student:${s.slice(0, 120)}`;
  const v = String(visitorId ?? "").trim();
  return `visitor:${(v || "anonymous").slice(0, 120)}`;
}

export async function secondsUsedToday(businessAccountId: string, studentKey: string, at: Date = new Date()): Promise<number> {
  const [row] = await db.select({ s: tutorUsageDaily.secondsUsed }).from(tutorUsageDaily)
    .where(and(eq(tutorUsageDaily.businessAccountId, businessAccountId), eq(tutorUsageDaily.studentKey, studentKey), eq(tutorUsageDaily.day, istDay(at))))
    .limit(1);
  return row?.s ?? 0;
}

/** Seconds left today for this student under a daily allowance of `dailyMinutes`. */
export function remainingSeconds(dailyMinutes: number, usedSeconds: number): number {
  return Math.max(0, Math.round(dailyMinutes * 60) - Math.max(0, usedSeconds));
}

/** Adds `seconds` to today's usage (atomic upsert); returns the new total for today. */
export async function addUsage(businessAccountId: string, studentKey: string, seconds: number, at: Date = new Date()): Promise<number> {
  const add = Math.max(0, Math.round(seconds));
  const day = istDay(at);
  const [row] = await db.insert(tutorUsageDaily)
    .values({ businessAccountId, studentKey, day, secondsUsed: add, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [tutorUsageDaily.businessAccountId, tutorUsageDaily.studentKey, tutorUsageDaily.day],
      set: { secondsUsed: sql`${tutorUsageDaily.secondsUsed} + ${add}`, updatedAt: new Date() },
    })
    .returning({ s: tutorUsageDaily.secondsUsed });
  return row?.s ?? add;
}
