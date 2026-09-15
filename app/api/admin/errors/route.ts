import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/admin/errors
 * Returns recent scrape failures and retries joined with source names.
 * Powers the Scraper Error Console on the admin dashboard.
 */
export async function GET() {
    try {
        // Fetch failed / retrying scrape jobs with their source details
        const { data: errors, error } = await supabase
            .from('scrape_jobs')
            .select('id, status, last_error, retry_count, scheduled_at, started_at, completed_at, created_at, source_id, job_sources(id, name, base_url, strategy, source_health)')
            .in('status', ['failed', 'retrying'])
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;

        // Also fetch sources that have degraded/paused health status even if no scrape_job failure
        const { data: unhealthySources, error: healthError } = await supabase
            .from('job_sources')
            .select('id, name, base_url, strategy, source_health, last_run_at, active')
            .eq('active', true)
            .not('source_health', 'is', null);

        if (healthError) throw healthError;

        // Filter to only degraded or paused sources
        const degradedSources = (unhealthySources || []).filter(s => {
            const health = s.source_health;
            return health && (health.status === 'degraded' || health.status === 'paused' || health.consecutive_failures > 0);
        });

        // Build a summary of sources that have NEVER been run (last_run_at is null)
        const { data: neverRun, error: neverRunError } = await supabase
            .from('job_sources')
            .select('id, name, base_url, strategy, active, created_at')
            .eq('active', true)
            .is('last_run_at', null);

        if (neverRunError) throw neverRunError;

        return NextResponse.json({
            scrapeErrors: errors || [],
            degradedSources: degradedSources || [],
            neverRunSources: neverRun || [],
        });
    } catch (error: any) {
        console.error('Error fetching scraper errors:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

/**
 * DELETE /api/admin/errors
 * Clears resolved (completed/failed) scrape jobs older than 24 hours.
 */
export async function DELETE() {
    try {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const { error } = await supabase
            .from('scrape_jobs')
            .delete()
            .in('status', ['completed', 'failed'])
            .lt('created_at', oneDayAgo);

        if (error) throw error;

        return NextResponse.json({ success: true, message: 'Old resolved scrape jobs cleared.' });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
