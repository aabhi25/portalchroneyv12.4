/**
 * WhatsApp chat history text: a template shows what the person received, a button / list tap
 * shows what they tapped (2026-10-24: the chat showed "[Template: online_mba]" and
 * "[Interactive message]").
 * Run: npx tsx server/services/__tests__/whatsappMessageText.test.ts
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused@127.0.0.1:1/unused'; // never queried here

let failed = 0;
function expect(cond: unknown, label: string, detail?: unknown) {
  if (cond) console.log(`✓ ${label}`);
  else { failed++; console.log(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); }
}

async function main() {
  const { interactiveReplyText, interactiveShape, readableChatText } = await import('../whatsappInteractiveText');
  const { renderTemplateText } = await import('../whatsappSessionService');

  // ── button / list taps ──
  expect(interactiveReplyText({ text: '', button: { text: 'Interested', payload: 'INTERESTED' } }) === 'Interested', 'template quick-reply button (object)');
  expect(interactiveReplyText({ button: '{"payload":"CALL_ME","text":"Call me back"}' }) === 'Call me back', 'template quick-reply button (JSON string)');
  expect(interactiveReplyText({ button: '', interactive: { type: 'button_reply', button_reply: { id: 'b1', title: 'Book counselling' } } }) === 'Book counselling', 'reply button');
  expect(interactiveReplyText({ interactive: '{"type":"list_reply","list_reply":{"id":"l2","title":"MBA – Marketing"}}' }) === 'MBA – Marketing', 'list option (JSON string)');
  expect(interactiveReplyText({ interactive: { type: 'nfm_reply', nfm_reply: { response_json: '{}' } } }) === '[Form submitted]', 'a WhatsApp form reply');
  expect(interactiveReplyText({ text: '', button: '', interactive: '' }) === '' && interactiveReplyText(null) === '', 'nothing readable → empty');
  expect(interactiveShape({ button: { text: 'x', payload: 'y' }, interactive: '' }) === 'button={text,payload} interactive=empty', 'the log gets the shape only, never the text');

  // ── templates ──
  const tpl = { headerType: 'text', headerText: 'Symbiosis Online MBA', bodyText: 'Hi {{1}}, thanks for speaking with us! Here are the details from {{2}}.', footerText: 'Reply STOP to opt out', buttons: [{ text: 'Interested' }, { text: 'Call me back' }] };
  const text = renderTemplateText(tpl, { '1': 'Amit', '2': 'Symbiosis' });
  expect(text === 'Symbiosis Online MBA\n\nHi Amit, thanks for speaking with us! Here are the details from Symbiosis.\n\nReply STOP to opt out\n\n[ Interested ]  [ Call me back ]', 'a template becomes header, filled body, footer and buttons', text);
  expect(renderTemplateText({ bodyText: 'Hi {{1}}!' }, {}, '…') === 'Hi …!' && renderTemplateText({ bodyText: 'Hi {{1}}!' }) === 'Hi {{1}}!', 'a missing value shows "…" for old messages (kept as-is otherwise)');

  // ── old rows ──
  const known = new Map([['online_mba', 'Hi …, thanks for speaking with us!']]);
  expect(readableChatText('[Template: online_mba]', known) === 'Hi …, thanks for speaking with us!' && readableChatText('[Template: gone]', known) === '[Template: gone]', 'an old template row shows the template text (unknown ones unchanged)');
  expect(readableChatText('[Interactive message]', known) === 'Tapped a button in your message' && readableChatText('Hello', known) === 'Hello', 'an old tap row says what it was; other text unchanged');

  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log('\nAll WhatsApp message text checks passed.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
