import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    try {
        const now = new Date();
        const body = await request.json().catch(() => ({}));
        const forceAll = body?.force === true;

        // 1. Fetch active Job Sources
        let allSources: any[] | null = null;
        try {
            const { data, error: sourceError } = await supabase
                .from('job_sources')
                .select('*')
                .eq('active', true);
            if (sourceError) throw sourceError;
            allSources = data;
        } catch (e: any) {
            throw new Error(`[STEP 1: fetch job_sources] ${e?.message || e}`);
        }
        if (!allSources || allSources.length === 0) return NextResponse.json({ message: 'No active sources' });

        // 2. Fetch currently pending or running jobs to avoid duplicate queueing
        let activeJobs: any[] | null = null;
        try {
            const { data, error: activeJobsError } = await supabase
                .from('scrape_jobs')
                .select('source_id')
                .in('status', ['pending', 'running', 'retrying']);
            if (activeJobsError) throw activeJobsError;
            activeJobs = data;
        } catch (e: any) {
            throw new Error(`[STEP 2: fetch active scrape_jobs] ${e?.message || e}`);
        }
        const activeSourceIds = new Set(activeJobs?.map(j => j.source_id) || []);

        // 3. Filter sources that need to be enqueued
        const sourcesToEnqueue = allSources.filter(source => {
            if (activeSourceIds.has(source.id)) return false; // Already in queue
            if (forceAll) return true;

            const frequency = source.crawl_frequency_minutes || 360;
            if (!source.last_run_at) return true;

            const diffMins = (now.getTime() - new Date(source.last_run_at).getTime()) / (1000 * 60);
            return diffMins >= frequency;
        });

        if (sourcesToEnqueue.length === 0) {
            return NextResponse.json({ message: 'No sources due for scraping.' });
        }

        // 4. Group by Domain to apply Jitter (Rate Limiting)
        const domainGroups: Record<string, any[]> = {};
        for (const source of sourcesToEnqueue) {
            try {
                const url = new URL(source.base_url);
                const domain = url.hostname;
                if (!domainGroups[domain]) domainGroups[domain] = [];
                domainGroups[domain].push(source);
            } catch (e) {
                // Fallback if URL is malformed
                const domain = 'unknown';
                if (!domainGroups[domain]) domainGroups[domain] = [];
                domainGroups[domain].push(source);
            }
        }

        // 5. Prepare inserts with randomized Jitter for same-domain requests
        const inserts = [];
        for (const domain in domainGroups) {
            const sources = domainGroups[domain];
            
            // Randomize order within domain
            sources.sort(() => Math.random() - 0.5);

            for (let i = 0; i < sources.length; i++) {
                const source = sources[i];
                const scheduledAt = new Date(now.getTime());
                
                // Add jitter: first source runs now, subsequent sources run delayed by 15-90s each
                if (i > 0) {
                    const jitterSeconds = Math.floor(Math.random() * (90 - 15 + 1)) + 15;
                    // cumulative delay so they don't all run at 90s
                    scheduledAt.setSeconds(scheduledAt.getSeconds() + (i * jitterSeconds)); 
                }

                inserts.push({
                    source_id: source.id,
                    status: 'pending',
                    scheduled_at: scheduledAt.toISOString(),
                });
            }
        }

        // 6. Insert into queue
        try {
            const { error: insertError } = await supabase
                .from('scrape_jobs')
                .insert(inserts);
            if (insertError) throw insertError;
        } catch (e: any) {
            throw new Error(`[STEP 6: insert scrape_jobs] ${e?.message || e}`);
        }

        // 7. AUTO-CLEANUP: Run cleanup only once per day
        const todayStr = new Date().toISOString().split('T')[0];
        let settings: any = null;
        try {
            const { data, error: settingsError } = await supabase.from('system_settings').select('key, value').eq('key', 'last_cleanup_date').maybeSingle();
            if (settingsError) throw settingsError;
            settings = data;
        } catch (e: any) {
            throw new Error(`[STEP 7: fetch last_cleanup_date] ${e?.message || e}`);
        }

        let cleaned = 0;
        let activeCleaned = 0;

        if (!settings || settings.value !== todayStr) {
          try {
            console.log(`Running daily cleanup for ${todayStr}...`);
            const fiveDaysAgo = new Date();
            fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
            const { data: staleApps } = await supabase.from('applications').select('job_id').eq('status', 'rejected').lt('applied_at', fiveDaysAgo.toISOString());

            if (staleApps && staleApps.length > 0) {
                const staleJobIds = staleApps.map(a => a.job_id);
                const { error } = await supabase.from('jobs').delete().in('id', staleJobIds);
                if (!error) cleaned = staleJobIds.length;
            }

            // Retention window (days) for jobs with zero user interaction — configurable via
            // system_settings.job_retention_days (Admin panel), defaults to 14 (two weeks).
            const { data: retentionSetting } = await supabase.from('system_settings').select('value').eq('key', 'job_retention_days').maybeSingle();
            const retentionDays = retentionSetting?.value ? parseInt(String(retentionSetting.value).replace(/^"|"$/g, ''), 10) : 14;
            const retentionCutoff = new Date();
            retentionCutoff.setDate(retentionCutoff.getDate() - (Number.isFinite(retentionDays) ? retentionDays : 14));
            const { data: oldJobs } = await supabase.from('jobs').select('id, applications(id)').lt('created_at', retentionCutoff.toISOString());
            if (oldJobs) {
                const unappliedJobIds = oldJobs.filter(j => !j.applications || (Array.isArray(j.applications) && j.applications.length === 0)).map(j => j.id);
                if (unappliedJobIds.length > 0) {
                    const { error } = await supabase.from('jobs').delete().in('id', unappliedJobIds);
                    if (!error) activeCleaned = unappliedJobIds.length;
                }
            }

            if (settings) {
                await supabase.from('system_settings').update({ value: todayStr }).eq('key', 'last_cleanup_date');
            } else {
                await supabase.from('system_settings').insert({ key: 'last_cleanup_date', value: todayStr });
            }
          } catch (e: any) {
            throw new Error(`[STEP 8: daily cleanup block] ${e?.message || e}`);
          }
        }

        return NextResponse.json({
            success: true,
            message: `Enqueued ${inserts.length} sources for scraping. Cleanup: ${cleaned + activeCleaned} total.`
        });
    } catch (error: any) {
        console.error('Queue Ingestion Error:', error);
        return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
