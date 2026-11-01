# Zebra Shift

An ER roguelike for clinicians. Diagnose, treat and survive the night shift: order history, exam, tests and imaging, name the diagnosis, pick the treatment, do the bedside procedures and send each patient to the right place. Common cases keep you alive. Zebras make you a legend.

This folder is the installable web app version. It plays in any modern browser, installs to a phone or computer like a normal app, and works offline after the first visit.

## Play it

Once GitHub Pages is switched on (below), the game lives at:

**https://playzebrashift.github.io/**

### Install it as an app

- **Android (Chrome):** open the link, tap the ⋮ menu, then **Install app** (or **Add to Home screen**).
- **iPhone or iPad (Safari):** open the link, tap **Share**, then **Add to Home Screen**.
- **Windows, Mac or Linux (Chrome or Edge):** open the link and click the install icon at the right of the address bar.

The installed app opens full screen with its own icon and keeps working without a connection. Saves stay on the device. To move a career, sign in under **Friends & leaderboards** (once online features are switched on, below), or use **Back up or import a save** in the main menu.

### Download it

`index.html` is the whole game in one file. Download it and open it in a browser to play offline. (Installing and automatic updates need the hosted link.)

## Switch on GitHub Pages (one time)

1. Open the repository on GitHub and go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Choose the branch that holds these files and the **/ (root)** folder, then **Save**.
4. After a minute or two the page shows the live address.

## Switch on friends and leaderboards (one time, free)

The online features (sign-in, friends, an all-time leaderboard, a daily leaderboard for Case of the day, and cloud saves that follow you between devices) run on a free [Supabase](https://supabase.com) project. Until it is set up, the game simply hides the **Friends & leaderboards** button and plays offline.

1. **Create the project.** Sign up at supabase.com, click **New project**, give it a name and a database password, and pick the region nearest your players. Wait a minute for it to start.
2. **Create the tables.** Open **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, and click **Run**. It should say *Success. No rows returned.*
3. **Set the web address.** Open **Authentication → URL Configuration**. Set **Site URL** to `https://playzebrashift.github.io/` and add the same address under **Redirect URLs**.
4. **Set up email sending.** Supabase's built-in email sender only delivers to members of your Supabase team and a few emails an hour, so other players need your own sender. Under **Authentication → Emails → SMTP Settings**, enter the details from a free email service. A free Brevo account works: verify one sender address, then use its SMTP server, login and key. With your own SMTP set up you can also edit **Emails → Magic Link** and add `{{ .Token }}` so the email shows a code as well as the link. The code makes signing in easier inside the installed app, where email links open in a different browser.
5. **Connect the game.** Open **Project Settings → API**. Copy the **Project URL** and the **anon public** key into `config.js`, then commit and push. (The anon key is meant to be public. The database rules in `schema.sql` decide what each player can read and write.)
6. **Optional: Google sign-in.** Under **Authentication → Providers → Google**, follow Supabase's steps to add a Google client ID, then set `google: true` in `config.js`.

Scores are reported by each player's own device, so a determined player could fake one. That's fine for friends comparing results, but they aren't proof of anything.

## Challenges and daily reminders (one time)

Challenge links, written cases, the Reading room and achievements work for everyone with no setup. Two extras need the online project:

**Challenges sent inside the game, and achievement counts.** Open **SQL Editor → New query**, paste the whole of `supabase/schema.sql` again and click **Run**. It adds the new tables and keeps everything already there.

**Daily reminder notifications.** These come from a small server function that runs once an hour:

1. **Turn on two extensions.** In **Database → Extensions**, switch on `pg_cron` and `pg_net`.
2. **Create the function.** Open **Edge Functions → Deploy a new function → Via editor**. Name it `daily-reminder`, paste in `supabase/functions/daily-reminder/index.ts`, and deploy. In the function's settings, turn **off** "Enforce JWT verification". It checks its own secret instead.
3. **Add three secrets.** Under **Edge Functions → Secrets**, add `VAPID_PUBLIC_KEY` (the `vapidKey` value in `config.js`), `VAPID_PRIVATE_KEY`, and `CRON_SECRET` (any long random text). Keep the last two private.
4. **Schedule it.** In **SQL Editor**, run this, with your `CRON_SECRET` pasted in:
   ```sql
   select cron.schedule('zebra-daily-reminder', '0 * * * *', $$
     select net.http_post(
       url := 'https://yqkxewvkawkjixjjwqxb.supabase.co/functions/v1/daily-reminder',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'PASTE_CRON_SECRET_HERE'),
       body := '{}'::jsonb)
   $$);
   ```

Players then turn reminders on from **Daily reminder** in the main menu. On iPhone this only works once the game has been added to the Home Screen (iOS 16.4 or later). Anyone can use the calendar reminder instead, which needs no setup.

## Put it in the app stores

The game is a Progressive Web App, so it can be packaged without rewriting it:

1. Go to **https://www.pwabuilder.com** and paste the live address.
2. Pick a store: **Google Play** (an Android package), **Microsoft Store**, or **iOS** (an Xcode project you build on a Mac).
3. Follow its steps. You need your own developer accounts: Google Play has a one-time fee, Apple charges yearly, and Microsoft is free for individuals.

Before submitting a medical-themed game, add a short disclaimer to the store listing that it is for education and entertainment, not clinical guidance.

## Admin dashboard: active players and play time (one time)

The game sends anonymous play statistics (a random ID per device, minutes spent in each part of the game, runs, Zebra Hunt and Case of the day results; see `privacy.html`). Only accounts on the admin list can see them, at **https://playzebrashift.github.io/admin.html**.

1. **Update the database.** Open **SQL Editor → New query**, paste the whole of `supabase/schema.sql` again and click **Run**. It adds the statistics table and keeps everything already there.
2. **Make yourself an admin.** Sign in once (in the game under **Friends & leaderboards**, or on the dashboard itself), then run this in **SQL Editor**, with your own email address:
   ```sql
   insert into public.admins select id from auth.users where email = 'you@example.com';
   ```
3. **Open the dashboard.** Go to `admin.html` and sign in with that account. Numbers appear as people play; days are counted in Jakarta time (WIB). To see the layout before there is any data, open `admin.html?demo`.

## Zebra Hunt and articles

- **Zebra Hunt** is a one-minute daily mode: seven patients with four choices each, the same for everyone. Every day has one Zebra and one Unicorn in a shuffled order, and a case's rarity is revealed only once it is answered. It needs no career. Link straight to it with **https://playzebrashift.github.io/#hunt** (and to the Reading room with `#reads`).
- **Articles** live in `articles/`: a guide for each picture type, built from the game's own pictures and explanations, plus `sitemap.xml` and `robots.txt` for search engines. After changing cases or pictures, rebuild everything with:
  ```
  python3 tools/build_app.py && node tools/build_articles.js
  ```
  Then submit `https://playzebrashift.github.io/sitemap.xml` once in Google Search Console so the articles get indexed.

## Notes

- **Talking to staff:** inside claude.ai the co-workers are played live by Claude. In this standalone app there is no Claude connection, so they use their written lines. Everything else works the same.
- **Updating the app:** the game source is `zebra-shift.source.html` (the same page as the Claude artifact). After changing it, run `python3 tools/build_app.py` to rebuild `index.html`, and bump `VERSION` in `sw.js` so installed copies pick up the new build.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The playable app, built from the source |
| `zebra-shift.source.html` | Game source, identical to the Claude artifact |
| `manifest.webmanifest` | App name, colours and icons for installing |
| `sw.js` | Service worker for offline play |
| `icons/` | App icons |
| `online.js` | Sign-in, friends, leaderboards and cloud saves |
| `config.js` | Your Supabase project values (empty means offline only) |
| `supabase/schema.sql` | Database tables and access rules for the online features |
| `vendor/` | The Supabase client library (MIT licence) |
| `privacy.html` | Privacy notice shown at sign-in |
| `supabase/functions/daily-reminder/` | Sends the daily reminder notifications |
| `tools/build_app.py` | Rebuilds `index.html` from the source |
