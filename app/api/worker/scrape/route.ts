import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { scrapeSource } from '@/lib/scraper';
import { JobSource } from '@/types/source';

type ClaimedJob = {
    id: string;
    source_id: string;
    retry_count: number;
    scheduled_at: string;
    started_at: string;
    created_at: string;
    job_sources?: JobSource;
};

function chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }

    return chunks;
}

async function processJob(job: ClaimedJob) {
    const source = job.job_sources as JobSource;

    if (!source) {
        return {
            success: false,
            ingested: 0
        };
    }

    const startTime = Date.now();

    let newStatus = 'completed';
    let errorMsg: string | null = null;
    let jobsFound = 0;
    let totalIngested = 0;

    // ── Playwright sources: skip entirely in Vercel worker ──────────────────
    // These are handled by GitHub Actions playwright-scraper.yml.
    // Do not run, do not update health, mark queue job as completed silently.
    if ((source as any).strategy === 'playwright') {
        await supabase.from('scrape_jobs').update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            last_error: null,
        }).eq('id', job.id);
        return { success: true, ingested: 0 };
    }

    try {
        // Fetch recent hashes for dedupe
        const { data: existingJobs } = await supabase
            .from('jobs')
            .select('dedupe_hash')
            .eq('source_id', source.id)
            .order('created_at', { ascending: false })
            .limit(500);

        const existingHashes = new Set(
            existingJobs?.map((j: { dedupe_hash: string }) => j.dedupe_hash) || []
        );

        // Execute scraper
        const scrapedJobs = await scrapeSource(source, existingHashes);

        if (scrapedJobs && scrapedJobs.length > 0) {
            jobsFound = scrapedJobs.length;

            for (const parsedJob of scrapedJobs) {
                const { error: insertError } = await supabase
                    .from('jobs')
                    .insert(parsedJob);

                if (!insertError) {
                    totalIngested++;
                }
            }
        }

    } catch (err: any) {
        console.error(`Scrape failure for ${source.name}:`, err);

        errorMsg = err.message || 'Unknown error';

        if (job.retry_count < 3) {
            newStatus = 'retrying';
        } else {
            newStatus = 'failed';
        }
    }

    // Queue Metrics
    const latencyMs = Date.now() - startTime;

    const queueWaitMs =
        new Date(job.started_at).getTime() -
        new Date(job.created_at).getTime();

    const queueWaitSecs = Math.floor(queueWaitMs / 1000);

    // Retry scheduling
    const nextScheduledAt =
        newStatus === 'retrying'
            ? new Date(
                  Date.now() +
                      Math.pow(2, job.retry_count) * 60 * 1000
              ).toISOString()
            : job.scheduled_at;

    // Update scrape_jobs
    await supabase
        .from('scrape_jobs')
        .update({
            status: newStatus,
            completed_at:
                newStatus !== 'retrying'
                    ? new Date().toISOString()
                    : null,
            last_error: errorMsg,
            retry_count:
                newStatus === 'retrying'
                    ? job.retry_count + 1
                    : job.retry_count,
            scheduled_at: nextScheduledAt,
            queue_wait_seconds: queueWaitSecs
        })
        .eq('id', job.id);

    // Existing Health
    const oldHealth: any = source.source_health || {
        consecutive_failures: 0,
        success_rate: 100,
        avg_response_ms: 0,
        last_success_at: null,
        last_checked_at: null,
        jobs_found_last_run: 0,
        last_error: null,
        last_status_code: null,
        status: 'healthy',
        consecutive_zero_runs: 0
    };

    // Expected volume tuning
    // @ts-ignore
    const expectedVolume = source.expected_job_volume || 'medium';

    const isSuccess = newStatus === 'completed';

    const newFailures = isSuccess
        ? 0
        : (oldHealth.consecutive_failures || 0) + 1;

    let newZeroRuns =
        oldHealth.consecutive_zero_runs || 0;

    if (isSuccess) {
        if (jobsFound === 0) {
            newZeroRuns++;
        } else {
            newZeroRuns = 0;
        }
    }

    // Latency moving average
    const newLatency =
        oldHealth.avg_response_ms === 0
            ? latencyMs
            : Math.round(
                  (oldHealth.avg_response_ms + latencyMs) / 2
              );

    // Health rules
    let sourceStatus = 'healthy';

    if (newFailures >= 5) {
        sourceStatus = 'degraded';
    }

    if (newFailures >= 10) {
        sourceStatus = 'paused';
    }

    // Zero-job degradation thresholds
    let zeroThreshold = 2;

    if (expectedVolume === 'low') {
        zeroThreshold = 4;
    }

    if (expectedVolume === 'very_low') {
        zeroThreshold = 6;
    }

    if (isSuccess && newZeroRuns >= zeroThreshold) {
        sourceStatus = 'degraded';
    }

    // Update source health
    await supabase
        .from('job_sources')
        .update({
            last_run_at: new Date().toISOString(),
            source_health: {
                ...oldHealth,
                last_checked_at: new Date().toISOString(),
                last_success_at: isSuccess
                    ? new Date().toISOString()
                    : oldHealth.last_success_at,
                jobs_found_last_run: jobsFound,
                avg_response_ms: newLatency,
                consecutive_failures: newFailures,
                consecutive_zero_runs: newZeroRuns,
                last_error: errorMsg,
                status: sourceStatus
            }
        })
        .eq('id', source.id);

    // ─── Source Auto-Disabling ─────────────────────────────────────────────────
    // Prevent permanently broken sources from wasting queue cycles.
    // Triggered only after a completed run (not on errors — errors have their own retry logic).
    if (isSuccess) {
        if (newZeroRuns >= 50) {
            // Auto-pause: 50+ consecutive runs with 0 jobs = source is dead
            await supabase
                .from('job_sources')
                .update({ active: false })
                .eq('id', source.id);
            console.log(`[AUTO-PAUSE] ${source.name} paused after ${newZeroRuns} consecutive zero runs.`);
        } else if (newZeroRuns >= 20) {
            // Auto-throttle: 20+ zero runs = scraper is parsing but site has no jobs OR selectors are broken
            // Reduce to weekly to stop wasting worker slots every 2 hours
            await supabase
                .from('job_sources')
                .update({ crawl_frequency_minutes: 10080 })
                .eq('id', source.id);
            console.log(`[AUTO-THROTTLE] ${source.name} reduced to weekly after ${newZeroRuns} zero runs.`);
        }
    }

    return {
        success: true,
        ingested: totalIngested
    };
}

export async function POST(request: Request) {
    const authHeader = request.headers.get('authorization');

    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new NextResponse('Unauthorized', {
            status: 401
        });
    }

    try {
        // =========================================
        // 1. STALE JOB RECOVERY
        // =========================================

        const twentyMinsAgo = new Date(
            Date.now() - 20 * 60000
        ).toISOString();

        await supabase
            .from('scrape_jobs')
            .update({
                status: 'pending',
                worker_id: null,
                started_at: null
            })
            .eq('status', 'running')
            .lt('started_at', twentyMinsAgo);

        // =========================================
        // 2. CLAIM JOBS
        // =========================================

        const workerId = `worker-${Math.random()
            .toString(36)
            .substring(7)}`;

        let claimedJobs: ClaimedJob[] = [];

        const buckets = [
            {
                strategies: ['api', 'rss'],
                limit: 20
            },
            {
                strategies: [
                    'html',
                    'ats_bamboohr',
                    'ats_zoho',
                    'ats_csod',
                    'ats_mci',
                    'ats_greenhouse',
                    'ats_lever'
                ],
                limit: 10
            },
            {
                strategies: ['proxy_html'],
                limit: 3
            },
            {
                strategies: ['browser'],
                limit: 1
            }
        ];

        for (const bucket of buckets) {
            const { data } = await supabase.rpc(
                'claim_scrape_jobs',
                {
                    p_worker_id: workerId,
                    p_strategies: bucket.strategies,
                    p_limit: bucket.limit
                }
            );

            if (data && data.length > 0) {
                const sourceIds = data.map(
                    (j: any) => j.source_id
                );

                const { data: sources } = await supabase
                    .from('job_sources')
                    .select('*')
                    .in('id', sourceIds);

                const bucketJobs = data.map((j: any) => ({
                    ...j,
                    job_sources: sources?.find(
                        (s: any) => s.id === j.source_id
                    )
                }));

                claimedJobs.push(...bucketJobs);
            }
        }

        if (claimedJobs.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No jobs to process'
            });
        }

        console.log(
            `Worker ${workerId} claimed ${claimedJobs.length} jobs.`
        );

        // =========================================
        // 3. PROCESS JOBS IN PARALLEL CHUNKS
        // =========================================

        let totalIngested = 0;

        const chunks = chunkArray(claimedJobs, 5);

        for (const chunk of chunks) {
            const results = await Promise.all(
                chunk.map((job) => processJob(job))
            );

            for (const result of results) {
                totalIngested += result.ingested || 0;
            }
        }

        // =========================================
        // 4. RESPONSE
        // =========================================

        return NextResponse.json({
            success: true,
            worker: workerId,
            jobsProcessed: claimedJobs.length,
            totalIngested
        });

    } catch (error: any) {
        console.error('Worker Error:', error);

        return NextResponse.json(
            {
                success: false,
                error:
                    error.message || 'Internal Server Error'
            },
            {
                status: 500
            }
        );
    }
}
