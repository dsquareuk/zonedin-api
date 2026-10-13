-- v56 paywall: subscriptions (server-written only) + reviews. Run once in Supabase SQL editor.
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'none',
  plan_interval text,
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  updated_at timestamptz default now()
);
alter table public.subscriptions enable row level security;
drop policy if exists "subscriptions: read own" on public.subscriptions;
create policy "subscriptions: read own" on public.subscriptions for select using (auth.uid() = user_id);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('two_week','monthly')),
  period_start text not null,
  period_end text not null,
  stats jsonb not null default '{}'::jsonb,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists reviews_user_created on public.reviews(user_id, created_at desc);
create unique index if not exists reviews_one_two_week on public.reviews(user_id) where kind = 'two_week';
alter table public.reviews enable row level security;
drop policy if exists "reviews: read own" on public.reviews;
create policy "reviews: read own" on public.reviews for select using (auth.uid() = user_id);

-- The 17-day trial runs from profiles.created_at; stop the app (or anyone) from moving it.
create or replace function public.zi_lock_profile_created_at() returns trigger language plpgsql set search_path = public as $$
begin new.created_at := old.created_at; return new; end $$;
drop trigger if exists zi_lock_created_at on public.profiles;
create trigger zi_lock_created_at before update on public.profiles for each row execute function public.zi_lock_profile_created_at();

-- Existing accounts (the founder) get complimentary access.
insert into public.subscriptions (user_id, status) select id, 'comp' from public.profiles on conflict (user_id) do nothing;
