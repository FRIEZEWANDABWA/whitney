-- ========================================================
-- JOBHUNTER AI: PHASE 2 OPERATIONAL HARDENING
-- Execute this directly in your Supabase SQL Editor
-- ========================================================

-- 1. ADD NEW METRICS COLUMNS
ALTER TABLE public.scrape_jobs 
ADD COLUMN IF NOT EXISTS queue_wait_seconds integer;

ALTER TABLE public.job_sources 
ADD COLUMN IF NOT EXISTS expected_job_volume text 
CHECK (expected_job_volume IN ('high', 'medium', 'low', 'very_low')) 
DEFAULT 'medium';

ALTER TABLE public.job_sources 
ADD COLUMN IF NOT EXISTS execution_tier text 
CHECK (execution_tier IN ('realtime', 'frequent', 'standard', 'slow')) 
DEFAULT 'standard';

-- 2. CREATE PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_status 
ON public.scrape_jobs(status);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_created 
ON public.scrape_jobs(created_at);

CREATE INDEX IF NOT EXISTS idx_job_sources_execution_tier 
ON public.job_sources(execution_tier);

-- 3. CREATE ATOMIC CLAIMING RPC (SKIP LOCKED)
CREATE OR REPLACE FUNCTION claim_scrape_jobs(p_worker_id text, p_strategies text[], p_limit int)
RETURNS TABLE (
    id uuid,
    source_id uuid,
    status text,
    scheduled_at timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    retry_count integer,
    last_error text,
    worker_id text,
    created_at timestamp with time zone,
    queue_wait_seconds integer
) AS $$
BEGIN
    RETURN QUERY
    WITH claimed AS (
        SELECT sj.id
        FROM public.scrape_jobs sj
        JOIN public.job_sources js ON js.id = sj.source_id
        WHERE sj.status = 'pending'
          AND sj.scheduled_at <= timezone('utc'::text, now())
          AND js.strategy = ANY(p_strategies)
        ORDER BY sj.scheduled_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT p_limit
    )
    UPDATE public.scrape_jobs
    SET status = 'running',
        started_at = timezone('utc'::text, now()),
        worker_id = p_worker_id
    WHERE public.scrape_jobs.id IN (SELECT claimed.id FROM claimed)
    RETURNING 
        public.scrape_jobs.id,
        public.scrape_jobs.source_id,
        public.scrape_jobs.status,
        public.scrape_jobs.scheduled_at,
        public.scrape_jobs.started_at,
        public.scrape_jobs.completed_at,
        public.scrape_jobs.retry_count,
        public.scrape_jobs.last_error,
        public.scrape_jobs.worker_id,
        public.scrape_jobs.created_at,
        public.scrape_jobs.queue_wait_seconds;
END;
$$ LANGUAGE plpgsql;
