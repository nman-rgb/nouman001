// Runs apps-script/Code.gs against an in-memory mock of Sheets and the Apps Script services.
// Covers auth, Dubai-midnight day boundaries, streaks, duplicates, read receipts and reactions.
// Run with: npm test
const fs = require('fs'), vm = require('vm'), assert = require('assert/strict'), crypto = require('crypto');
const code = fs.readFileSync(require('path').join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

let fakeNow = Date.parse('2026-10-10T19:50:00Z'); // 23:50 Dubai
const RealDate = Date;
class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(fakeNow); } static now() { return fakeNow; } }

function makeSheet(name) {
  const rows = []; // array of arrays
  let maxRows = 1000;
  const sh = {
    name, rows,
    getMaxRows: () => maxRows,
    insertRowsAfter: (_, n) => { maxRows += n; },
    getLastRow: () => { let i = rows.length; while (i > 0 && (!rows[i-1] || rows[i-1].every(v => v === '' || v == null))) i--; return i; },
    deleteRow: (r) => { rows.splice(r - 1, 1); },
    setFrozenRows() {},
    getRange(r, c, nr = 1, nc = 1) {
      if (r + nr - 1 > maxRows) throw new Error('out of bounds');
      const range = {
        setNumberFormat: () => range, setFontWeight: () => range,
        setValues(vals) { vals.forEach((row, i) => { rows[r-1+i] = rows[r-1+i] || []; row.forEach((v, j) => { rows[r-1+i][c-1+j] = v; }); }); return range; },
        setValue(v) { rows[r-1] = rows[r-1] || []; rows[r-1][c-1] = v; return range; },
        clearContent() { for (let i = 0; i < nr; i++) if (rows[r-1+i]) for (let j = 0; j < nc; j++) rows[r-1+i][c-1+j] = ''; return range; },
        getDisplayValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { let v = (rows[r-1+i] || [])[c-1+j]; v = v == null ? '' : String(v); if (v.startsWith("'")) v = v.slice(1); row.push(v); } out.push(row); } return out; },
      };
      return range;
    },
  };
  return sh;
}
const sheets = { Sheet1: makeSheet('Sheet1') };
const ss = {
  getId: () => 'SSID',
  getSheetByName: (n) => sheets[n] || null,
  insertSheet: (n) => (sheets[n] = makeSheet(n)),
  getSheets: () => Object.values(sheets),
  deleteSheet: (s) => { delete sheets[s.name]; },
};
const props = {};
let uuid = 0;
const fetchLog = [];
const ctx = {
  Date: FakeDate, console, JSON, Math, String, Number, Object, Array, encodeURIComponent,
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
  Logger: { log: () => {} },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
  UrlFetchApp: { fetch(url, opts) {
    fetchLog.push(url);
    if (url.startsWith('https://vm.tiktok.com/')) return { getResponseCode: () => 301, getHeaders: () => ({ Location: 'https://www.tiktok.com/@cat/video/' + url.replace(/\D/g, '') + '?lang=en' }), getContentText: () => '' };
    if (url.startsWith('https://www.tiktok.com/oembed')) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ title: '=HYPERLINK("x")', author_name: 'cat', thumbnail_url: 'https://p16.tiktokcdn.com/a.jpg' }) };
    throw new Error('unexpected fetch ' + url);
  } },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    formatDate(d, tz, fmt) {
      assert.equal(fmt, 'yyyy-MM-dd');
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    },
    parseDate(s, tz) { assert.equal(tz, 'Asia/Dubai'); return new RealDate(s.replace(' ', 'T') + '+04:00'); },
  },
};
vm.createContext(ctx);
vm.runInContext(code + '\n;globalThis.__t = { setup, doPost, doGet, rebuildDailyActivity, computeStreak_, extractTikTokUrl_ };', ctx);
const T = ctx.__t;

T.setup();
assert.ok(!sheets.Sheet1, 'default sheet removed');
assert.deepEqual(Object.keys(sheets).sort(), ['DailyActivity', 'Reactions', 'Reads', 'Users', 'Videos']);
const users = sheets.Users.rows.slice(1);
assert.equal(users.length, 2);
const [A, B] = users.map(r => r[2]);
assert.equal(A.length, 64);
T.setup(); assert.equal(sheets.Users.rows.length, 3, 'setup idempotent');

const call = (body, secret = props.RELAY_SECRET) => JSON.parse(T.doPost({ postData: { contents: JSON.stringify({ secret, ...body }) } }).text);
const ok = (body) => { const r = call(body); assert.ok(r.ok, JSON.stringify(r)); return r.data; };
const at = (iso) => { fakeNow = Date.parse(iso); };

// Auth
assert.equal(call({ token: A, action: 'state' }, 'nope').status, 401);
assert.equal(call({ token: 'x', action: 'state' }).code, 'bad_token');
assert.equal(call({ action: 'state' }).code, 'no_token');
assert.equal(call({ token: A, action: 'drop' }).code, 'bad_action');
assert.equal(JSON.parse(T.doGet().text).ok, true);

// Empty state
let s = ok({ token: A, action: 'state' });
assert.equal(s.me.id, 'nouman'); assert.equal(s.friend.id, 'friend');
assert.equal(s.streak.current, 0); assert.equal(s.today, '2026-10-10');
assert.equal(s.dayEndsAt, '2026-10-10T20:00:00.000Z');

// URL validation
assert.equal(call({ token: A, action: 'share', url: 'https://youtube.com/x' }).code, 'bad_url');
assert.equal(T.extractTikTokUrl_('look! https://vm.tiktok.com/ZM123/ lol'), 'https://vm.tiktok.com/ZM123/');
assert.equal(T.extractTikTokUrl_('https://evil.com/?x=tiktok.com/a'), null);
assert.equal(T.extractTikTokUrl_('https://tiktok.com.evil.com/a'), null);

// Day 1 (Oct 10 Dubai): A shares at 23:50
s = ok({ token: A, action: 'share', url: 'Watch https://vm.tiktok.com/ZM111/', note: '=1+1', clientId: 'c1' });
assert.equal(s.streak.mySentToday, 1); assert.equal(s.streak.current, 0);
const v1 = s.videos[0];
assert.equal(v1.direction, 'out'); assert.equal(v1.author, 'cat'); assert.equal(v1.note, '=1+1');
assert.equal(sheets.Videos.rows[1][5], "'=1+1", 'formula neutralised');
assert.equal(sheets.Videos.rows[1][2], 'https://www.tiktok.com/@cat/video/111');
assert.equal(sheets.Videos.rows[1][10], '2026-10-10');

// Retry with same clientId -> no new row
s = ok({ token: A, action: 'share', url: 'https://vm.tiktok.com/ZM111/', clientId: 'c1' });
assert.equal(s.duplicate, true); assert.equal(sheets.Videos.rows.length, 2);
// Same video via different short link -> duplicate
assert.equal(call({ token: A, action: 'share', url: 'https://www.tiktok.com/@cat/video/111?is_from_webapp=1', clientId: 'c2' }).code, 'duplicate');

// Midnight: B shares at 00:10 Dubai Oct 11 (20:10Z Oct 10) -> counts for Oct 11
at('2026-10-10T20:10:00Z');
s = ok({ token: B, action: 'share', url: 'https://vm.tiktok.com/ZM222/' });
assert.equal(s.today, '2026-10-11'); assert.equal(s.streak.mySentToday, 1); assert.equal(s.streak.friendSentToday, 0);
assert.equal(s.streak.current, 0, 'Oct 10 incomplete');
assert.equal(s.unread, 1);

// Read receipts & reactions
assert.equal(call({ token: A, action: 'read', videoId: v1.id }).code, 'forbidden', 'sender cannot mark read');
assert.equal(call({ token: A, action: 'react', videoId: v1.id, emoji: '😂' }).code, 'forbidden');
assert.equal(call({ token: B, action: 'react', videoId: v1.id, emoji: '👍' }).code, 'bad_emoji');
assert.equal(call({ token: B, action: 'read', videoId: 'nope' }).code, 'not_found');
ok({ token: B, action: 'read', videoId: v1.id }); ok({ token: B, action: 'read', videoId: v1.id });
assert.equal(sheets.Reads.rows.length, 2, 'read is idempotent');
ok({ token: B, action: 'react', videoId: v1.id, emoji: '😂' });
ok({ token: B, action: 'react', videoId: v1.id, emoji: '🔥' });
s = ok({ token: A, action: 'state' });
let mine = s.videos.find(v => v.id === v1.id);
assert.equal(mine.reaction, '🔥'); assert.ok(mine.readAt);
assert.equal(sheets.Reactions.rows.length, 2, 'one reaction per user');
ok({ token: B, action: 'react', videoId: v1.id, emoji: '🔥' }); // toggle off
assert.equal(ok({ token: A, action: 'state' }).videos.find(v => v.id === v1.id).reaction, null);
assert.equal(ok({ token: B, action: 'state' }).unread, 0);

// Oct 11: A shares too -> day complete, streak 1
at('2026-10-11T10:00:00Z');
s = ok({ token: A, action: 'share', url: 'https://vm.tiktok.com/ZM333/' });
assert.equal(s.streak.current, 1); assert.equal(s.streak.todayComplete, true);
assert.ok(sheets.DailyActivity.rows.slice(1).filter(r => r[0] === '2026-10-11').every(r => r[5] === 'TRUE'));
s = ok({ token: A, action: 'share', url: 'https://vm.tiktok.com/ZM334/' });
assert.equal(s.streak.mySentToday, 2); assert.equal(s.streak.current, 1, 'more videos != more days');

// Oct 12: nobody yet -> streak still 1 (in progress)
at('2026-10-12T08:00:00Z');
s = ok({ token: A, action: 'state' });
assert.equal(s.streak.current, 1); assert.equal(s.streak.todayComplete, false);
// Both send Oct 12 -> 2
ok({ token: A, action: 'share', url: 'https://vm.tiktok.com/ZM444/' });
s = ok({ token: B, action: 'share', url: 'https://vm.tiktok.com/ZM555/' });
assert.equal(s.streak.current, 2);
// Oct 13: only A. Oct 14: streak broken
at('2026-10-13T08:00:00Z'); ok({ token: A, action: 'share', url: 'https://vm.tiktok.com/ZM666/' });
at('2026-10-14T08:00:00Z');
s = ok({ token: A, action: 'state' });
assert.equal(s.streak.current, 0); assert.equal(s.streak.best, 2);
// Oct 14 both -> 1, best stays 2
ok({ token: A, action: 'share', url: 'https://vm.tiktok.com/ZM777/' });
s = ok({ token: B, action: 'share', url: 'https://vm.tiktok.com/ZM888/' });
assert.equal(s.streak.current, 1); assert.equal(s.streak.best, 2);

// Rebuild DailyActivity gives the same streak
const before = JSON.stringify(sheets.DailyActivity.rows.slice(1).map(r => r.slice(0, 3)).sort());
T.rebuildDailyActivity();
const after = JSON.stringify(sheets.DailyActivity.rows.slice(1).filter(r => r[0]).map(r => r.slice(0, 3)).sort());
assert.equal(after, before);
assert.equal(ok({ token: A, action: 'state' }).streak.current, 1);

// Privacy: state only contains the two users' videos, direction correct
s = ok({ token: B, action: 'state' });
assert.ok(s.videos.every(v => (v.direction === 'in') === (v.senderName === 'Nouman')));
assert.ok(!JSON.stringify(s).includes(A) && !JSON.stringify(s).includes(props.RELAY_SECRET), 'no secrets leak');

console.log('All backend tests passed ✔');
