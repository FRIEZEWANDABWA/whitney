-- ========================================================
-- ENTRYJOBS KE: INITIAL SOURCE SEED
-- Run this in the Supabase SQL Editor AFTER running supabase/schema.sql
-- and the phase_1/phase_2 migration scripts.
-- ========================================================
--
-- This mirrors the general job-board sources the original (IT/executive)
-- JobHunterAI system scraped from, MINUS the IT-only category filters and
-- Google SERP sources (the original system deleted those as "high risk,
-- low ROI" — see phase_1_migration.sql). Because job_sources rows here are
-- generic aggregators, the ENTRY-LEVEL targeting comes from the scorer
-- (lib/scoring-v2.ts + lib/title-boost.ts), not from the source URL itself.
--
-- IMPORTANT: I could not verify these URLs live (no network access from
-- this environment), and I did NOT include individual bank/NGO/embassy
-- career pages here, because getting a specific company's current careers
-- URL or ATS wrong creates a source that silently returns 0 jobs forever.
-- The original system had ~40 of those added one at a time via the Admin
-- panel (see README/admin below) — do the same here once you confirm the
-- current careers URL for each employer you want to track (KCB, Equity,
-- NCBA, Safaricom, Safal Group, UNICEF, UNDP, UNOPS, World Bank, AfDB,
-- Mastercard Foundation, embassies, etc. are all good graduate-programme
-- targets — the scorer already recognises those names and boosts them).

-- 1. BrighterMonday Kenya — general listings (largest KE board)
INSERT INTO public.job_sources (name, base_url, type, category, source_kind, strategy, priority, risk_level, active, crawl_frequency_minutes)
VALUES ('BrighterMonday Kenya', 'https://www.brightermonday.co.ke/jobs', 'html', 'Aggregator', 'aggregator', 'html', 'core', 'low', true, 60)
ON CONFLICT DO NOTHING;

-- 2. MyJobMag Kenya — general listings
INSERT INTO public.job_sources (name, base_url, type, category, source_kind, strategy, priority, risk_level, active, crawl_frequency_minutes)
VALUES ('MyJobMag Kenya', 'https://www.myjobmag.co.ke/', 'html', 'Aggregator', 'aggregator', 'html', 'core', 'low', true, 60)
ON CONFLICT DO NOTHING;

-- 3. Fuzu Kenya — general listings (React SPA, needs Playwright)
INSERT INTO public.job_sources (name, base_url, type, category, source_kind, strategy, priority, risk_level, active, crawl_frequency_minutes)
VALUES ('Fuzu Kenya', 'https://www.fuzu.com/kenya/jobs', 'html', 'Aggregator', 'aggregator', 'playwright', 'high', 'low', true, 120)
ON CONFLICT DO NOTHING;

-- 4. CareerJet Kenya — general listings (Playwright, anti-bot protected)
INSERT INTO public.job_sources (name, base_url, type, category, source_kind, strategy, priority, risk_level, active, crawl_frequency_minutes)
VALUES ('CareerJet Kenya', 'https://www.careerjet.co.ke/jobs', 'html', 'Aggregator', 'aggregator', 'playwright', 'core', 'moderate', true, 60)
ON CONFLICT DO NOTHING;

-- 5. KenyaJob.com — general listings
INSERT INTO public.job_sources (name, base_url, type, category, source_kind, strategy, priority, risk_level, active, crawl_frequency_minutes)
VALUES ('KenyaJob', 'https://www.kenyajob.com/job-vacancies-search-kenya', 'html', 'Aggregator', 'aggregator', 'playwright', 'medium', 'low', true, 360)
ON CONFLICT DO NOTHING;

-- 6. beBee Kenya — general listings (React, needs Playwright)
INSERT INTO public.job_sources (name, base_url, type, category, source_kind, strategy, priority, risk_level, active, crawl_frequency_minutes)
VALUES ('beBee Kenya', 'https://ke.bebee.com/jobs', 'html', 'Aggregator', 'aggregator', 'playwright', 'medium', 'low', true, 360)
ON CONFLICT DO NOTHING;

-- 7. AjiraZone — general listings (React SPA). Set the category filter to
--    "Internship" or "Entry Level" in the Admin panel once you confirm the URL.
INSERT INTO public.job_sources (name, base_url, type, category, source_kind, strategy, priority, risk_level, active, crawl_frequency_minutes)
VALUES ('AjiraZone', 'https://www.ajirazone.com/jobs', 'html', 'Aggregator', 'aggregator', 'playwright', 'medium', 'low', true, 360)
ON CONFLICT DO NOTHING;

-- 8. Corporate Staffing Solutions — Kenyan recruitment agency, posts a lot of
--    graduate/entry-level & internship roles
INSERT INTO public.job_sources (name, base_url, type, category, source_kind, strategy, priority, risk_level, active, crawl_frequency_minutes)
VALUES ('Corporate Staffing', 'https://www.corporatestaffing.co.ke/jobs/', 'html', 'Recruitment', 'aggregator', 'html', 'high', 'low', true, 120)
ON CONFLICT DO NOTHING;

-- 9. Eagle HR Consultants — Kenyan recruitment agency
INSERT INTO public.job_sources (name, base_url, type, category, source_kind, strategy, priority, risk_level, active, crawl_frequency_minutes)
VALUES ('Eagle HR Consultants', 'https://www.eaglehr.co.ke/careers', 'html', 'Recruitment', 'aggregator', 'html', 'medium', 'low', true, 360)
ON CONFLICT DO NOTHING;

-- 10. NGOJobsInAfrica — RSS feed, plenty of NGO internships/junior roles
INSERT INTO public.job_sources (name, base_url, type, category, source_kind, strategy, priority, risk_level, active, crawl_frequency_minutes)
VALUES ('NGOJobsInAfrica', 'https://ngojobsinafrica.com/media-rss/', 'rss', 'NGO', 'rss', 'rss', 'medium', 'low', true, 360)
ON CONFLICT DO NOTHING;

-- 11. ReliefWeb API — humanitarian/NGO jobs across Africa (filter for junior tags in-app)
INSERT INTO public.job_sources (name, base_url, type, category, source_kind, strategy, priority, risk_level, active, crawl_frequency_minutes)
VALUES ('ReliefWeb Kenya', 'https://api.reliefweb.int/v1/jobs?appname=entryjobs-ke&filter[field]=country&filter[value]=Kenya&sort[]=date.created:desc&limit=50', 'api', 'NGO', 'api', 'api', 'medium', 'low', true, 360)
ON CONFLICT DO NOTHING;

-- 12. RemoteOK API — remote roles; keep low priority since entry-level remote is rarer
INSERT INTO public.job_sources (name, base_url, type, category, source_kind, strategy, priority, risk_level, active, crawl_frequency_minutes)
VALUES ('Remote OK', 'https://remoteok.com/api', 'api', 'Remote', 'api', 'api', 'low', 'low', true, 720)
ON CONFLICT DO NOTHING;

-- 13. We Work Remotely — remote roles RSS, low priority for the same reason
INSERT INTO public.job_sources (name, base_url, type, category, source_kind, strategy, priority, risk_level, active, crawl_frequency_minutes)
VALUES ('We Work Remotely', 'https://weworkremotely.com/categories/remote-junior-jobs.rss', 'rss', 'Remote', 'rss', 'rss', 'low', 'low', true, 720)
ON CONFLICT DO NOTHING;
