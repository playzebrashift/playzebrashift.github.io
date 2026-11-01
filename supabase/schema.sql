-- Zebra Shift online features: profiles, friends, leaderboards and cloud saves.
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run.
-- It is safe to run more than once.

-- Player profiles. Usernames, doctor portraits and scores are public so leaderboards work;
-- email addresses stay private inside Supabase Auth and are never stored here.
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  display text check (char_length(display) <= 60),
  doctor jsonb,
  spec text check (char_length(spec) <= 40),
  best integer not null default 0 check (best between 0 and 50000000),
  cases integer not null default 0 check (cases between 0 and 1000),
  runs integer not null default 0 check (runs >= 0),
  ems integer not null default 0 check (ems >= 0),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_username_lower on public.profiles (lower(username));

-- One row per player per Case of the day
create table if not exists public.daily_scores (
  user_id uuid not null references public.profiles on delete cascade,
  day date not null,
  score integer not null check (score between 0 and 1000),
  clues integer not null default 0 check (clues between 0 and 20),
  wrong integer not null default 0 check (wrong between 0 and 5),
  won boolean not null default false,
  primary key (user_id, day)
);

-- Friend requests; status becomes 'accepted' when the other player agrees
create table if not exists public.friendships (
  requester uuid not null references public.profiles on delete cascade,
  addressee uuid not null references public.profiles on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);

-- Each player's careers, so the same save follows them between devices
create table if not exists public.saves (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.daily_scores enable row level security;
alter table public.friendships enable row level security;
alter table public.saves enable row level security;

-- Profiles: anyone can read (leaderboards); you can only create and edit your own
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select using (true);
drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles for insert with check (id = auth.uid());
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Daily scores: anyone can read; you write only your own
drop policy if exists "daily read" on public.daily_scores;
create policy "daily read" on public.daily_scores for select using (true);
drop policy if exists "daily insert own" on public.daily_scores;
create policy "daily insert own" on public.daily_scores for insert with check (user_id = auth.uid());
drop policy if exists "daily update own" on public.daily_scores;
create policy "daily update own" on public.daily_scores for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Friendships: only the two people involved can see a request; only the recipient can accept;
-- either side can remove it
drop policy if exists "friends read" on public.friendships;
create policy "friends read" on public.friendships for select using (auth.uid() in (requester, addressee));
drop policy if exists "friends request" on public.friendships;
create policy "friends request" on public.friendships for insert with check (requester = auth.uid() and status = 'pending');
drop policy if exists "friends accept" on public.friendships;
create policy "friends accept" on public.friendships for update using (addressee = auth.uid()) with check (addressee = auth.uid() and status = 'accepted');
drop policy if exists "friends remove" on public.friendships;
create policy "friends remove" on public.friendships for delete using (auth.uid() in (requester, addressee));

-- Saves: private to their owner
drop policy if exists "saves own" on public.saves;
create policy "saves own" on public.saves for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Lets a signed-in player delete their account and everything linked to it
create or replace function public.delete_me() returns void
language sql security definer set search_path = public, auth as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_me() from public, anon;
grant execute on function public.delete_me() to authenticated;

-- ---------------------------------------------------------------------------
-- Added with challenges, achievements and daily reminders. Run the whole file again; it is safe.

-- How many achievements each player has (shown on their profile)
alter table public.profiles add column if not exists ach integer not null default 0 check (ach between 0 and 500);

-- Friend challenges: the same five patients for both players
create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles on delete cascade,
  to_id uuid not null references public.profiles on delete cascade,
  seed text not null check (char_length(seed) between 4 and 16),
  cases jsonb not null,
  from_scores jsonb not null,
  to_scores jsonb,
  created_at timestamptz not null default now(),
  check (from_id <> to_id)
);
alter table public.challenges enable row level security;
drop policy if exists "challenges read" on public.challenges;
create policy "challenges read" on public.challenges for select using (auth.uid() in (from_id, to_id));
-- You can only challenge someone who has accepted your friend request (or whose request you accepted)
drop policy if exists "challenges send" on public.challenges;
create policy "challenges send" on public.challenges for insert with check (
  from_id = auth.uid() and to_scores is null and exists (
    select 1 from public.friendships f where f.status = 'accepted'
      and ((f.requester = from_id and f.addressee = to_id) or (f.requester = to_id and f.addressee = from_id))));
-- Only the person challenged can fill in their scores, and only that column
drop policy if exists "challenges answer" on public.challenges;
create policy "challenges answer" on public.challenges for update using (to_id = auth.uid()) with check (to_id = auth.uid());
revoke update on public.challenges from anon, authenticated;
grant update (to_scores) on public.challenges to authenticated;
drop policy if exists "challenges remove" on public.challenges;
create policy "challenges remove" on public.challenges for delete using (auth.uid() in (from_id, to_id));

-- Daily reminder notifications: one row per device that asked for them
create table if not exists public.push_subs (
  endpoint text primary key check (char_length(endpoint) < 1000),
  user_id uuid not null references auth.users on delete cascade,
  p256dh text not null,
  auth text not null,
  hour_utc integer not null check (hour_utc between 0 and 23),
  tz_offset integer not null default 0 check (tz_offset between -900 and 900),
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists "push own" on public.push_subs;
create policy "push own" on public.push_subs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- "Report a problem": players flag a case or picture that looks medically wrong.
-- Anyone can send one; nobody can read them through the app. Read them in Table Editor → reports.
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete set null,
  subject text not null check (char_length(subject) <= 120),
  kind text not null check (kind in ('clue', 'answer', 'tx', 'picture', 'teach', 'typo', 'other')),
  note text check (char_length(note) <= 1000),
  context jsonb,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;
drop policy if exists "reports send" on public.reports;
create policy "reports send" on public.reports for insert to anon, authenticated
  with check ((user_id is null or user_id = auth.uid()) and done = false);
grant insert on public.reports to anon, authenticated;

-- Newest reports first, with the reporter's username
create or replace view public.report_inbox with (security_invoker = true) as
  select r.id, r.created_at, r.subject, r.kind, r.note, p.username, r.done
  from public.reports r left join public.profiles p on p.id = r.user_id
  order by r.created_at desc;
revoke all on public.report_inbox from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Anonymous play statistics for the admin dashboard (admin.html).
-- Each device gets a random ID; no names, email addresses, answers or saves are stored.
-- Anyone can add rows, nobody can read them directly: admin_stats() answers only for accounts in public.admins.
create table if not exists public.play_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  device text not null check (char_length(device) between 8 and 40),
  session text not null check (char_length(session) between 8 and 40),
  kind text not null check (kind in ('open', 'beat', 'run_start', 'run_end', 'hunt', 'daily', 'career')),
  area text check (char_length(area) <= 24),
  diff text check (char_length(diff) <= 20),
  spec text check (char_length(spec) <= 20),
  value integer check (value between -1 and 100000000),
  secs integer check (secs between 0 and 86400),
  installed boolean
);
create index if not exists play_events_at on public.play_events (at);
create index if not exists play_events_device on public.play_events (device, at);
alter table public.play_events enable row level security;
drop policy if exists "play events add" on public.play_events;
create policy "play events add" on public.play_events for insert to anon, authenticated
  with check (at between now() - interval '5 minutes' and now() + interval '5 minutes');
grant insert on public.play_events to anon, authenticated;

-- Who may see the dashboard. Add yourself once in the SQL Editor (see README):
--   insert into public.admins select id from auth.users where email = 'you@example.com';
create table if not exists public.admins (user_id uuid primary key references auth.users on delete cascade);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

-- Everything the dashboard shows, in one call. Days are counted in Jakarta time (WIB).
create or replace function public.admin_stats(days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  tz constant text := 'Asia/Jakarta';
  d integer := greatest(1, least(coalesce(days, 30), 180));
  today date := (now() at time zone tz)::date;
  since timestamptz := now() - make_interval(days => d);
  res jsonb;
begin
  if not exists (select 1 from public.admins where user_id = auth.uid()) then
    raise exception 'not an admin' using errcode = '42501';
  end if;
  with ev as (
    select e.*, (e.at at time zone tz)::date as day from public.play_events e
    where e.at > now() - make_interval(days => greatest(d, 31) + 8)
  ), fs as (
    select device, min((at at time zone tz)::date) as first_day from public.play_events group by device
  ), rng as (select * from ev where at > since)
  select jsonb_build_object(
    'tz', 'WIB', 'days', d, 'generated', now(),
    'totals', jsonb_build_object(
      'dau', (select count(distinct device) from ev where at > now() - interval '1 day'),
      'wau', (select count(distinct device) from ev where at > now() - interval '7 days'),
      'mau', (select count(distinct device) from ev where at > now() - interval '30 days'),
      'active', (select count(distinct device) from rng),
      'new', (select count(*) from fs where first_day > today - d),
      'devices', (select count(*) from fs),
      'sessions', (select count(distinct session) from rng),
      'minutes', (select coalesce(sum(secs), 0) / 60 from rng where kind = 'beat'),
      'avg_session_min', (select round(avg(s) / 60.0, 1) from (select sum(secs) s from rng where kind = 'beat' group by session) x),
      'installed_pct', (select round(100.0 * count(distinct device) filter (where installed) / nullif(count(distinct device), 0)) from rng where kind = 'open'),
      'accounts', (select count(*) from public.profiles)),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', g.day, 'active', coalesce(a.active, 0), 'new', coalesce(n.new, 0), 'minutes', coalesce(a.minutes, 0)) order by g.day), '[]'::jsonb)
      from (select generate_series(today - (d - 1), today, interval '1 day')::date as day) g
      left join (select day, count(distinct device) as active, coalesce(sum(secs) filter (where kind = 'beat'), 0) / 60 as minutes from ev group by day) a using (day)
      left join (select first_day as day, count(*) as new from fs group by first_day) n using (day)),
    'retention', (select jsonb_build_object(
      'd1_cohort', count(*) filter (where f.first_day between today - d and today - 1),
      'd1_back', count(*) filter (where f.first_day between today - d and today - 1
        and exists (select 1 from ev e where e.device = f.device and e.day = f.first_day + 1)),
      'd7_cohort', count(*) filter (where f.first_day between today - 6 - d and today - 7),
      'd7_back', count(*) filter (where f.first_day between today - 6 - d and today - 7
        and exists (select 1 from public.play_events e where e.device = f.device and (e.at at time zone tz)::date >= f.first_day + 7)))
      from fs f),
    'areas', (select coalesce(jsonb_object_agg(a, m), '{}'::jsonb) from (select coalesce(area, 'other') a, round(sum(secs) / 60.0) m from rng where kind = 'beat' group by 1) x),
    'diffs', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select coalesce(diff, 'unknown') k, count(*) n from rng where kind = 'run_start' group by 1) x),
    'specs', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select coalesce(spec, 'unknown') k, count(*) n from rng where kind = 'run_start' group by 1) x),
    'runs', (select jsonb_build_object('started', count(*) filter (where kind = 'run_start'), 'finished', count(*) filter (where kind = 'run_end'),
      'avg_shift', round(avg(value) filter (where kind = 'run_end'), 1), 'avg_minutes', round(avg(secs) filter (where kind = 'run_end') / 60.0, 1)) from rng),
    'shifts', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (select least(value, 10) s, count(*) n from rng where kind = 'run_end' and value >= 1 group by 1) x),
    'hunt', (select jsonb_build_object('played', count(*), 'avg', round(avg(value), 1)) from rng where kind = 'hunt'),
    'hunt_scores', (select coalesce(jsonb_object_agg(v, n), '{}'::jsonb) from (select value v, count(*) n from rng where kind = 'hunt' group by 1) x),
    'daily_case', (select jsonb_build_object('played', count(*), 'won', count(*) filter (where area = 'won'), 'avg_score', round(avg(value))) from rng where kind = 'daily'),
    'careers', (select count(*) from rng where kind = 'career'),
    'hours', (select jsonb_agg(coalesce(x.n, 0) order by h) from generate_series(0, 23) h
      left join (select extract(hour from at at time zone tz)::int hr, count(*) n from rng where kind = 'beat' group by 1) x on x.hr = h)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_stats(integer) from public, anon;
grant execute on function public.admin_stats(integer) to authenticated;

notify pgrst, 'reload schema';
