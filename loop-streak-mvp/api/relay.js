/**
 * Loop 🔥 — Vercel API relay
 *
 * The browser POSTs { action, token, ...params } to /api/relay.
 * This function adds the server-side RELAY_SECRET and forwards the request to
 * the Apps Script web app, so the secret never reaches the phone.
 */

const ACTIONS = new Set(['state', 'share', 'read', 'react']);
const FIELDS = ['action', 'token', 'url', 'note', 'videoId', 'emoji', 'clientId'];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, code: 'method_not_allowed', error: 'Use POST.' });
  }

  const { APPS_SCRIPT_URL, RELAY_SECRET } = process.env;
  if (!APPS_SCRIPT_URL || !RELAY_SECRET) {
    return res.status(500).json({ ok: false, code: 'not_configured', error: 'Server is missing APPS_SCRIPT_URL or RELAY_SECRET.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, code: 'bad_request', error: 'Expected a JSON body.' });
  }
  if (!ACTIONS.has(body.action)) {
    return res.status(400).json({ ok: false, code: 'bad_action', error: 'Unknown action.' });
  }
  if (typeof body.token !== 'string' || !body.token) {
    return res.status(401).json({ ok: false, code: 'no_token', error: 'Missing access token.' });
  }

  // Forward only known string fields.
  const payload = { secret: RELAY_SECRET };
  for (const key of FIELDS) {
    if (typeof body[key] === 'string') payload[key] = body[key].slice(0, 2000);
  }

  let upstream;
  try {
    // Apps Script answers with a 302 to googleusercontent.com; fetch follows it.
    upstream = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: AbortSignal.timeout(28000),
    });
  } catch (err) {
    console.error('Apps Script request failed', err);
    return res.status(504).json({ ok: false, code: 'upstream_unreachable', error: 'Couldn\'t reach the Loop backend. Try again.' });
  }

  const text = await upstream.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // Usually an HTML error page: wrong URL, or the deployment isn't public.
    console.error('Apps Script returned non-JSON', upstream.status, text.slice(0, 300));
    return res.status(502).json({ ok: false, code: 'upstream_invalid', error: 'The Loop backend gave an unexpected answer. Check the Apps Script deployment.' });
  }

  const status = data.ok ? 200 : Number(data.status) || 400;
  return res.status(status).json(data);
}
