/* Loop 🔥 — frontend */
(() => {
  'use strict';

  const TOKEN_KEY = 'loop.token';
  const POLL_MS = 20000;
  const $ = (id) => document.getElementById(id);

  let state = null;
  let tab = 'in';
  let pollTimer = null;
  let clientId = null; // reused across retries of the same send
  let serverOffset = 0; // server clock minus device clock

  // ── Storage (can throw in private mode) ─────────────────────────────────────
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  // ── API ─────────────────────────────────────────────────────────────────────
  class ApiError extends Error {
    constructor(message, code, status) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }

  async function api(action, params = {}, opts = {}) {
    const token = store.get(TOKEN_KEY);
    let res;
    try {
      res = await fetch('/api/relay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, token, ...params }),
        keepalive: !!opts.keepalive,
      });
    } catch {
      throw new ApiError('You look offline. Check your connection.', 'offline', 0);
    }
    let data = null;
    try { data = await res.json(); } catch { /* handled below */ }
    if (!data || !data.ok) {
      const err = new ApiError((data && data.error) || 'Something went wrong.', data && data.code, res.status);
      if (res.status === 401 && err.code !== 'bad_secret') logout(err.message);
      throw err;
    }
    return data.data;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  let toastTimer;
  function toast(msg, isError = false) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('error', isError);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  function extractTikTokUrl(text) {
    const m = String(text || '').match(/https?:\/\/(?:[a-z0-9-]+\.)*tiktok\.com\/[^\s"'<>]*/i);
    return m ? m[0].replace(/[).,!?]+$/, '') : '';
  }

  function now() { return Date.now() + serverOffset; }

  function timeAgo(iso) {
    const s = Math.max(0, (now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 172800) return 'yesterday';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: state.timezone });
  }

  function clockTime(iso) {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: state.timezone });
  }

  function hostLabel(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'tiktok.com'; }
  }

  // ── Rendering ───────────────────────────────────────────────────────────────
  function render() {
    if (!state) return;
    const { friend, streak } = state;

    $('with-friend').textContent = `with ${friend.name}`;
    $('streak-count').textContent = streak.current;

    const flame = $('flame');
    flame.classList.toggle('cold', streak.current === 0 && !streak.todayComplete);
    flame.classList.toggle('at-risk', streak.current > 0 && !streak.todayComplete);

    const pill = (el, label, count) => {
      el.textContent = count > 0 ? `✓ ${label} · ${count} sent` : `${label} · not yet`;
      el.classList.toggle('done', count > 0);
    };
    pill($('me-status'), 'You', streak.mySentToday);
    pill($('friend-status'), friend.name, streak.friendSentToday);

    renderCountdown();
    $('best-streak').textContent = streak.best > 0 ? `Best streak: ${streak.best} 🔥` : '';

    const badge = $('unread-badge');
    badge.textContent = state.unread;
    badge.hidden = !state.unread;

    const items = state.videos.filter((v) => v.direction === tab);
    const list = $('list');
    list.replaceChildren(...items.map(tab === 'in' ? receivedCard : sentCard));
    const empty = $('empty');
    empty.hidden = items.length > 0;
    empty.textContent = tab === 'in'
      ? `Nothing from ${friend.name} yet. Nudge them! 👀`
      : `You haven't sent anything yet. Paste a TikTok link above.`;

    document.title = state.unread ? `(${state.unread}) Loop` : 'Loop';
  }

  function renderCountdown() {
    if (!state) return;
    const { streak, friend } = state;
    const note = $('streak-note');
    const left = Math.max(0, new Date(state.dayEndsAt).getTime() - now());
    const hrs = Math.floor(left / 3600000);
    const mins = Math.floor((left % 3600000) / 60000);
    const when = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;

    note.classList.remove('warn');
    if (streak.todayComplete) {
      note.textContent = 'Today’s done ✨ See you tomorrow.';
    } else if (!streak.mySentToday && !streak.friendSentToday) {
      note.textContent = streak.current ? `Both of you still need to send · ${when} left` : 'Both send a TikTok today to start a streak.';
      if (streak.current) note.classList.add('warn');
    } else if (!streak.mySentToday) {
      note.textContent = `Your turn! Send one in the next ${when}.`;
      note.classList.add('warn');
    } else {
      note.textContent = `Waiting on ${friend.name} · ${when} left`;
    }

    // The day rolled over while the app was open: fetch the new day.
    if (left === 0) refresh();
  }

  function thumb(v, onOpen) {
    const a = h('a', { class: 'thumb', href: v.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Watch on TikTok', onclick: onOpen }, '▶');
    if (v.thumbnail) {
      const img = h('img', { src: v.thumbnail, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => img.remove());
      a.append(img);
    }
    return a;
  }

  function receivedCard(v) {
    const open = () => markRead(v);
    const reactions = h('div', { class: 'reactions', role: 'group', 'aria-label': 'React' },
      state.reactionOptions.map((e) => h('button', {
        type: 'button',
        class: v.reaction === e ? 'picked' : null,
        'aria-pressed': v.reaction === e ? 'true' : 'false',
        'aria-label': `React ${e}`,
        onclick: () => react(v, e),
      }, e)));

    return h('article', { class: `card${v.readAt ? '' : ' unread'}` },
      thumb(v, open),
      h('div', { class: 'card-body' },
        h('div', { class: 'meta' }, v.readAt ? null : h('span', { class: 'dot', 'aria-label': 'New' }),
          `From ${v.senderName} · ${timeAgo(v.sentAt)}`),
        h('div', { class: 'title' }, v.title || (v.author ? `@${v.author}` : hostLabel(v.url))),
        v.note ? h('div', { class: 'note' }, v.note) : null,
        h('div', { class: 'row' },
          h('a', { class: 'watch', href: v.url, target: '_blank', rel: 'noopener noreferrer', onclick: open }, 'Watch ▶')),
        reactions));
  }

  function sentCard(v) {
    const receipt = v.readAt
      ? h('span', { class: 'receipt seen' }, `✓✓ Seen ${clockTime(v.readAt)}`)
      : h('span', { class: 'receipt' }, '✓ Delivered');
    return h('article', { class: 'card' },
      thumb(v),
      h('div', { class: 'card-body' },
        h('div', { class: 'meta' }, `To ${v.recipientName} · ${timeAgo(v.sentAt)}`),
        h('div', { class: 'title' }, v.title || (v.author ? `@${v.author}` : hostLabel(v.url))),
        v.note ? h('div', { class: 'note' }, v.note) : null,
        h('div', { class: 'row' }, receipt,
          v.reaction ? h('span', { class: 'their-reaction', 'aria-label': `${v.recipientName} reacted ${v.reaction}` }, v.reaction) : null)));
  }

  // ── Actions ─────────────────────────────────────────────────────────────────
  function applyState(next) {
    state = next;
    serverOffset = new Date(next.serverTime).getTime() - Date.now();
    render();
  }

  async function refresh() {
    if (!store.get(TOKEN_KEY)) return;
    try {
      applyState(await api('state'));
    } catch (err) {
      if (err.status !== 401) console.warn(err);
    }
  }

  function markRead(v) {
    if (v.readAt) return;
    v.readAt = new Date(now()).toISOString();
    state.unread = Math.max(0, state.unread - 1);
    render();
    api('read', { videoId: v.id }, { keepalive: true }).catch((err) => console.warn(err));
  }

  async function react(v, emoji) {
    const before = { reaction: v.reaction, readAt: v.readAt, unread: state.unread };
    v.reaction = v.reaction === emoji ? null : emoji;
    if (!v.readAt) {
      v.readAt = new Date(now()).toISOString();
      state.unread = Math.max(0, state.unread - 1);
    }
    render();
    try {
      await api('react', { videoId: v.id, emoji });
    } catch (err) {
      Object.assign(v, { reaction: before.reaction, readAt: before.readAt });
      state.unread = before.unread;
      render();
      toast(err.message, true);
    }
  }

  async function share(e) {
    e.preventDefault();
    const url = extractTikTokUrl($('url-input').value);
    if (!url) {
      toast('Paste a TikTok link first (TikTok → Share → Copy link).', true);
      $('url-input').focus();
      return;
    }
    const btn = $('send-btn');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    clientId = clientId || (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
    try {
      const next = await api('share', { url, note: $('note-input').value.trim(), clientId });
      clientId = null;
      $('url-input').value = '';
      $('note-input').value = '';
      setTab('out');
      applyState(next);
      toast(next.streak.todayComplete ? `Sent! Streak: ${next.streak.current} 🔥` : `Sent to ${next.friend.name} 🚀`);
    } catch (err) {
      if (err.code === 'duplicate' || err.code === 'bad_url') clientId = null;
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send TikTok';
    }
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      const url = extractTikTokUrl(text);
      if (url) {
        $('url-input').value = url;
        clientId = null;
      } else {
        toast('No TikTok link on your clipboard.', true);
      }
    } catch {
      $('url-input').focus();
      toast('Long-press the box and tap Paste.');
    }
  }

  function setTab(next) {
    tab = next;
    document.querySelectorAll('.tab').forEach((b) => {
      const on = b.dataset.tab === next;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    render();
  }

  // ── Session ─────────────────────────────────────────────────────────────────
  async function login(e) {
    e.preventDefault();
    const token = $('token-input').value.trim();
    const errEl = $('login-error');
    errEl.hidden = true;
    if (!token) return;
    store.set(TOKEN_KEY, token);
    const btn = e.submitter || $('login-form').querySelector('button');
    btn.disabled = true;
    try {
      applyState(await api('state'));
      showApp();
    } catch (err) {
      store.del(TOKEN_KEY);
      errEl.textContent = err.message;
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  function logout(message) {
    store.del(TOKEN_KEY);
    state = null;
    stopPolling();
    $('app').hidden = true;
    $('login').hidden = false;
    $('token-input').value = '';
    const errEl = $('login-error');
    errEl.textContent = message || '';
    errEl.hidden = !message;
  }

  function showApp() {
    $('login').hidden = true;
    $('app').hidden = false;
    startPolling();
    const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    $('install-hint').hidden = !(isIOS && !standalone && !store.get('loop.hideInstall'));
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
      else renderCountdown();
    }, POLL_MS);
  }

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  /** Prefill from ?url= / ?text= (Web Share Target, iOS Shortcut, bookmarklet). */
  function readSharedLink() {
    const params = new URLSearchParams(location.search);
    const url = extractTikTokUrl([params.get('url'), params.get('text'), params.get('title')].join(' '));
    if (params.toString()) history.replaceState(null, '', '/');
    if (url) $('url-input').value = url;
    return url;
  }

  // ── Boot ────────────────────────────────────────────────────────────────────
  async function boot() {
    $('login-form').addEventListener('submit', login);
    $('share-form').addEventListener('submit', share);
    $('paste-btn').addEventListener('click', pasteFromClipboard);
    $('url-input').addEventListener('input', () => { clientId = null; });
    document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

    const menu = $('menu');
    const menuBtn = $('menu-btn');
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      menuBtn.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', () => { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); });
    $('refresh-btn').addEventListener('click', () => refresh().then(() => toast('Up to date')));
    $('logout-btn').addEventListener('click', () => logout());
    $('install-dismiss').addEventListener('click', () => {
      store.set('loop.hideInstall', '1');
      $('install-hint').hidden = true;
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state) refresh();
    });

    const shared = readSharedLink();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('SW failed', err));
    }

    if (store.get(TOKEN_KEY)) {
      try {
        applyState(await api('state'));
        showApp();
        if (shared) $('note-input').focus();
      } catch (err) {
        if (err.status === 401) { /* logout() already showed the login screen */ }
        else {
          // Backend unreachable: still show the app shell so the user can retry.
          showApp();
          toast(err.message, true);
        }
      }
    } else {
      logout();
    }
    $('splash').hidden = true;
  }

  boot();
})();
