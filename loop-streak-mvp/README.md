# Loop 🔥: TikTok friendship streaks

Loop is a private web app for two people. You both send each other at least one TikTok every day to keep a streak going, like a Snapchat streak. It installs on both iPhones from Safari and works like a normal app.

**What it does (Phase 1 + 2):**

- Send a TikTok link with an optional note
- An inbox of everything your friend sent you, and a list of what you sent
- Emoji reactions: 😂 ❤️ 💀 😭 🔥 😍
- Read receipts ("✓ Delivered" turns into "✓✓ Seen 3:42 PM")
- A daily streak with a big flame counter, a "best streak" record and a countdown to midnight (Asia/Dubai)
- Installable on the iPhone Home Screen (PWA), with a dark theme and orange/pink accents
- Auto-refresh every 20 seconds while the app is open. Push notifications come in Phase 3.

---

## How it fits together

```
 iPhone (Loop PWA)  ──POST /api/relay──▶  Vercel (api/relay.js)  ──+secret──▶  Google Apps Script (Code.gs)  ──▶  Google Sheet
   public/*                                hosts the app and                       business logic: auth,              Users, Videos,
                                           hides the secret                        streaks, receipts, reactions       Reactions, Reads,
                                                                                                                      DailyActivity
```

- **Each person has their own access token.** It identifies who is using the app, so no passwords are needed.
- **The relay secret lives only on Vercel and in Apps Script.** Apps Script rejects any request that doesn't include it, so the public Apps Script URL is useless on its own.

```
loop-streak-mvp/
├── api/relay.js              Vercel serverless function (forwards to Apps Script)
├── apps-script/
│   ├── Code.gs               Backend: paste into the Apps Script editor
│   └── appsscript.json       Apps Script manifest (timezone Asia/Dubai, V8)
├── public/                   The PWA Vercel serves
│   ├── index.html  styles.css  app.js
│   ├── manifest.webmanifest  sw.js
│   └── icons/
├── tests/backend.test.cjs    Backend logic tests (npm test)
├── vercel.json  package.json  .env.example
```

---

## What you need

- A Google account (for the Sheet and Apps Script)
- A GitHub account with this repository (`nman-rgb/nouman001`)
- A free Vercel account: sign up at <https://vercel.com> with GitHub
- Two iPhones on iOS 16.4 or newer (needed later for push notifications)

Plan for about 20–30 minutes.

---

## Step 1: Create the Google Sheet and backend

1. Go to <https://sheets.new> and name the spreadsheet **Loop DB**.
2. In the menu, open **Extensions → Apps Script**. A new tab opens with the script editor.
3. Delete everything in `Code.gs` and paste in the contents of [`apps-script/Code.gs`](apps-script/Code.gs).
4. At the top of the file, set the two names:
   ```js
   const PEOPLE = [
     { id: 'nouman', name: 'Nouman' },
     { id: 'friend', name: 'Ahmed' },   // ← your friend's name
   ];
   ```
   Keep the `id` values short and lowercase. Don't change them after setup.
5. Replace the manifest:
   1. Click the ⚙️ **Project Settings** icon on the left.
   2. Tick **Show "appsscript.json" manifest file in editor**.
   3. Go back to the **Editor** (`<>` icon), open `appsscript.json`, and replace its contents with [`apps-script/appsscript.json`](apps-script/appsscript.json).
   4. Save with Ctrl/Cmd + S.
6. Pick **`setup`** in the function dropdown at the top of the editor, then click **Run**.
   - Google asks for permission. Click **Review permissions**, pick your account, then **Advanced → Go to (project name) (unsafe)** → **Allow**. The warning appears because this is your own unverified script, which is normal.
7. When it finishes, open **Execution log** at the bottom. You'll see three lines:
   ```
   RELAY_SECRET (put this in Vercel): 3f9c…
   Access token for Nouman (nouman): a81b…
   Access token for Ahmed (friend): 77de…
   ```
   Copy all three into a private note. You can print them again any time by running **`showConfig`**.

Your Sheet now has five tabs: `Users`, `Videos`, `Reactions`, `Reads` and `DailyActivity`. Don't rename the tabs or their header rows.

## Step 2: Deploy Apps Script as a web app

1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the ⚙️ next to "Select type" and choose **Web app**.
3. Fill in:
   - **Description:** `Loop v1`
   - **Execute as:** **Me**
   - **Who has access:** **Anyone**. This is required so Vercel can reach it. The relay secret keeps it protected.
4. Click **Deploy** and copy the **Web app URL**. It ends in `/exec`.
5. Test it: open that URL in your browser. You should see `{"ok":true,"app":"loop"}`.

> **When you change `Code.gs` later:** use **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. This keeps the same URL. Choosing "New deployment" creates a new URL, and you would have to update Vercel.

## Step 3: Deploy the app to Vercel

1. Go to <https://vercel.com/new> and **import** the GitHub repository `nman-rgb/nouman001`.
   - Make sure the branch that contains `loop-streak-mvp/` is your production branch. Merge it into `main`, or pick the branch under **Settings → Git**.
2. On the configure screen:
   - **Root Directory:** click **Edit** and choose **`loop-streak-mvp`**. This matters because the repo also contains your portfolio.
   - **Framework Preset:** **Other**
   - Leave the build and output settings alone. `vercel.json` already sets `public` as the output directory.
3. Open **Environment Variables** and add:

   | Name              | Value                                          |
   | ----------------- | ---------------------------------------------- |
   | `APPS_SCRIPT_URL` | The `/exec` URL from Step 2                    |
   | `RELAY_SECRET`    | The `RELAY_SECRET` line from the Step 1 log    |

4. Click **Deploy**. You get a URL like `https://loop-streak-xyz.vercel.app`. In **Settings → Domains** you can change it to something nicer, like `loop-nouman.vercel.app`.
5. Quick test from a terminal (optional):
   ```bash
   curl -X POST https://YOUR-APP.vercel.app/api/relay \
     -H 'Content-Type: application/json' \
     -d '{"action":"state","token":"YOUR_ACCESS_TOKEN"}'
   ```
   A response starting with `{"ok":true,"data":{"me":…` means the whole chain works.

> If you change environment variables later, run **Deployments → ⋯ → Redeploy** so they take effect.

## Step 4: Install Loop on both iPhones

Do this on each phone:

1. Open the Vercel URL in **Safari**. It has to be Safari: Chrome on iOS can't install web apps with push support.
2. Tap **Share** (the square with an arrow) → **Add to Home Screen** → **Add**.
3. Open **Loop from the Home Screen icon**, then paste **that person's** access token and tap **Continue**.
   - Log in inside the installed app, not in Safari. iOS gives Home Screen apps their own storage, so a Safari login doesn't carry over.
4. Send your friend **their** token privately, for example in a disappearing message.

## Step 5: Daily use

1. In TikTok, tap **Share → Copy link**.
2. Open Loop, tap **Paste** (allow paste when iOS asks), add a note if you want, then tap **Send TikTok**.
3. Your friend sees it in **Inbox** with a pink dot. Tapping **Watch ▶** opens TikTok and marks it **Seen** for you. Tapping an emoji sends a reaction. Tap the same emoji again to remove it.

### Optional: a one-tap "Send to Loop" Shortcut

This sends a TikTok straight from the share sheet without opening Loop:

1. Open the **Shortcuts** app → **+** → name it **Send to Loop**.
2. Tap the **ⓘ** (Details) button → turn on **Show in Share Sheet**. Under share sheet types, keep only **URLs** and **Text**.
3. Add the **Get Contents of URL** action:
   - **URL:** `https://YOUR-APP.vercel.app/api/relay`
   - **Method:** POST, **Request Body:** JSON, with these fields:
     - `action` (Text) = `share`
     - `token` (Text) = *your access token*
     - `url` (Text) = **Shortcut Input** (pick it from the variables bar)
4. Add **Get Dictionary Value** → key `error`. Then add **If** *Dictionary Value* **does not have any value**: **Show Notification** "Sent to Loop 🔥". **Otherwise**: **Show Notification** with the *Dictionary Value*, which is the error message.
5. In TikTok: **Share → More (⋯ / "Others")** to open the iOS share sheet → **Send to Loop**.

The token is saved inside the Shortcut, so don't share the Shortcut file with anyone.

Loop also accepts a link in its address, `https://YOUR-APP.vercel.app/?url=<tiktok-link>`, and pre-fills it. On Android, installing Loop also puts it directly in the share menu (Web Share Target).

---

## How the rules work

- **The day** runs from midnight to midnight in **Asia/Dubai** time, set in `TZ` in `Code.gs`.
- **A day counts** when **both** people sent at least one TikTok that day. Ten videos in one day still count as one day. Opening videos isn't required.
- **The current streak** counts back from today if today is complete. If today isn't complete yet, it counts from yesterday, so the streak doesn't break until midnight passes.
- **Duplicates:** you can't send the same TikTok to your friend twice. Short links (`vm.tiktok.com/…`) are resolved to the real video so they're caught too. A double-tap or retry on a bad connection is detected (`clientId`) and never creates two entries.
- **Read receipts and reactions:** only the person who received a TikTok can mark it seen or react. Reacting also marks it seen.

### Sheet tabs

| Tab             | Columns                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `Users`         | id, name, token, createdAt                                                                       |
| `Videos`        | id, url, canonicalUrl, sender, recipient, note, title, author, thumbnail, sentAt, day, clientId |
| `Reactions`     | videoId, userId, emoji, reactedAt                                                                |
| `Reads`         | videoId, userId, readAt                                                                          |
| `DailyActivity` | day, userId, count, firstSentAt, lastSentAt, dayComplete                                         |

All values are stored as plain text, and times use ISO UTC (`2026-10-13T09:00:00.000Z`). Avoid editing rows by hand. If `DailyActivity` ever gets out of sync, run **`rebuildDailyActivity`** in the Apps Script editor and it's recalculated from `Videos`.

### API (`POST /api/relay`)

| `action` | Extra fields                          | Returns                                         |
| -------- | ------------------------------------- | ----------------------------------------------- |
| `state`  | none                                  | Profile, friend, streak, unread count, last 100 videos |
| `share`  | `url`, `note?`, `clientId?`           | New state (+ `sharedId`)                        |
| `read`   | `videoId`                             | `{ videoId }`                                   |
| `react`  | `videoId`, `emoji` (same emoji = remove) | `{ videoId, emoji }`                         |

Every request needs `token`. Errors look like `{ ok: false, code, error }` with a 4xx/5xx status.

---

## Security notes

- Anyone who has a token can act as that person. If a token leaks, edit `rotateToken()` in `Code.gs` to pick the user, run it, and log in again with the new token.
- Tokens are stored in the `Users` tab, so keep the Google Sheet private (don't share it).
- `RELAY_SECRET` is only in Vercel and Apps Script **Script Properties**. To change it, update the property, update the Vercel env var, and redeploy.
- Vercel only forwards known actions and fields to Apps Script, and Apps Script checks the secret, token and permissions on every request.

## Testing

**Automated** (needs Node.js 20+):

```bash
cd loop-streak-mvp
npm test
```

The tests run `Code.gs` against an in-memory fake Google Sheet. They cover auth, streaks across Dubai midnight, broken streaks and best streak, duplicates and retries, read receipts and reactions, and formula injection.

**Run locally:** `npm i -g vercel`, copy `.env.example` to `.env`, fill it in, then run `vercel dev` and open <http://localhost:3000>.

**Manual checklist (Phase 4):**

- [ ] Both phones log in and see each other's name ("with …")
- [ ] A sends → B sees it in Inbox with a pink dot within about 20 s
- [ ] B taps Watch → A sees "✓✓ Seen"; B reacts → A sees the emoji
- [ ] Sending the same TikTok again shows "You already sent this TikTok…"
- [ ] Only A has sent today → no streak yet; B sends too → streak goes up by 1
- [ ] Just after midnight Dubai time, the counters reset to "not yet" but the streak stays
- [ ] A day where only one person sends → the next day the streak shows 0 and the best streak is kept
- [ ] A wrong token shows the login screen with an error

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "The Loop backend gave an unexpected answer" (502) | `APPS_SCRIPT_URL` is wrong or doesn't end in `/exec`, or the deployment's access isn't **Anyone**. |
| "Relay secret mismatch" | `RELAY_SECRET` on Vercel doesn't match Script Properties. Fix it, then **Redeploy** on Vercel. |
| "Server is missing APPS_SCRIPT_URL or RELAY_SECRET" | Add the env vars on Vercel (Production) and redeploy. |
| "Run setup() in the Apps Script editor first" | Run `setup` once from the editor. |
| Code changes don't show up | Apps Script: **Manage deployments → Edit → New version**. Frontend: push to GitHub; Vercel redeploys automatically. Close and reopen the app. |
| Sending takes 2–4 seconds | Normal for Apps Script, which looks up the video title and thumbnail when you send. |
| No title or thumbnail on a card | TikTok's preview service didn't answer. The link still works. |

---

## Next: Phase 3 (push notifications)

Polling already keeps Loop current while it's open. Phase 3 adds notifications when it's closed:

1. Create a Firebase project and add a **Web app**. Enable **Cloud Messaging** and generate a **Web Push certificate (VAPID key)**.
2. In the PWA: ask for notification permission after a button tap (iOS requires a user gesture, and the app must be opened from the Home Screen). Get an FCM token and save it with a new `registerDevice` action into a new `Devices` tab.
3. In `sw.js`: handle `push` and `notificationclick` events, so tapping a notification opens the Inbox.
4. In `Code.gs`: fill in the `notify_()` hook. It's already called on every share. It sends through the FCM HTTP v1 API using a service account, with credentials kept in Script Properties.

Both phones must have the app **installed to the Home Screen** with notifications **allowed**. Delivery is usually fast but not guaranteed to the second.
