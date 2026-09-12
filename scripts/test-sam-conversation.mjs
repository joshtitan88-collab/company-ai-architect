import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import handler from '../api/sam-chat.js';
const require = createRequire(import.meta.url);
const Sam = require('../desk-nlu.js');
function response() { return { code: 200, setHeader() {}, status(n) { this.code=n; return this; }, json(body) { this.body=body; return this; }, end() {} }; }
const offline = { offline: true, slots: [] };
let s = Sam.createSession();
Sam.greetingTurn(s);
let t = await Sam.turn(s, 'I run a plumbing company and miss after-hours calls. Show me a demo.', offline);
assert.equal(t.intent, 'demo'); assert.equal(t.action, 'none'); assert.equal(t.phase, 'idle');
assert.match(t.reply, /plumbing team/); assert.match(t.reply, /repair request/);
for (const message of ['A repair', 'My sink is leaking', 'Alex, tomorrow afternoon']) {
  t = await Sam.turn(s, message, offline);
  assert.equal(t.intent, 'demo'); assert.equal(t.action, 'none');
  assert.equal(t.booking.name, ''); assert.equal(t.booking.slotIso, '');
}
assert.match(t.reply, /sample intake/); assert.match(t.reply, /My sink is leaking/);
assert.match(t.reply, /no real appointment/); assert.equal(s.demo, null);
console.log('PASS multi-turn plumbing demo answers caller and cannot create real intake');

s=Sam.createSession(); Sam.greetingTurn(s);
t=await Sam.turn(s, 'I am interested in AI, from Example Plumbing. We miss after-hours calls.', offline);
assert.notEqual(t.intent,'book'); assert.equal(t.action,'none'); assert.equal(s.phase,'idle'); assert.equal(s.booking.name,'');
t=await Sam.turn(s,'Can you answer calls and schedule appointments?',offline);
assert.equal(t.action,'none'); assert.match(t.reply,/needs a connected phone system/);
t=await Sam.turn(s,'How much does the audit cost?',offline);
assert.match(t.reply,/fifteen hundred/); assert.match(t.reply,/forty-five hundred/); assert.equal(t.action,'show_packages');
t=await Sam.turn(s,'Where is my data stored?',offline);
assert.match(t.reply,/hosted services/); assert.match(t.reply,/AI provider/);
console.log('PASS pain is not booking consent; fixed prices, capability boundaries and truthful privacy');

// A topic switch during booking must answer and preserve the existing draft.
s=Sam.createSession(); Sam.greetingTurn(s);
const slot={iso:'2035-10-08T14:00:00.000Z',start:Date.parse('2035-10-08T14:00:00.000Z')};
Sam.selectSlot(s,slot);
t=await Sam.turn(s,'Can you connect to ServiceTitan?',offline);
assert.equal(t.action,'none'); assert.equal(s.phase,'awaiting_name'); assert.equal(s.booking.name,'');
assert.match(t.reply,/permissions/); assert.equal(s.booking.slotIso,slot.iso);
for (const line of ['Ada Lovelace','ada@example.test','Example Plumbing']) t=await Sam.turn(s,line,offline);
assert.equal(s.phase,'confirming');
t=await Sam.turn(s,'yes',offline);
assert.equal(t.action,'submit_book'); assert.equal(s.phase,'submitting'); assert.doesNotMatch(t.reply,/confirmed|on the book/);
const originalFetch=global.fetch;
global.fetch=async()=>({ok:false,json:async()=>({error:'slot_taken'})});
t=await Sam.submitBook(s); assert.equal(s.phase,'confirming'); assert.doesNotMatch(t.reply,/is confirmed/);
global.fetch=async()=>({ok:true,json:async()=>({ok:true,id:'test',status:'confirmed'})});
t=await Sam.submitBook(s); assert.equal(t.action,'booked'); assert.match(t.reply,/booking is confirmed/);
global.fetch=originalFetch;
console.log('PASS booking topic repair, failed booking retry and confirmation only after server success');

process.env.SAM_DISABLE_OLLAMA='1';
delete process.env.XAI_API_KEY; delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY;
for(const message of ['Show me a plumbing demo','How much does it cost?','Can you connect to HubSpot?']) {
 const res=response(); await handler({method:'POST',body:{message}},res);
 assert.equal(res.code,200); assert.equal(res.body.ok,true); assert.equal(res.body.source,'company-knowledge');
}
// Model output is untrusted: neither its action nor a fabricated time is execution.
process.env.XAI_API_KEY='test';
global.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({intent:'book',reply:'We can explore the process together.',action:'show_calendar',extract:{slotIso:'2035-01-01T00:00:00Z'}})}}]})});
let res=response(); await handler({method:'POST',body:{message:'Tell me about your process',slotHints:[]}},res);
assert.equal(res.body.action,'none'); assert.equal(res.body.extract.slotIso,'');
global.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({intent:'contact',reply:"I've sent your message.",action:'none',extract:{}})}}]})});
res=response(); await handler({method:'POST',body:{message:'Tell me about your process'}},res);
assert.doesNotMatch(res.body.reply,/I've sent/);
global.fetch=originalFetch; delete process.env.XAI_API_KEY;
console.log('PASS API useful without providers, prevents invented slots and premature success');
console.log('ALL SAM CONVERSATION TESTS PASSED');

s = Sam.createSession(); Sam.greetingTurn(s);
t = await Sam.turn(s, 'I want to book a free discovery call', offline);
assert.equal(t.intent, 'book');
assert.equal(t.action, 'show_calendar');
assert.equal(s.phase, 'awaiting_slot');
assert.doesNotMatch(t.reply, /needs a connected phone system/);
s = Sam.createSession(); Sam.greetingTurn(s);
await Sam.turn(s, 'Show me a plumbing demo', offline);
await Sam.turn(s, 'A repair', offline);
await Sam.turn(s, 'My sink is leaking', offline);
t = await Sam.turn(s, 'For the demonstration, Alex, tomorrow afternoon', offline);
assert.match(t.reply, /sample intake/);
assert.equal(s.demo, null);
await Sam.turn(s, 'Show me a plumbing demo', offline);
t = await Sam.turn(s, 'I want to book a free discovery call', offline);
assert.equal(t.action, 'show_calendar');
assert.equal(s.demo, null);
console.log('PASS booking CTA opens the calendar and incidental demo wording preserves roleplay');

s = Sam.createSession(); Sam.greetingTurn(s);
await Sam.turn(s, 'I want to book a free discovery call', offline);
assert.equal(s.phase, 'awaiting_slot');
await Sam.turn(s, 'Show me a plumbing demo', offline);
assert.equal(s.phase, 'idle', 'Roleplay leaves real booking collection');
for (const line of ['A repair', 'My sink is leaking', 'Alex, tomorrow afternoon']) await Sam.turn(s, line, offline);
t = await Sam.turn(s, 'I am just browsing.', offline);
assert.match(t.reply, /take your time/);
assert.equal(t.action, 'none');
assert.equal(s.phase, 'idle');
await Sam.turn(s, 'I want to book a free discovery call', offline);
t = await Sam.turn(s, 'I am just browsing.', offline);
assert.equal(s.phase, 'idle');
assert.equal(t.action, 'none');
console.log('PASS switching from booking into demos or browsing cannot reopen stale intake');
