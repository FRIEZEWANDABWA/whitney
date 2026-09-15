-- ==========================================
-- AI ENTRY-LEVEL JOB INTELLIGENCE SYSTEM (KENYA)
-- ==========================================
-- Database Schema for Supabase (PostgreSQL)
-- Features: pgvector, deductiplication, trigger-based updates

-- 1. Enable pgvector extension for AI embeddings
create extension if not exists vector;

-- 2. System Settings (Thresholds & Config)
create table system_settings (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  value jsonb not null,
  description text,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

insert into system_settings (key, value, description) values
  ('notify_threshold', '0.75', 'Minimum score to trigger email/Telegram notifications'),
  ('dashboard_threshold', '0.55', 'Minimum score to show on the dashboard'),
  ('watch_threshold', '0.40', 'Minimum score for Watch tab (between Other and Strong)'),
  ('job_retention_days', '14', 'Auto-delete jobs with zero user interaction (no applications/saves) after this many days, to avoid feed congestion');

-- 3. Users and Profiles (Ready for multi-user, currently single admin)
create table user_profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  email text unique not null,
  cv_text text, -- The raw text from the uploaded CV
  cv_embedding vector(1536), -- OpenAI text-embedding-ada-002 is 1536 dims
  telegram_chat_id text,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- 4. Job Sources (Configurable from Admin Panel)
create table job_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_url text not null,
  type text not null check (type in ('rss', 'api', 'html', 'google')),
  category text not null default 'Other', -- e.g., 'NGO', 'Corporate', 'Government', 'Tech', 'Remote'
  parsing_config jsonb, -- JSON rules for scraping (e.g., selectors)
  active boolean default true,
  last_run_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- 5. Jobs Table with Deduplication
create table jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  company text not null,
  location text,
  description text not null,
  url text unique not null, -- Unique constraint to prevent exact URL duplicates
  dedupe_hash text unique not null, -- hash(title + company + posted_date) for fallback deduplication
  source_id uuid references job_sources(id) on delete set null,
  posted_date timestamp with time zone,
  embedding vector(1536), -- Job description embedding (IS NULL until embedded)
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Optimize similarity search queries (ivfflat index)
create index on jobs using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- 6. Match Scores
create table match_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade not null,
  job_id uuid references jobs(id) on delete cascade not null,
  score float not null, -- Final match score (v1: semantic + boost; v2: multi-signal)
  score_components jsonb, -- Optional breakdown when using scoring v2
  calculated_at timestamp with time zone default timezone('utc'::text, now()),
  unique(user_id, job_id)
);

-- 7. Notifications Log (Prevent duplicate alerts)
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade not null,
  job_id uuid references jobs(id) on delete cascade not null,
  type text not null check (type in ('email', 'telegram', 'both')),
  sent_at timestamp with time zone default timezone('utc'::text, now()),
  unique(user_id, job_id, type)
);

-- 8. Applications (Job tracking)
create table applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade not null,
  job_id uuid references jobs(id) on delete cascade not null,
  status text not null default 'saved' check (status in ('saved', 'applied', 'interviewing', 'rejected', 'offer')),
  applied_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  unique(user_id, job_id)
);

-- 9. Intelligence Layer: Skill Trends
create table skill_trends (
  id uuid primary key default gen_random_uuid(),
  skill text unique not null,
  frequency integer default 1,
  last_seen timestamp with time zone default timezone('utc'::text, now())
);

-- ==========================================
-- Security (Row Level Security - RLS)
-- ==========================================

-- Enable RLS on all tables
alter table system_settings enable row level security;
alter table user_profiles enable row level security;
alter table job_sources enable row level security;
alter table jobs enable row level security;
alter table match_scores enable row level security;
alter table notifications enable row level security;
alter table applications enable row level security;
alter table skill_trends enable row level security;

-- Create a policy allowing only authenticated users to access data
-- Because this is a private dashboard, we enforce auth on everything.

create policy "Allow authenticated read access" on system_settings for select using (auth.role() = 'authenticated');
create policy "Allow authenticated all access" on system_settings for all using (auth.role() = 'authenticated');

create policy "Users can view own profile" on user_profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on user_profiles for update using (auth.uid() = id);

create policy "Allow authenticated read/write on job_sources" on job_sources for all using (auth.role() = 'authenticated');
create policy "Allow authenticated read/write on jobs" on jobs for all using (auth.role() = 'authenticated');

create policy "Users can view own match_scores" on match_scores for select using (auth.uid() = user_id);
create policy "Users can insert own match_scores" on match_scores for insert with check (auth.uid() = user_id);
create policy "Users can delete own match_scores" on match_scores for delete using (auth.uid() = user_id);
create policy "Users can update own match_scores" on match_scores for update using (auth.uid() = user_id);

create policy "Users can view own notifications" on notifications for select using (auth.uid() = user_id);
create policy "Users can insert own notifications" on notifications for insert with check (auth.uid() = user_id);

create policy "Users can manage own applications" on applications for all using (auth.uid() = user_id);

create policy "Allow authenticated read/write on skill_trends" on skill_trends for all using (auth.role() = 'authenticated');

-- ==========================================
-- Triggers and Functions
-- ==========================================

-- Function to automatically update the 'updated_at' column
create or replace function update_updated_at_column()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language 'plpgsql';

create trigger update_user_profiles_updated_at
    before update on user_profiles
    for each row execute procedure update_updated_at_column();

create trigger update_system_settings_updated_at
    before update on system_settings
    for each row execute procedure update_updated_at_column();

-- Function to handle new user registration from Supabase Auth
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.user_profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email);
  return new;
end;
$$ language plpgsql security definer;

-- Trigger to automatically create a user profile when a new auth user signs up
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ==========================================
-- Note on pgvector Cosine Similarity
-- ==========================================
-- To measure similarity in Edge Functions / Next.js API, use:
-- 1 - (embedding <=> target_embedding) AS similarity
-- Since pgvector `<=>` operator returns cosine distance.
