/* Zebra Shift online: sign-in, profiles, friends, leaderboards and cloud saves (Supabase).
   Loaded only by the app build. Stays switched off until config.js has the project values. */
(() => {
  const C = window.ZS_CONFIG || {};
  if (!C.supabaseUrl || !C.supabaseKey || !window.supabase) return;

  const sb = window.supabase.createClient(C.supabaseUrl, C.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const here = () => location.origin + location.pathname;
  // Opening the emailed link lands here with the session in the address; show the online screen when it does
  let fromLink = /access_token|error_description/.test(location.hash + location.search);
  const O = {
    user: null, profile: null, loading: true, tab: 'board', boardScope: 'all',
    email: '', codeSent: false, busy: false, msg: '', err: '',
    board: null, dboard: {}, friends: null, cloud: null, confirmDel: false,
    chal: [], push: { busy: false, on: false }
  };
  // Re-render the screens that show online data, keeping whatever the player is typing
  const rr = () => {
    if (!['online', 'daily', 'menu', 'chal'].includes(S.screen)) return;
    const a = document.activeElement, id = a && a.tagName === 'INPUT' && a.id, val = id && a.value;
    render();
    const b = id && document.getElementById(id);
    if (b) { b.value = val; b.focus(); }
  };
  const fail = (e, fallback) => { O.busy = false; O.err = (e && e.message) || fallback; rr(); };
  const today = () => todayStr();

  /* ---------- names ---------- */
  // A short list of words that cannot appear anywhere in a username
  const BLOCK = ['fuck', 'shit', 'cunt', 'bitch', 'nigg', 'fag', 'retard', 'whore', 'slut', 'rape', 'nazi', 'hitler', 'penis', 'vagina', 'porn', 'dick', 'cock', 'twat', 'wank', 'spic', 'chink', 'kike', 'tranny'];
  function nameProblem(u) {
    if (!/^[A-Za-z0-9_]{3,20}$/.test(u)) return 'Use 3 to 20 letters, numbers or underscores.';
    const low = u.toLowerCase().replace(/[_0-9]/g, '');
    if (BLOCK.some(w => low.includes(w))) return 'Please choose a different username.';
    return '';
  }

  /* ---------- what this device knows about the player ---------- */
  function localStats() {
    const slots = STORE.slots.filter(Boolean), act = STORE.active != null && STORE.slots[STORE.active];
    const d = normDoc((act || slots[0] || {}).doctor);
    const doctor = Object.assign({ first: d.first, last: d.last, gender: d.gender, spec: d.spec, skin: d.skin, hair: d.hair, hc: d.hc, scrub: d.scrub, glasses: !!d.glasses, cap: !!d.cap, steth: !!d.steth, coat: !!d.coat, earrings: !!d.earrings, facial: d.facial }, typeof docPublic === 'function' ? docPublic(d) : {});
    const book = m => Object.keys((m && m.book) || {}).filter(n => IDX[n] != null).length;
    return {
      display: ('Dr. ' + (fullName(d) || 'Reyes')).slice(0, 60), doctor, spec: (SPECS[d.spec] || SPECS.em).n,
      best: Math.min(50000000, Math.max(0, ...slots.map(s => Math.round((s.meta && s.meta.best) || 0)))),
      cases: Math.min(1000, Math.max(0, ...slots.map(s => book(s.meta)))),
      runs: slots.reduce((a, s) => a + ((s.meta && s.meta.runs) || 0), 0),
      ems: slots.reduce((a, s) => a + ((s.meta && s.meta.ems) || 0), 0)
    };
  }
  const newestLocal = () => Math.max(0, ...STORE.slots.filter(Boolean).map(s => s.updated || 0));

  /* ---------- session ---------- */
  async function afterSignIn() {
    O.loading = true; rr();
    const { data, error } = await sb.from('profiles').select('*').eq('id', O.user.id).maybeSingle();
    O.loading = false;
    if (fromLink && S.screen === 'menu') { fromLink = false; S.screen = 'online'; }
    if (error) return fail(error, 'Could not load your profile.');
    O.profile = data;
    if (O.profile) { syncStats(); pushTodayDaily(); loadFriends(); checkCloud(); loadBoard(); loadChallenges(); pushCheck(); }
    rr();
  }
  sb.auth.onAuthStateChange((_ev, session) => {
    const was = O.user && O.user.id;
    O.user = (session && session.user) || null;
    if (!O.user) { O.profile = null; O.friends = null; O.cloud = null; O.loading = false; rr(); return; }
    if (O.user.id !== was) afterSignIn();
  });
  sb.auth.getSession().then(({ data }) => { if (!data.session) { O.loading = false; rr(); } });

  /* ---------- profile, stats and saves ---------- */
  let statT = null, saveT = null;
  async function syncStats() {
    if (!O.profile) return;
    const s = localStats();
    const { data, error } = await sb.from('profiles').update({ ...s, updated_at: new Date().toISOString() }).eq('id', O.user.id).select().maybeSingle();
    if (!error && data) O.profile = data;
    // achievements live in their own column, so an older database without it still syncs everything else
    if (typeof achCount === 'function') sb.from('profiles').update({ ach: achCount() }).eq('id', O.user.id).then(() => {}, () => {});
  }
  // Achievements and specialty unlocks ride along with the careers. Before writing, fold in whatever
  // another device saved, so two phones never overwrite each other's unlocks
  async function pullAch() {
    const { data } = await sb.from('saves').select('ach:data->ach').eq('user_id', O.user.id).maybeSingle();
    if (data && data.ach && typeof achMerge === 'function' && achMerge(data.ach)) rr();
  }
  async function uploadSaves() {
    if (!O.profile) return;
    if (typeof ACH !== 'undefined') await pullAch();
    const payload = typeof ACH !== 'undefined' ? { ...STORE, ach: ACH } : STORE;
    const { error } = await sb.from('saves').upsert({ user_id: O.user.id, data: payload, updated_at: new Date().toISOString() });
    if (!error) O.cloud = null;
  }
  async function checkCloud() {
    const { data } = await sb.from('saves').select('data,updated_at').eq('user_id', O.user.id).maybeSingle();
    if (data && data.data && data.data.ach && typeof achMerge === 'function' && achMerge(data.data.ach)) { toast('Achievements and specialties synced from your account'); rr(); }
    if (!data || !data.data || !Array.isArray(data.data.slots)) { uploadSaves(); return; }
    const cloudNewest = Math.max(0, ...data.data.slots.filter(Boolean).map(s => s.updated || 0));
    if (cloudNewest > newestLocal() + 5000) { O.cloud = { at: cloudNewest, data: data.data }; rr(); }
    else uploadSaves();
  }
  function loadCloud() {
    if (!O.cloud) return;
    const c = O.cloud.data;
    STORE = { active: c.active == null ? null : c.active, slots: [0, 1, 2].map(i => c.slots[i] || null) };
    writeStore(); O.cloud = null; toast('Cloud saves loaded on this device'); syncStats(); rr();
  }

  /* ---------- Case of the day ---------- */
  async function postDaily(date, st) {
    if (!O.profile || !st || !st.done) return;
    await sb.from('daily_scores').upsert({ user_id: O.user.id, day: date, score: st.score, clues: dailyClues(st), wrong: dailyWrong(st), won: !!st.won });
    delete O.dboard[date]; loadDaily(date);
  }
  function pushTodayDaily() { const st = DAILY[today()]; if (st && st.done) postDaily(today(), st); }
  async function loadDaily(date) {
    O.dboard[date] = O.dboard[date] || { loading: true, rows: [] };
    const { data, error } = await sb.from('daily_scores').select('score,clues,wrong,won,user_id,profiles(username,display)').eq('day', date).order('score', { ascending: false }).limit(50);
    O.dboard[date] = { loading: false, rows: error ? [] : data || [], err: error ? 'Could not load today’s scores.' : '' };
    rr();
  }

  /* ---------- leaderboard ---------- */
  async function loadBoard() {
    O.board = O.board || { loading: true, rows: [] };
    let q = sb.from('profiles').select('id,username,display,doctor,spec,best,cases').order('best', { ascending: false }).limit(50);
    if (O.boardScope === 'friends') { const ids = friendIds(); q = q.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']); }
    const { data, error } = await q;
    O.board = { loading: false, rows: error ? [] : data || [], err: error ? 'Could not load the leaderboard.' : '' };
    rr();
  }

  /* ---------- friends ---------- */
  const friendIds = () => {
    const me = O.user ? [O.user.id] : [];
    return me.concat(((O.friends && O.friends.accepted) || []).map(p => p.id));
  };
  async function loadFriends() {
    if (!O.profile) return;
    const { data: rows, error } = await sb.from('friendships').select('*');
    if (error) { O.friends = { accepted: [], incoming: [], outgoing: [], err: 'Could not load friends.' }; rr(); return; }
    const other = r => r.requester === O.user.id ? r.addressee : r.requester;
    const ids = [...new Set(rows.map(other))];
    const { data: profs } = ids.length ? await sb.from('profiles').select('id,username,display,doctor,spec,best,cases').in('id', ids) : { data: [] };
    const byId = Object.fromEntries((profs || []).map(p => [p.id, p]));
    O.friends = {
      accepted: rows.filter(r => r.status === 'accepted').map(r => byId[other(r)]).filter(Boolean),
      incoming: rows.filter(r => r.status === 'pending' && r.addressee === O.user.id).map(r => byId[r.requester]).filter(Boolean),
      outgoing: rows.filter(r => r.status === 'pending' && r.requester === O.user.id).map(r => byId[r.addressee]).filter(Boolean)
    };
    if (O.friends.accepted.length) achEvent('friend');
    rr();
  }
  async function addFriend(name) {
    name = String(name || '').trim().replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) { O.err = 'Enter their exact username.'; rr(); return; }
    O.busy = true; O.err = ''; O.msg = ''; rr();
    const { data: who, error } = await sb.from('profiles').select('id,username').ilike('username', name.replace(/_/g, '\\_')).maybeSingle();
    if (error) return fail(error, 'Could not search for that player.');
    if (!who) { O.busy = false; O.err = 'No player called ' + name + '.'; rr(); return; }
    if (who.id === O.user.id) { O.busy = false; O.err = 'That is you.'; rr(); return; }
    const f = O.friends || { accepted: [], incoming: [], outgoing: [] };
    if (f.accepted.some(p => p.id === who.id)) { O.busy = false; O.msg = who.username + ' is already your friend.'; rr(); return; }
    if (f.incoming.some(p => p.id === who.id)) { await accept(who.id); return; }
    const { error: e2 } = await sb.from('friendships').insert({ requester: O.user.id, addressee: who.id });
    O.busy = false;
    if (e2 && e2.code !== '23505') return fail(e2, 'Could not send the request.');
    O.msg = 'Request sent to ' + who.username + '.'; loadFriends();
  }
  async function accept(id) {
    O.busy = true; rr();
    const { error } = await sb.from('friendships').update({ status: 'accepted' }).eq('requester', id).eq('addressee', O.user.id);
    O.busy = false; if (error) return fail(error, 'Could not accept the request.');
    O.msg = 'Friend added.'; sfx('right'); achEvent('friend'); loadFriends();
  }
  async function unfriend(id) {
    const me = O.user.id;
    const { error } = await sb.from('friendships').delete().or(`and(requester.eq.${me},addressee.eq.${id}),and(requester.eq.${id},addressee.eq.${me})`);
    if (error) return fail(error, 'Could not remove that friend.');
    loadFriends();
  }

  /* ---------- challenges between friends ---------- */
  // A challenge row carries the seed and disease tags; each player's five scores fill in as they finish
  async function loadChallenges() {
    if (!O.profile) return;
    const { data, error } = await sb.from('challenges').select('id,seed,cases,from_scores,to_scores,from_id,to_id,created_at,sender:profiles!challenges_from_id_fkey(username),receiver:profiles!challenges_to_id_fkey(username)').order('created_at', { ascending: false }).limit(50);
    if (error) return;
    O.chal = data || [];
    for (const r of O.chal) {
      const rec = CHAL[r.seed];
      if (r.from_id === O.user.id && r.to_scores && rec && !rec.reply) { rec.reply = { n: '@' + ((r.receiver || {}).username || 'friend'), sc: r.to_scores }; saveChal(); toast(rec.reply.n + ' answered your challenge'); }
    }
    if (['chal', 'menu'].includes(S.screen)) render();
  }
  const inbox = () => O.profile ? O.chal.filter(r => r.to_id === O.user.id && !r.to_scores && !(CHAL[r.seed] && CHAL[r.seed].done)).map(r => ({ id: r.id, from: (r.sender || {}).username || 'friend', sc: r.from_scores })) : [];
  function playChallenge(id) {
    const r = O.chal.find(x => x.id === id); if (!r) return;
    chalFromPayload({ t: 'c', s: r.seed, cs: r.cases, n: '@' + ((r.sender || {}).username || 'friend'), sc: r.from_scores }, id);
  }
  async function sendChallenge(friendId, rec) {
    if (!O.profile || !rec) return;
    if (!rec.done) { rec.target = friendId; saveChal(); toast('Play your five patients first. It sends when you finish.'); return; }
    const { error } = await sb.from('challenges').insert({ from_id: O.user.id, to_id: friendId, seed: rec.id, cases: rec.tags, from_scores: chalScores(rec) });
    if (error) { toast('Could not send the challenge. ' + (error.message || '')); return; }
    rec.sentTo = (rec.sentTo || []).concat(friendId); saveChal(); achEvent('chalsent');
    const f = ((O.friends && O.friends.accepted) || []).find(p => p.id === friendId);
    toast('Challenge sent' + (f ? ' to @' + f.username : '')); render();
  }
  async function answerChallenge(id, scores) {
    const { error } = await sb.from('challenges').update({ to_scores: scores }).eq('id', id);
    if (!error) { toast('Your result was sent back'); loadChallenges(); }
  }

  /* ---------- daily reminder notifications ---------- */
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushOK = () => !!C.vapidKey && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !(isIOS && !standalone);
  const b64key = k => { const p = '='.repeat((4 - k.length % 4) % 4), raw = atob((k + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, c => c.charCodeAt(0)); };
  async function pushCheck() {
    if (!pushOK()) return;
    try { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); O.push.on = !!sub && !!REM.on; } catch (e) { }
    rr();
  }
  async function enablePush(hour) {
    if (!pushOK() || !O.profile) return;
    O.push.busy = true; rr();
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { O.push.busy = false; toast('Notifications were not allowed.'); rr(); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64key(C.vapidKey) });
      const j = sub.toJSON(), t = new Date(); t.setHours(hour, 0, 0, 0);
      const { error } = await sb.from('push_subs').upsert({ endpoint: j.endpoint, user_id: O.user.id, p256dh: j.keys.p256dh, auth: j.keys.auth, hour_utc: t.getUTCHours(), tz_offset: t.getTimezoneOffset() });
      if (error) throw error;
      REM.on = true; REM.hour = hour; saveRem(); O.push.on = true; achEvent('remind');
      toast('Daily reminder on for ' + hourLabel(hour));
    } catch (e) { toast('Could not turn on notifications. ' + ((e && e.message) || '')); }
    O.push.busy = false; rr();
  }
  async function disablePush() {
    try {
      const reg = await navigator.serviceWorker.getRegistration(), sub = reg && await reg.pushManager.getSubscription();
      if (sub) { await sb.from('push_subs').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
    } catch (e) { }
    REM.on = false; saveRem(); O.push.on = false; toast('Daily reminder off'); rr();
  }

  /* ---------- rendering ---------- */
  const css = document.createElement('style');
  css.textContent = `
  .onl-wrap{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,340px);gap:16px;align-items:start;margin-top:14px}
  @media (max-width:860px){.onl-wrap{grid-template-columns:minmax(0,1fr)}}
  .onl-card{padding:16px;display:flex;flex-direction:column;gap:12px}
  .onl-card h2{font-size:20px}
  .onl-form{display:flex;gap:8px;flex-wrap:wrap}
  .onl-form input{flex:1 1 200px;min-width:0;font:inherit;padding:10px 12px;border-radius:10px;border:1.5px solid var(--line);background:var(--panel-2);color:var(--ink)}
  .onl-form input:focus{border-color:var(--scrub);outline:none}
  .onl-rows{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
  .onl-rows li{display:flex;align-items:center;gap:8px 10px;padding:7px 10px;border-radius:10px;background:var(--panel-2);min-width:0;flex-wrap:wrap}
  .onl-rows li.me{outline:2px solid var(--scrub)}
  .onl-rows .rank{font:700 14px var(--f-mono);width:26px;text-align:right;color:var(--muted);flex:none}
  .onl-rows .who{flex:1 1 130px;min-width:0;line-height:1.2}
  .onl-rows .btn{padding:7px 11px;font-size:14px}
  .onl-rows .who b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .onl-rows .who span{font-size:12px;color:var(--muted)}
  .onl-rows .pts{font:700 15px var(--f-mono);white-space:nowrap}
  .onl-msg{margin:0;font-size:14px;font-weight:700;color:var(--ok)}
  .onl-err{margin:0;font-size:14px;font-weight:700;color:var(--alarm)}
  .onl-banner{display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:space-between;padding:12px 14px;border-radius:12px;background:var(--scrub-soft);border:1px solid color-mix(in srgb,var(--scrub) 35%,transparent)}
  .onl-small{font-size:13px;color:var(--muted);margin:0}`;
  document.head.appendChild(css);

  const msgs = () => `${O.msg ? `<p class="onl-msg">${esc(O.msg)}</p>` : ''}${O.err ? `<p class="onl-err">${esc(O.err)}</p>` : ''}`;
  const face = p => portrait(docLook(normDoc(p && p.doctor)), { cls: 'mini', label: 'Player' });
  function row(p, i, right) {
    const me = O.user && p.id === O.user.id;
    return `<li class="${me ? 'me' : ''}">${i != null ? `<span class="rank">${i + 1}</span>` : ''}${face(p)}<div class="who"><b>${esc(p.display || p.username)}${me ? ' (you)' : ''}</b><span>@${esc(p.username)}${p.spec ? ' · ' + esc(p.spec) : ''}</span></div>${right}</li>`;
  }

  function signInView() {
    return `<section class="panel onl-card"><h2>Sign in to play with friends</h2>
      <p class="onl-small">Signing in gives you a username, puts your best score on the leaderboard, lets you add friends and keeps your careers in sync across your devices. Your email address is never shown to other players.</p>
      ${O.codeSent
        ? `<p>We emailed a sign-in link to <b>${esc(O.email)}</b>. Open it on this device to sign in. If the email also shows a code, you can type it here instead.</p>
           <form class="onl-form" data-onform="code"><input id="on-code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="Code from the email" aria-label="Sign-in code"><button class="btn primary" type="submit" ${O.busy ? 'disabled' : ''}>Sign in</button></form>
           <button class="btn" data-on="restart">Use a different email</button>`
        : `<form class="onl-form" data-onform="email"><input id="on-email" type="email" autocomplete="email" placeholder="you@example.com" aria-label="Email address" value="${esc(O.email)}"><button class="btn primary" type="submit" ${O.busy ? 'disabled' : ''}>${O.busy ? 'Sending…' : 'Email me a sign-in link'}</button></form>`}
      ${C.google ? `<button class="btn" data-on="google">${ic('user')}Continue with Google</button>` : ''}
      ${msgs()}
      <p class="onl-small">By signing in you agree to the <a href="privacy.html" target="_blank" rel="noopener">privacy notice</a>.</p></section>`;
  }
  function pickNameView() {
    const s = localStats();
    return `<section class="panel onl-card"><h2>Choose a username</h2>
      <p class="onl-small">Friends add you with this name. It appears on leaderboards next to <b>${esc(s.display)}</b> and your doctor's portrait.</p>
      <form class="onl-form" data-onform="username"><input id="on-user" maxlength="20" autocomplete="off" placeholder="e.g. night_registrar" aria-label="Username"><button class="btn primary" type="submit" ${O.busy ? 'disabled' : ''}>Save</button></form>
      <p class="onl-small">3 to 20 letters, numbers or underscores.</p>${msgs()}
      <button class="btn" data-on="signout">Sign out</button></section>`;
  }
  function boardView() {
    const b = O.board;
    return `<section class="panel onl-card"><div class="pagehead"><h2>Best scores</h2>
      <div class="tabs" role="group" aria-label="Leaderboard scope"><button data-on="scope:all" aria-pressed="${O.boardScope === 'all'}">Everyone</button><button data-on="scope:friends" aria-pressed="${O.boardScope === 'friends'}">Friends</button></div></div>
      ${!b || b.loading ? '<p class="onl-small">Loading…</p>' : b.err ? `<p class="onl-err">${esc(b.err)}</p>` : b.rows.length
        ? `<ul class="onl-rows">${b.rows.map((p, i) => row(p, i, `<span class="pts">${fmt(p.best)}</span>`)).join('')}</ul>`
        : `<p class="onl-small">${O.boardScope === 'friends' ? 'Add friends to compare scores.' : 'No scores yet. Finish a run to post yours.'}</p>`}
      <p class="onl-small">Scores come from each player's own device and are not checked, so treat them as friendly bragging rights.</p></section>`;
  }
  function dailyRows(date) {
    const b = O.dboard[date];
    if (!b) { loadDaily(date); return '<p class="onl-small">Loading…</p>'; }
    if (b.loading) return '<p class="onl-small">Loading…</p>';
    if (b.err) return `<p class="onl-err">${esc(b.err)}</p>`;
    if (!b.rows.length) return '<p class="onl-small">Nobody has posted a result today yet.</p>';
    return `<ul class="onl-rows">${b.rows.map((r, i) => row({ id: r.user_id, username: (r.profiles || {}).username || 'player', display: (r.profiles || {}).display }, i,
      `<span class="pts">${r.won ? fmt(r.score) : 'missed'}</span>`).replace('<div class="who">', '<div class="who">').replace(/<svg[\s\S]*?<\/svg>/, '')).join('')}</ul>`;
  }
  function todayView() {
    const st = DAILY[today()];
    return `<section class="panel onl-card"><h2>Case of the day · ${esc(dateLabel(today()))}</h2>
      ${st && st.done ? '' : '<p class="onl-small">Play today’s case from the main menu to post your score.</p>'}
      ${dailyRows(today())}</section>`;
  }
  function friendsView() {
    const f = O.friends;
    const btn = (on, label, cls = '') => `<button class="btn ${cls}" data-on="${on}">${label}</button>`;
    return `<section class="panel onl-card"><h2>Friends</h2>
      <form class="onl-form" data-onform="friend"><input id="on-friend" maxlength="21" autocomplete="off" placeholder="Their username" aria-label="Friend's username"><button class="btn primary" type="submit" ${O.busy ? 'disabled' : ''}>${ic('plus')}Add friend</button></form>
      <p class="onl-small">Your username is <b>@${esc(O.profile.username)}</b>. Share it so friends can add you.</p>${msgs()}
      ${!f ? '<p class="onl-small">Loading…</p>' : `
        ${f.incoming.length ? `<span class="label">Requests for you</span><ul class="onl-rows">${f.incoming.map(p => row(p, null, btn('accept:' + p.id, 'Accept', 'primary') + btn('remove:' + p.id, 'Decline'))).join('')}</ul>` : ''}
        <span class="label">Your friends · ${f.accepted.length}</span>
        ${f.accepted.length ? `<ul class="onl-rows">${f.accepted.map(p => row(p, null, `<span class="pts">${fmt(p.best)}</span>` + btn('challenge:' + p.id, ic('trophy') + 'Challenge', 'primary') + btn('remove:' + p.id, 'Remove'))).join('')}</ul>` : '<p class="onl-small">No friends yet.</p>'}
        ${f.outgoing.length ? `<span class="label">Waiting for a reply</span><ul class="onl-rows">${f.outgoing.map(p => row(p, null, btn('remove:' + p.id, 'Cancel'))).join('')}</ul>` : ''}`}
    </section>`;
  }
  function accountView() {
    const p = O.profile, s = localStats();
    return `<section class="panel onl-card"><div style="display:flex;gap:12px;align-items:center">${portrait(docLook(normDoc(p.doctor)), { label: 'Your doctor' })}<div><h2>${esc(p.display || p.username)}</h2><p class="onl-small">@${esc(p.username)} · ${esc(p.spec || '')}</p></div></div>
      <div class="dbstats"><span><b>${fmt(p.best)}</b> best score</span><span><b>${typeof achCount === 'function' ? achCount() : 0}</b> achievements</span><span><b>${p.cases}</b> cases diagnosed</span><span><b>${p.runs}</b> runs</span><span><b>${p.ems}</b> emergencies saved</span></div>
      <p class="onl-small">Signed in as ${esc(O.user.email || '')}. Your careers, achievements and unlocked specialties back up to your account automatically, so you can carry on from another device.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${'<button class="btn" data-on="upload">' + ic('swap') + 'Back up now</button>'}<button class="btn" data-on="signout">${ic('door')}Sign out</button></div>
      <button class="btn danger" data-on="delete">${ic('trash')}${O.confirmDel ? 'Tap again to delete your account for good' : 'Delete my account'}</button>
      <p class="onl-small">Deleting removes your profile, scores, friends and cloud saves from the server. Careers saved on this device stay here. Showing on this device: ${esc(s.display)}.</p>${msgs()}</section>`;
  }

  function render_() {
    const head = `<div class="pagehead" style="margin:6px 0 4px"><div><span class="label">Online</span><h1>Friends &amp; leaderboards</h1></div><button class="btn" data-act="dailyback">${ic('back')}Menu</button></div>`;
    if (O.loading) return head + '<p class="hint">Connecting…</p>';
    if (!O.user) return head + `<div class="onl-wrap"><div>${signInView()}</div></div>`;
    if (!O.profile) return head + `<div class="onl-wrap"><div>${pickNameView()}</div></div>`;
    const tabs = [['board', 'Leaderboard', 'trophy'], ['today', 'Today', 'star'], ['friends', 'Friends', 'people'], ['account', 'Account', 'user']];
    const inc = O.friends ? O.friends.incoming.length : 0;
    const main = { board: boardView, today: todayView, friends: friendsView, account: accountView }[O.tab]();
    return head + `${O.cloud ? `<div class="onl-banner" style="margin-top:10px"><span>Your cloud save from ${esc(new Date(O.cloud.at).toLocaleString())} is newer than this device.</span><span style="display:flex;gap:8px"><button class="btn primary" data-on="cloudload">Load it here</button><button class="btn" data-on="cloudkeep">Keep this device's</button></span></div>` : ''}
      <nav class="tabs" style="margin-top:12px;display:inline-flex" aria-label="Online sections">${tabs.map(([k, l, i]) => `<button data-on="tab:${k}" aria-pressed="${O.tab === k}">${ic(i)}${l}${k === 'friends' && inc ? `<span class="dot">${inc}</span>` : ''}</button>`).join('')}</nav>
      <div class="onl-wrap"><div>${main}</div><div>${O.tab === 'board' ? todayView() : boardView()}</div></div>`;
  }

  /* ---------- actions from the page ---------- */
  async function act(a) {
    O.msg = ''; O.err = '';
    const [k, v] = a.split(':');
    if (k === 'tab') { O.tab = v; O.confirmDel = false; if (v === 'board') loadBoard(); if (v === 'friends') loadFriends(); if (v === 'today') loadDaily(today()); }
    else if (k === 'scope') { O.boardScope = v; O.board = null; loadBoard(); }
    else if (k === 'restart') { O.codeSent = false; }
    else if (k === 'google') { await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: here() } }); return; }
    else if (k === 'accept') { accept(v); return; }
    else if (k === 'remove') { unfriend(v); return; }
    else if (k === 'challenge') { const seed = chalNew(); CHAL[seed].target = v; saveChal(); S.ui.ch = seed; S.screen = 'chal'; render(); window.scrollTo({ top: 0 }); return; }
    else if (k === 'cloudload') { loadCloud(); return; }
    else if (k === 'cloudkeep') { O.cloud = null; uploadSaves(); }
    else if (k === 'upload') { await uploadSaves(); syncStats(); O.msg = 'Backed up.'; }
    else if (k === 'signout') { await sb.auth.signOut(); }
    else if (k === 'delete') {
      if (!O.confirmDel) { O.confirmDel = true; }
      else {
        const { error } = await sb.rpc('delete_me');
        if (error) return fail(error, 'Could not delete the account.');
        await sb.auth.signOut(); O.confirmDel = false; toast('Account deleted');
      }
    }
    rr();
  }
  async function submit(form) {
    O.msg = ''; O.err = '';
    if (form === 'email') {
      const email = ($('#on-email') || {}).value || '';
      if (!/^\S+@\S+\.\S+$/.test(email)) { O.err = 'Enter a valid email address.'; rr(); return; }
      O.email = email.trim(); O.busy = true; rr();
      const { error } = await sb.auth.signInWithOtp({ email: O.email, options: { emailRedirectTo: here(), shouldCreateUser: true } });
      O.busy = false; if (error) return fail(error, 'Could not send the email.');
      O.codeSent = true; rr();
    } else if (form === 'code') {
      const token = (($('#on-code') || {}).value || '').trim();
      if (!token) return;
      O.busy = true; rr();
      const { error } = await sb.auth.verifyOtp({ email: O.email, token, type: 'email' });
      O.busy = false; if (error) return fail(error, 'That code did not work. Check it, or request a new one.');
    } else if (form === 'username') {
      const u = (($('#on-user') || {}).value || '').trim(), prob = nameProblem(u);
      if (prob) { O.err = prob; rr(); return; }
      O.busy = true; rr();
      const { data, error } = await sb.from('profiles').insert({ id: O.user.id, username: u, ...localStats() }).select().maybeSingle();
      O.busy = false;
      if (error) return fail(error.code === '23505' ? { message: 'That username is taken. Try another.' } : error, 'Could not save the username.');
      O.profile = data; sfx('right'); pushTodayDaily(); loadFriends(); checkCloud(); loadBoard(); loadChallenges(); rr();
    } else if (form === 'friend') {
      addFriend(($('#on-friend') || {}).value);
    }
  }

  window.ZSOnline = {
    ready: true,
    label: () => O.profile ? '@' + O.profile.username : O.user ? 'Choose a username' : 'Sign in',
    render: render_,
    act, submit,
    // Called by the game whenever saves are written: keep stats and the cloud copy fresh
    onStore() {
      if (!O.profile) return;
      clearTimeout(statT); statT = setTimeout(syncStats, 4000);
      clearTimeout(saveT); saveT = setTimeout(uploadSaves, 20000);
    },
    onDaily(date, st) { postDaily(date, st); },
    myName: () => O.profile ? '@' + O.profile.username : null,
    friendsList: () => (O.profile && O.friends && O.friends.accepted) || [],
    inbox, playChallenge, sendChallenge, answerChallenge, refreshChallenges: loadChallenges,
    onAch() { if (O.profile) { clearTimeout(statT); statT = setTimeout(syncStats, 2000); } },
    pushInfo: () => ({ supported: pushOK(), ios: isIOS && !standalone, signedIn: !!O.profile, denied: 'Notification' in window && Notification.permission === 'denied', on: O.push.on, busy: O.push.busy, hour: REM.hour == null ? 19 : REM.hour }),
    enablePush, disablePush,
    // Anonymous play statistics (see privacy.html): fire and forget, failures are ignored
    logEvents(rows) { sb.from('play_events').insert(rows).then(() => {}, () => {}); },
    // "Report a problem": works signed in or not; signed-in reports carry the username
    async sendReport(r) {
      const { error } = await sb.from('reports').insert({ user_id: O.user ? O.user.id : null, subject: r.subject, kind: r.kind, note: r.note || null, context: r.context || null });
      return !error;
    },
    dailyBoardHTML(date) {
      if (!O.profile) return `<p class="hint">${O.user ? 'Choose a username' : 'Sign in'} under Friends &amp; leaderboards to compare today's score.</p>`;
      return `<span class="label" style="margin-top:12px;display:block">Today's leaderboard</span>${dailyRows(date)}`;
    }
  };
  rr();
})();
