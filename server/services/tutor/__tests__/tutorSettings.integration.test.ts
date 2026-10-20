/**
 * AI Tutor — settings, daily usage and the lesson-plan cache against a real (local) database.
 * Run: TUTOR_TEST_DB=1 DATABASE_URL=postgres://…@127.0.0.1:…/… npx tsx server/services/tutor/__tests__/tutorSettings.integration.test.ts
 */
import crypto from "crypto";

const url = process.env.DATABASE_URL || "";
if (process.env.TUTOR_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.log("Skipped: set TUTOR_TEST_DB=1 and a local DATABASE_URL.");
  process.exit(0);
}

let failed = 0;
function expect(cond: unknown, label: string, detail?: unknown) {
  if (cond) console.log(`✓ ${label}`);
  else { failed++; console.log(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); }
}

async function main() {
  const { db } = await import("../../../db");
  const schema = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { getTutorSettings, getPublicTutorConfig, updateTutorSettings, TutorSettingsError } = await import("../settings");
  const { addUsage, secondsUsedToday, remainingSeconds } = await import("../usage");
  const { getOutline, getSection } = await import("../lessonPlanner");

  const K12 = `tutor-k12-${crypto.randomUUID()}`;
  const SHOP = `tutor-shop-${crypto.randomUUID()}`;
  await db.insert(schema.businessAccounts).values([
    { id: K12, name: "K12 school", website: "https://school.example.com", k12EducationEnabled: "true" } as any,
    { id: SHOP, name: "A shop", website: "https://shop.example.com" } as any,
  ]);
  try {
    // ── settings ──
    let s = await getTutorSettings(K12);
    expect(!s.exists && !s.enabled && s.dailyMinutesPerStudent === 20, "off by default with 20 minutes per student per day");
    expect((await getPublicTutorConfig(K12)).enabled === false, "the widget sees the tutor off");
    let threw = "";
    try { await updateTutorSettings(SHOP, { enabled: true }, "admin"); } catch (e: any) { threw = e instanceof TutorSettingsError ? e.message : String(e); }
    expect(/K12 \/ TopScholar/.test(threw), "a non-education account cannot switch it on", threw);
    threw = "";
    try { await updateTutorSettings(K12, { dailyMinutesPerStudent: 1 }, "admin"); } catch (e: any) { threw = e.message; }
    expect(/at least 5/.test(threw), "minutes below 5 are refused", threw);
    threw = "";
    try { await updateTutorSettings(K12, { enabled: true, extra: 1 }, "admin"); } catch (e: any) { threw = e.message; }
    expect(!!threw, "unknown fields are refused");
    const saved = await updateTutorSettings(K12, { enabled: true, dailyMinutesPerStudent: 15 }, "admin-1");
    expect(saved.settings.enabled && saved.settings.dailyMinutesPerStudent === 15 && saved.changed.sort().join() === "dailyMinutesPerStudent,enabled", "saving records what changed", saved.changed);
    expect((await getPublicTutorConfig(K12)).enabled === true, "the widget now sees the tutor on");
    const again = await updateTutorSettings(K12, { enabled: true }, "admin-1");
    expect(again.changed.length === 0, "saving the same value changes nothing");

    // ── daily usage ──
    const key = "student:S-1";
    await Promise.all(Array.from({ length: 10 }, () => addUsage(K12, key, 15)));
    const used = await secondsUsedToday(K12, key);
    expect(used === 150, "parallel usage updates add up exactly", used);
    expect(remainingSeconds(15, used) === 750, "15 minutes minus 150 s leaves 750 s");
    expect(await secondsUsedToday(K12, "student:S-2") === 0, "another student starts at zero");
    const yesterday = new Date(Date.now() - 24 * 3600_000);
    await addUsage(K12, key, 60, yesterday);
    expect(await secondsUsedToday(K12, key) === 150, "yesterday's minutes don't count today");

    // ── lesson plan cache ──
    const pack: any = {
      businessAccountId: K12, cpIds: ["cp1"], chapter: "Triangles", chapterNorm: "triangles", versionKey: "v1", cpIdsHash: "h1",
      sources: [{ id: "c1", type: "note", title: "Right triangles", concept: null, text: "A right triangle has a 90 degree angle. Its longest side is the hypotenuse." }],
      questions: [{ id: "q1", text: "The longest side of a right triangle is", options: [{ text: "hypotenuse", isCorrect: true }, { text: "base", isCorrect: false }], solution: null, difficulty: null, concept: null, questionType: null }],
      media: [],
    };
    let calls = 0;
    const complete = async (system: string) => {
      calls++;
      if (system.includes("You plan a short lesson")) {
        return JSON.stringify({ title: "Right triangles", intro: ["Hi!"], sections: [{ title: "The hypotenuse", sourceIds: ["c1"], questionIds: ["q1"] }], recap: ["Remember the hypotenuse."] });
      }
      return JSON.stringify({ lines: [{ say: "A right triangle has one square corner.", ops: [{ op: "clear" }, { op: "write", id: "t", text: "Right triangles", style: "title" }] }, { say: "The longest side is the hypotenuse.", ops: [{ op: "write", id: "h", text: "hypotenuse = longest side" }] }], simpler: [{ say: "Think of a slide.", ops: [] }] });
    };
    const o1 = await getOutline(pack, "en", complete);
    const o2 = await getOutline(pack, "en", complete);
    expect(calls === 1 && o1.title === o2.title && o2.sections.map((x) => x.id + x.title).join() === o1.sections.map((x) => x.id + x.title).join(), "the outline is made once and then read from the cache", calls);
    await getOutline(pack, "hi", complete);
    expect(calls === 2, "another language is a separate plan");
    await getOutline({ ...pack, versionKey: "v2" }, "en", complete);
    expect(calls === 3, "resynced content (new version) makes a new plan");
    const sec = await getSection(pack, o1, 0, "en", complete);
    await getSection(pack, o1, 0, "en", complete);
    expect(calls === 4 && sec.lines.length === 2 && sec.checks.length === 1 && sec.checks[0].correctIndex === 0, "a section is made once, with its check from the question bank", { calls, checks: sec.checks });

    // ── carrying on from last time ──
    const { prepareVoiceTutor } = await import("../voiceTutor");
    const req = { businessAccountId: K12, conversationId: "c1", visitorId: "v1", scope: { chapter: "Triangles", studentId: "S-9" }, mode: "voice" as const };
    let prep = await prepareVoiceTutor(req);
    expect(prep.continueFrom === null, "a first lesson starts from the plan");
    await db.insert(schema.tutorSessions).values({ businessAccountId: K12, studentKey: "student:S-9", chapter: "triangles ", endReason: "stopped", progress: { part: 2, line: 3, title: "Converse" } } as any);
    prep = await prepareVoiceTutor(req);
    expect(prep.continueFrom?.part === 2 && prep.continueFrom.title === "Converse", "a lesson left part-way is continued (chapter matched loosely)", prep.continueFrom);
    expect((await prepareVoiceTutor({ ...req, fromStart: true })).continueFrom === null, "Start over ignores it");
    expect((await prepareVoiceTutor({ ...req, scope: { chapter: "Triangles", studentId: "S-10" } })).continueFrom === null, "another student's progress is not used");
    await db.insert(schema.tutorSessions).values({ businessAccountId: K12, studentKey: "student:S-9", chapter: "Triangles", endReason: "completed", progress: { part: 5, line: 0 } } as any);
    expect((await prepareVoiceTutor(req)).continueFrom === null, "after finishing the chapter it starts afresh");
    // ── the teacher: name, a voice per language, video ──
    const { tutorVoiceFor } = await import("../settings");
    const bad = async (body: any) => { try { await updateTutorSettings(K12, body, "admin-1"); return ""; } catch (e: any) { return e.message; } };
    expect(/Unknown lesson language/.test(await bad({ voiceByLanguage: { fr: "nova" } })), "a voice for an unknown language is refused");
    expect(/from the list/.test(await bad({ voiceByLanguage: { en: "https://evil.example/voice" } })), "a voice that is not from the list is refused");
    expect(/letters, spaces/.test(await bad({ teacherName: "<script>" })), "a teacher name with markup is refused");
    expect(/avatar id/.test(await bad({ avatarId: "bad id!" })), "a malformed avatar id is refused");
    expect(!!(await bad({ avatarMode: "hologram" })), "an unknown video mode is refused");
    const t = await updateTutorSettings(K12, { teacherName: "  Priya   Ma'am ", voiceByLanguage: { en: "nova", hi: "el:AbCdEfGhIjKlMnOp", hinglish: "" }, avatarMode: "voice", avatarId: "tutor-1" }, "admin-1");
    expect(t.settings.teacherName === "Priya Ma'am" && JSON.stringify(t.settings.voiceByLanguage) === JSON.stringify({ en: "nova", hi: "el:AbCdEfGhIjKlMnOp" }) && t.settings.avatarMode === "voice" && t.settings.avatarId === "tutor-1", "teacher name, voices (empty = default), video mode and avatar are saved", t.settings);
    expect(t.changed.sort().join() === "avatarId,avatarMode,teacherName,voiceByLanguage", "…and audited as changes", t.changed);
    expect((await updateTutorSettings(K12, { voiceByLanguage: { en: "nova", hi: "el:AbCdEfGhIjKlMnOp" } }, "admin-1")).changed.length === 0, "the same voices again change nothing");
    expect(tutorVoiceFor(t.settings, "en") === "nova" && tutorVoiceFor(t.settings, "hinglish") === "el:AbCdEfGhIjKlMnOp" && tutorVoiceFor({ voiceByLanguage: {} }, "hi") === null, "Hinglish falls back to the Hindi voice; none = the widget's voice");
    expect((await getPublicTutorConfig(K12)).video === false, "voice-only: the widget won't start video for lessons");
    // The voice a lesson actually uses.
    let p2 = await prepareVoiceTutor({ ...req, language: "en" });
    expect(p2.voice?.openaiVoice === "nova" && p2.teacherName === "Priya Ma'am", "an English lesson uses the English voice and the teacher's name", p2.voice);
    p2 = await prepareVoiceTutor({ ...req, language: "hinglish" });
    expect(p2.voice === null, "an ElevenLabs voice without the account's ElevenLabs key → the widget's voice", p2.voice);
    await db.update(schema.businessAccounts).set({ elevenlabsApiKey: "el-test-key" } as any).where(eq(schema.businessAccounts.id, K12));
    p2 = await prepareVoiceTutor({ ...req, language: "hinglish" });
    expect(p2.voice?.elevenlabsVoiceId === "AbCdEfGhIjKlMnOp" && p2.voice.elevenlabsApiKey === "el-test-key", "a Hinglish lesson uses the Hindi ElevenLabs voice with the account's key", { id: p2.voice?.elevenlabsVoiceId });
    await updateTutorSettings(K12, { avatarMode: "auto" }, "admin-1");
    expect((await getPublicTutorConfig(K12)).video === true, "video mode back on");

    await updateTutorSettings(K12, { enabled: false }, "admin-1");
    threw = "";
    try { await prepareVoiceTutor(req); } catch (e: any) { threw = e.message; }
    expect(/not switched on/.test(threw), "tutor off: a lesson can't start", threw);
  } finally {
    await db.delete(schema.businessAccounts).where(eq(schema.businessAccounts.id, K12)).catch(() => {});
    await db.delete(schema.businessAccounts).where(eq(schema.businessAccounts.id, SHOP)).catch(() => {});
  }

  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log("\nAll tutor settings / usage / cache checks passed.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
