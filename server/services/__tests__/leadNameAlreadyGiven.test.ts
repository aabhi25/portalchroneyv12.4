/**
 * The chatbot must not ask for a name/email the visitor already gave in the chat.
 * Run manually: `npx tsx server/services/__tests__/leadNameAlreadyGiven.test.ts` (no database, no AI calls)
 */
process.env.DATABASE_URL ||= "postgresql://unused@127.0.0.1:1/unused";
const { nameStatedInChat, contactInfoSaidInChat } = await import("../../llamaService");

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); } else console.log(`✓ ${label}`);
}
const u = (content: string) => ({ role: 'user' as const, content, timestamp: new Date() });
const a = (content: string) => ({ role: 'assistant' as const, content, timestamp: new Date() });

expect(nameStatedInChat([u("my name is rahul sharma")]) === "Rahul Sharma", "'my name is rahul sharma'");
expect(nameStatedInChat([u("My name is Priya and I want to know the fees")]) === "Priya", "'my name is Priya and I want…' stops at 'and'");
expect(nameStatedInChat([u("I'm Rahul")]) === "Rahul", "whole message 'I'm Rahul'");
expect(nameStatedInChat([u("hi, I am Anil Kumar")]) === "Anil Kumar", "'hi, I am Anil Kumar'");
expect(nameStatedInChat([u("name: Kavya")]) === "Kavya", "'name: Kavya'");
expect(nameStatedInChat([u("I am interested in the online MBA")]) === null, "'I am interested in…' is not a name");
expect(nameStatedInChat([u("I'm looking for a course")]) === null, "'I'm looking for…' is not a name");
expect(nameStatedInChat([u("I am from Pune")]) === null, "'I am from Pune' is not a name");
expect(nameStatedInChat([u("what is the fee?")]) === null, "a question is not a name");

const cfg: any = { fields: [{ id: 'name', enabled: true, required: true, priority: 1, captureStrategy: 'intent' }, { id: 'email', enabled: true, required: false, priority: 2, captureStrategy: 'intent' }] };
{
  const r = await contactInfoSaidInChat(cfg, null, [u("hi"), a("Hello! How can I help?"), u("my name is Rahul")], "what are the fees?");
  expect(r?.name === "Rahul", "intent-timed name given earlier in chat is recognised", r);
}
{
  const r = await contactInfoSaidInChat(cfg, { name: "Rahul" }, [u("my name is Rahul")], "price?");
  expect(r === null, "nothing to do when the lead already has the name", r);
}
{
  const r = await contactInfoSaidInChat(cfg, { name: "Rahul" }, [u("mail me at rahul@example.com")], "ok");
  expect(r?.email === "rahul@example.com" && !r?.name, "email given in chat is recognised", r);
}
{
  const r = await contactInfoSaidInChat({ fields: [{ id: 'mobile', enabled: true, required: true, priority: 1, captureStrategy: 'intent' }] } as any, null, [u("call me on 9876543210")], "ok");
  expect(r === null, "phone is never inferred from chat (stays with capture_lead / OTP)", r);
}

if (failed > 0) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log("\nAll 'already given' checks passed.");
