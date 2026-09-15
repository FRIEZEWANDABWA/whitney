-- ========================================================
-- JOBHUNTER AI: PHASE 1 ARCHITECTURE MIGRATION
-- Execute this directly in your Supabase SQL Editor
-- ========================================================

-- --------------------------------------------------------
-- PART 0: CLEANUP & PURGE
-- --------------------------------------------------------

-- 1. Purge all Google SERP sources (High Risk / Low ROI)
DELETE FROM public.job_sources WHERE type = 'google';

-- 2. Purge exact duplicates (keep the most recent ones)
DELETE FROM public.job_sources a USING public.job_sources b
WHERE a.name = b.name
AND a.base_url = b.base_url
AND a.created_at < b.created_at;

-- 3. Fix NGOJobsInAfrica URL & Type
UPDATE public.job_sources 
SET base_url = 'https://ngojobsinafrica.com/media-rss/',
    type = 'rss'
WHERE name = 'NGOJobsInAfrica';

-- --------------------------------------------------------
-- PART 1: SCHEMA UPGRADES TO job_sources
-- --------------------------------------------------------

-- Add source_kind (what the source IS)
ALTER TABLE public.job_sources
ADD COLUMN IF NOT EXISTS source_kind text 
  CHECK (source_kind IN ('aggregator', 'ats', 'api', 'rss', 'company', 'embassy', 'ngo'))
  DEFAULT 'aggregator';

-- Add strategy (HOW we scrape it)
ALTER TABLE public.job_sources
ADD COLUMN IF NOT EXISTS strategy text 
  CHECK (strategy IN ('html', 'proxy_html', 'browser', 'api', 'rss', 'ats_bamboohr', 'ats_greenhouse', 'ats_lever', 'ats_zoho', 'ats_workable', 'ats_csod', 'ats_mci', 'playwright'))
  DEFAULT 'html';

-- Add source_health with full latency tracking
ALTER TABLE public.job_sources
ADD COLUMN IF NOT EXISTS source_health jsonb 
  DEFAULT '{"consecutive_failures": 0, "success_rate": 100, "avg_response_ms": 0, "last_success_at": null, "last_checked_at": null, "jobs_found_last_run": 0, "last_error": null, "last_status_code": null, "status": "healthy"}';

-- Add priority and risk level
ALTER TABLE public.job_sources
ADD COLUMN IF NOT EXISTS priority text CHECK (priority IN ('core', 'high', 'medium', 'low')) DEFAULT 'medium';

ALTER TABLE public.job_sources
ADD COLUMN IF NOT EXISTS risk_level text CHECK (risk_level IN ('low', 'moderate', 'high')) DEFAULT 'low';

-- Add rate limiting and configs
ALTER TABLE public.job_sources
ADD COLUMN IF NOT EXISTS crawl_frequency_minutes integer DEFAULT 360;

ALTER TABLE public.job_sources
ADD COLUMN IF NOT EXISTS crawl_timeout_seconds integer DEFAULT 15;

ALTER TABLE public.job_sources
ADD COLUMN IF NOT EXISTS last_jobs_hash text DEFAULT NULL;

ALTER TABLE public.job_sources
ADD COLUMN IF NOT EXISTS robots_policy text CHECK (robots_policy IN ('strict', 'ignore', 'api_only')) DEFAULT 'strict';


-- --------------------------------------------------------
-- PART 2: THE NEW QUEUE SYSTEM (scrape_jobs)
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.scrape_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.job_sources(id) ON DELETE CASCADE,
  status text CHECK (status IN ('pending', 'running', 'completed', 'failed', 'retrying')) DEFAULT 'pending',
  scheduled_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  retry_count integer DEFAULT 0,
  last_error text,
  worker_id text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- Enable RLS on the queue table
ALTER TABLE public.scrape_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated read/write on scrape_jobs" ON public.scrape_jobs FOR ALL USING (auth.role() = 'authenticated');
