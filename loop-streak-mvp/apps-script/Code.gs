/**
 * Loop 🔥 — Google Apps Script backend
 *
 * The Vercel relay (api/relay.js) POSTs JSON here:
 *   { secret, token, action, ...params }
 *
 * Actions: state, share, read, react
 *
 * First-time setup: edit PEOPLE below, then run `setup` from the editor.
 * See README.md for the full walkthrough.
 */

// ── Configuration ─────────────────────────────────────────────────────────────

/** The two people using Loop. Edit the names BEFORE running setup(). */
const PEOPLE = [
  { id: 'nouman', name: 'Nouman' },
  { id: 'friend', name: 'Friend' },
];

/** Shared timezone: decides when a "day" starts and ends for the streak. */
const TZ = 'Asia/Dubai';

const REACTIONS = ['😂', '❤️', '💀', '😭', '🔥', '😍'];
const MAX_NOTE_LENGTH = 140;
const INBOX_LIMIT = 100;

const SHEETS = {
  Users: ['id', 'name', 'token', 'createdAt'],
  Videos: ['id', 'url', 'canonicalUrl', 'sender', 'recipient', 'note',
    'title', 'author', 'thumbnail', 'sentAt', 'day', 'clientId'],
  Reactions: ['videoId', 'userId', 'emoji', 'reactedAt'],
  Reads: ['videoId', 'userId', 'readAt'],
  DailyActivity: ['day', 'userId', 'count', 'firstSentAt', 'lastSentAt', 'dayComplete'],
};

// ── One-time setup (run manually from the Apps Script editor) ────────────────

/**
 * Creates the tabs, the two users with their access tokens, and the relay
 * secret. Safe to run again: it only adds what is missing.
 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open this script from the Google Sheet (Extensions → Apps Script).');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());

  Object.keys(SHEETS).forEach(function (name) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    const headers = SHEETS[name];
    // Plain-text format stops Sheets from turning dates/IDs into other types.
    sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  });

  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
    ss.deleteSheet(defaultSheet);
  }

  const existing = readTable_('Users');
  PEOPLE.forEach(function (p) {
    if (!existing.some(function (u) { return u.id === p.id; })) {
      appendRow_('Users', { id: p.id, name: p.name, token: newSecret_(), createdAt: nowIso_() });
    }
  });

  if (!props.getProperty('RELAY_SECRET')) props.setProperty('RELAY_SECRET', newSecret_());
  showConfig();
}

/** Prints the relay secret and both access tokens to the execution log. */
function showConfig() {
  const props = PropertiesService.getScriptProperties();
  Logger.log('RELAY_SECRET (put this in Vercel): ' + props.getProperty('RELAY_SECRET'));
  readTable_('Users').forEach(function (u) {
    Logger.log('Access token for ' + u.name + ' (' + u.id + '): ' + u.token);
  });
}

/** Replaces one person's access token, e.g. if it leaked. Edit the id and run. */
function rotateToken() {
  const userId = PEOPLE[1].id;
  const sheet = sheet_('Users');
  const rows = readTable_('Users');
  const i = rows.findIndex(function (u) { return u.id === userId; });
  if (i < 0) throw new Error('No user ' + userId);
  const token = newSecret_();
  sheet.getRange(i + 2, SHEETS.Users.indexOf('token') + 1).setValue(token);
  Logger.log('New token for ' + userId + ': ' + token);
}

/** Recomputes the DailyActivity tab from the Videos tab (repair tool). */
function rebuildDailyActivity() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = sheet_('DailyActivity');
    if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, SHEETS.DailyActivity.length).clearContent();
    const users = readTable_('Users').map(function (u) { return u.id; });
    const stats = {};
    readTable_('Videos').forEach(function (v) {
      const key = v.day + '|' + v.sender;
      const s = stats[key] || (stats[key] = { day: v.day, userId: v.sender, count: 0, firstSentAt: v.sentAt, lastSentAt: v.sentAt });
      s.count++;
      if (v.sentAt < s.firstSentAt) s.firstSentAt = v.sentAt;
      if (v.sentAt > s.lastSentAt) s.lastSentAt = v.sentAt;
    });
    const rows = Object.keys(stats).sort().map(function (k) { return stats[k]; });
    rows.forEach(function (r) {
      r.dayComplete = users.every(function (u) { return stats[r.day + '|' + u]; }) ? 'TRUE' : 'FALSE';
      appendRow_('DailyActivity', r);
    });
  } finally {
    lock.releaseLock();
  }
}

// ── HTTP entry points ─────────────────────────────────────────────────────────

/** Health check: opening the web-app URL in a browser shows {"ok":true}. */
function doGet() {
  return json_({ ok: true, app: 'loop' });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('RELAY_SECRET');
    if (!secret || body.secret !== secret) fail_(401, 'bad_secret', 'Relay secret mismatch.');

    const me = authenticate_(body.token);
    const handler = ACTIONS[body.action];
    if (!handler) fail_(400, 'bad_action', 'Unknown action.');
    return json_({ ok: true, data: handler(me, body) });
  } catch (err) {
    if (err && err.status) return json_({ ok: false, status: err.status, code: err.code, error: err.message });
    console.error(err && err.stack || err);
    return json_({ ok: false, status: 500, code: 'server_error', error: 'Something went wrong. Try again.' });
  }
}

const ACTIONS = {
  state: function (me) {
    return buildState_(me);
  },
  share: function (me, body) {
    return withLock_(function () { return share_(me, body); });
  },
  read: function (me, body) {
    return withLock_(function () { return markRead_(me, body.videoId); });
  },
  react: function (me, body) {
    return withLock_(function () { return react_(me, body.videoId, body.emoji); });
  },
};

// ── Actions ───────────────────────────────────────────────────────────────────

function share_(me, body) {
  const friend = friendOf_(me);
  const rawUrl = extractTikTokUrl_(body.url);
  if (!rawUrl) fail_(400, 'bad_url', 'That doesn\'t look like a TikTok link.');
  const clientId = String(body.clientId || '').slice(0, 64);
  const videos = readTable_('Videos');

  // Same request retried (double tap, flaky network): return the original.
  if (clientId) {
    const retry = videos.find(function (v) { return v.sender === me.id && v.clientId === clientId; });
    if (retry) return buildState_(me, { sharedId: retry.id, duplicate: true });
  }

  const canonicalUrl = resolveTikTokUrl_(rawUrl);
  const dupe = videos.find(function (v) {
    return v.sender === me.id && v.recipient === friend.id &&
      (v.url === rawUrl || v.canonicalUrl === canonicalUrl);
  });
  if (dupe) fail_(409, 'duplicate', 'You already sent this TikTok to ' + friend.name + '.');

  const meta = fetchOEmbed_(canonicalUrl);
  const now = new Date();
  const video = {
    id: Utilities.getUuid(),
    url: rawUrl,
    canonicalUrl: canonicalUrl,
    sender: me.id,
    recipient: friend.id,
    note: cleanText_(body.note, MAX_NOTE_LENGTH),
    title: cleanText_(meta.title, 200),
    author: cleanText_(meta.author_name, 80),
    thumbnail: /^https:\/\//.test(meta.thumbnail_url || '') ? meta.thumbnail_url : '',
    sentAt: now.toISOString(),
    day: dayKey_(now),
    clientId: clientId,
  };
  appendRow_('Videos', video);
  recordActivity_(me.id, video.day, video.sentAt);
  notify_(friend, me, video);
  return buildState_(me, { sharedId: video.id });
}

function markRead_(me, videoId) {
  const video = findVideo_(videoId);
  if (video.recipient !== me.id) fail_(403, 'forbidden', 'Only the recipient can open this.');
  const already = readTable_('Reads').some(function (r) { return r.videoId === video.id && r.userId === me.id; });
  if (!already) appendRow_('Reads', { videoId: video.id, userId: me.id, readAt: nowIso_() });
  return { videoId: video.id };
}

/** Sets a reaction; sending the same emoji again removes it. */
function react_(me, videoId, emoji) {
  const video = findVideo_(videoId);
  if (video.recipient !== me.id) fail_(403, 'forbidden', 'Only the recipient can react.');
  if (emoji && REACTIONS.indexOf(emoji) < 0) fail_(400, 'bad_emoji', 'Unsupported reaction.');

  const sheet = sheet_('Reactions');
  const rows = readTable_('Reactions');
  const i = rows.findIndex(function (r) { return r.videoId === video.id && r.userId === me.id; });
  const current = i >= 0 ? rows[i].emoji : '';
  const next = emoji && emoji !== current ? emoji : '';

  if (i >= 0) sheet.deleteRow(i + 2);
  if (next) appendRow_('Reactions', { videoId: video.id, userId: me.id, emoji: next, reactedAt: nowIso_() });

  // Reacting implies the video was opened.
  if (!readTable_('Reads').some(function (r) { return r.videoId === video.id && r.userId === me.id; })) {
    appendRow_('Reads', { videoId: video.id, userId: me.id, readAt: nowIso_() });
  }
  return { videoId: video.id, emoji: next };
}

// ── State, streak and inbox ───────────────────────────────────────────────────

function buildState_(me, extra) {
  const users = readTable_('Users');
  const friend = friendOf_(me, users);
  const names = {};
  users.forEach(function (u) { names[u.id] = u.name; });

  const now = new Date();
  const today = dayKey_(now);
  const activity = readTable_('DailyActivity');
  const streak = computeStreak_(activity, [me.id, friend.id], today);
  const sentToday = function (userId) {
    const row = activity.find(function (a) { return a.day === today && a.userId === userId; });
    return row ? Number(row.count) || 0 : 0;
  };

  const reads = {};
  readTable_('Reads').forEach(function (r) { reads[r.videoId + '|' + r.userId] = r.readAt; });
  const reactions = {};
  readTable_('Reactions').forEach(function (r) { reactions[r.videoId + '|' + r.userId] = r.emoji; });

  const videos = readTable_('Videos')
    .filter(function (v) { return v.sender === me.id || v.recipient === me.id; })
    .sort(function (a, b) { return a.sentAt < b.sentAt ? 1 : -1; });

  const items = videos.slice(0, INBOX_LIMIT).map(function (v) {
    return {
      id: v.id,
      url: v.url,
      direction: v.sender === me.id ? 'out' : 'in',
      senderName: names[v.sender] || v.sender,
      recipientName: names[v.recipient] || v.recipient,
      note: v.note,
      title: v.title,
      author: v.author,
      thumbnail: v.thumbnail,
      sentAt: v.sentAt,
      readAt: reads[v.id + '|' + v.recipient] || null,
      reaction: reactions[v.id + '|' + v.recipient] || null,
    };
  });
  const unread = videos.filter(function (v) {
    return v.recipient === me.id && !reads[v.id + '|' + me.id];
  }).length;

  const state = {
    me: { id: me.id, name: me.name },
    friend: { id: friend.id, name: friend.name },
    timezone: TZ,
    today: today,
    dayEndsAt: dayEnd_(today).toISOString(),
    serverTime: now.toISOString(),
    streak: {
      current: streak.current,
      best: streak.best,
      todayComplete: streak.todayComplete,
      mySentToday: sentToday(me.id),
      friendSentToday: sentToday(friend.id),
    },
    unread: unread,
    reactionOptions: REACTIONS,
    videos: items,
  };
  if (extra) Object.keys(extra).forEach(function (k) { state[k] = extra[k]; });
  return state;
}

/**
 * A day counts when every person sent at least one TikTok that day.
 * The current streak ends today if today is already complete, otherwise
 * yesterday (today is still in progress and doesn't break it yet).
 */
function computeStreak_(activity, userIds, today) {
  const sentBy = {};
  activity.forEach(function (a) {
    if ((Number(a.count) || 0) > 0) (sentBy[a.day] = sentBy[a.day] || {})[a.userId] = true;
  });
  const complete = function (day) {
    return !!sentBy[day] && userIds.every(function (u) { return sentBy[day][u]; });
  };

  const todayComplete = complete(today);
  let current = 0;
  for (let d = todayComplete ? today : shiftDay_(today, -1); complete(d); d = shiftDay_(d, -1)) current++;

  let best = 0;
  let run = 0;
  let prev = null;
  Object.keys(sentBy).filter(complete).sort().forEach(function (d) {
    run = prev && shiftDay_(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  });
  return { current: current, best: Math.max(best, current), todayComplete: todayComplete };
}

function recordActivity_(userId, day, sentAt) {
  const sheet = sheet_('DailyActivity');
  const cols = SHEETS.DailyActivity;
  const rows = readTable_('DailyActivity');
  const i = rows.findIndex(function (a) { return a.day === day && a.userId === userId; });
  if (i >= 0) {
    const row = rows[i];
    sheet.getRange(i + 2, cols.indexOf('count') + 1).setValue(String((Number(row.count) || 0) + 1));
    sheet.getRange(i + 2, cols.indexOf('lastSentAt') + 1).setValue(sentAt);
  } else {
    appendRow_('DailyActivity', { day: day, userId: userId, count: '1', firstSentAt: sentAt, lastSentAt: sentAt, dayComplete: 'FALSE' });
  }

  // Mark the day complete on every row for that day once everyone has sent.
  const fresh = readTable_('DailyActivity');
  const users = readTable_('Users').map(function (u) { return u.id; });
  const done = users.every(function (u) {
    return fresh.some(function (a) { return a.day === day && a.userId === u && Number(a.count) > 0; });
  });
  fresh.forEach(function (a, idx) {
    if (a.day === day) sheet.getRange(idx + 2, cols.indexOf('dayComplete') + 1).setValue(done ? 'TRUE' : 'FALSE');
  });
}

// ── Notifications (Phase 3) ───────────────────────────────────────────────────

/**
 * Phase 3 hook: send a Firebase Cloud Messaging push to `recipient`.
 * It does nothing yet; the app polls for new TikToks until push is set up.
 */
function notify_(recipient, sender, video) {
  // Intentionally empty until Phase 3.
}

// ── TikTok helpers ────────────────────────────────────────────────────────────

/** Finds the first TikTok link in pasted text ("Check this out https://vm.tiktok.com/..."). */
function extractTikTokUrl_(text) {
  const match = String(text || '').match(/https?:\/\/(?:[a-z0-9-]+\.)*tiktok\.com\/[^\s"'<>]*/i);
  if (!match) return null;
  let url = match[0].replace(/[).,!?]+$/, '');
  url = url.replace(/^http:/i, 'https:');
  if (url.length > 500) return null;
  return url;
}

/** Follows short links (vm./vt.tiktok.com) to the full video URL. Best effort. */
function resolveTikTokUrl_(url) {
  const full = /^https:\/\/(?:www\.|m\.)?tiktok\.com\/@[^/]+\/(?:video|photo)\/\d+/i;
  let current = url;
  try {
    for (let hop = 0; hop < 3 && !full.test(current); hop++) {
      const res = UrlFetchApp.fetch(current, { followRedirects: false, muteHttpExceptions: true });
      const code = res.getResponseCode();
      if (code < 300 || code >= 400) break;
      const headers = res.getHeaders();
      const location = headers.Location || headers.location;
      if (!location || !/^https:\/\//i.test(location)) break;
      current = location;
    }
  } catch (err) {
    // Keep whatever we resolved so far.
  }
  const match = current.match(full);
  return match ? match[0] : url;
}

/** Title, author and thumbnail from TikTok's public oEmbed endpoint. Best effort. */
function fetchOEmbed_(url) {
  try {
    const res = UrlFetchApp.fetch('https://www.tiktok.com/oembed?url=' + encodeURIComponent(url), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return {};
    return JSON.parse(res.getContentText()) || {};
  } catch (err) {
    return {};
  }
}

// ── Auth and lookups ──────────────────────────────────────────────────────────

function authenticate_(token) {
  if (!token || typeof token !== 'string') fail_(401, 'no_token', 'Missing access token.');
  const user = readTable_('Users').find(function (u) { return u.token && u.token === token; });
  if (!user) fail_(401, 'bad_token', 'That access token isn\'t valid.');
  return user;
}

function friendOf_(me, users) {
  const friend = (users || readTable_('Users')).find(function (u) { return u.id !== me.id; });
  if (!friend) fail_(500, 'no_friend', 'Only one user exists. Run setup() again.');
  return friend;
}

function findVideo_(videoId) {
  const video = readTable_('Videos').find(function (v) { return v.id === String(videoId || ''); });
  if (!video) fail_(404, 'not_found', 'That TikTok no longer exists.');
  return video;
}

// ── Sheet helpers ─────────────────────────────────────────────────────────────

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) fail_(500, 'not_setup', 'Run setup() in the Apps Script editor first.');
  return SpreadsheetApp.openById(id);
}

const sheetCache_ = {};
function sheet_(name) {
  if (!sheetCache_[name]) {
    const sheet = spreadsheet_().getSheetByName(name);
    if (!sheet) fail_(500, 'not_setup', 'Missing tab "' + name + '". Run setup() again.');
    sheetCache_[name] = sheet;
  }
  return sheetCache_[name];
}

/** Reads a tab as an array of objects keyed by the header row (all values are strings). */
function readTable_(name) {
  const sheet = sheet_(name);
  const lastRow = sheet.getLastRow();
  const headers = SHEETS[name];
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, headers.length).getDisplayValues().map(function (row) {
    const obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

/** Appends a row as plain text so Sheets never reinterprets dates or numbers. */
function appendRow_(name, obj) {
  const row = SHEETS[name].map(function (h) { return obj[h] === undefined || obj[h] === null ? '' : String(obj[h]); });
  const sheet = sheet_(name);
  const r = sheet.getLastRow() + 1;
  if (r > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 200);
  sheet.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);
}

// ── Small utilities ───────────────────────────────────────────────────────────

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) fail_(503, 'busy', 'Loop is busy. Try again in a moment.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function fail_(status, code, message) {
  throw { status: status, code: code, message: message };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function dayKey_(date) {
  return Utilities.formatDate(date, TZ, 'yyyy-MM-dd');
}

/** Moves a yyyy-MM-dd key by whole days (calendar math, timezone-free). */
function shiftDay_(day, delta) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** The moment `day` ends (midnight at the start of the next day) in TZ. */
function dayEnd_(day) {
  return Utilities.parseDate(shiftDay_(day, 1) + ' 00:00:00', TZ, 'yyyy-MM-dd HH:mm:ss');
}

function nowIso_() {
  return new Date().toISOString();
}

function newSecret_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

/** Trims, caps length and neutralises spreadsheet formulas (=, +, -, @). */
function cleanText_(value, max) {
  let s = String(value || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = '\'' + s;
  return s;
}
