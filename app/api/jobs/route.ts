import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { parseTierThresholdsFromSettings } from '@/lib/scoring-v2';

export async function GET(request: Request) {
    try {
        // 1. Resolve the primary system user
        const { data: profiles, error: profilesError } = await supabase
            .from('user_profiles')
            .select('id')
            .limit(1);

        if (profilesError) {
            // Surface real connection/query failures instead of silently treating them as
            // "no CV uploaded yet" — a broken Supabase URL/key should be visible, not hidden
            // behind an empty-state response.
            console.error('jobs/route.ts: failed to resolve user_profiles:', profilesError);
            return NextResponse.json({ error: profilesError.message || 'Failed to reach database' }, { status: 500 });
        }

        const user = profiles?.[0];

        if (!user) {
            return NextResponse.json({
                highMatches: [],
                strongMatches: [],
                globalJobs: [],
                watchJobs: [],
                googleJobs: [],
                otherJobs: [],
                appliedJobs: [],
                archivedJobs: [],
            });
        }

        const userId = user.id;

        // Fetch jobs with their match scores for this user
        // Join with applications to see status ('applied', 'rejected', etc)
        const { data: jobs, error } = await supabase
            .from('jobs')
            .select(`
         *,
         match_scores!inner(score),
         applications(status),
         job_sources(name, type)
       `)
            .eq('match_scores.user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Fetch system_settings
        const { data: settings } = await supabase.from('system_settings').select('key, value');
        const th = parseTierThresholdsFromSettings(settings ?? null);

        // Categorize jobs
        const formattedJobs = jobs?.map(job => {
            const score = Array.isArray(job.match_scores) ? job.match_scores[0]?.score : (job.match_scores as any)?.score;

            // Extract the user's application status on this specific job
            let status = null;
            if (job.applications && Array.isArray(job.applications) && job.applications.length > 0) {
                status = job.applications[0].status;
            } else if (job.applications && (job.applications as any).status) {
                status = (job.applications as any).status;
            }

            const sourceType = job.job_sources ? (Array.isArray(job.job_sources) ? job.job_sources[0]?.type : (job.job_sources as any).type) : null;
            const sourceName = job.job_sources ? (Array.isArray(job.job_sources) ? job.job_sources[0]?.name : (job.job_sources as any).name) : null;

            return { ...job, match_score: score, status, type: sourceType, source_name: sourceName };
        }).sort((a, b) => b.match_score - a.match_score) || [];

        const archivedJobs = formattedJobs.filter(j => j.status === 'rejected');
        const activeJobs = formattedJobs.filter(j => j.status !== 'rejected');
        const unappliedJobs = activeJobs.filter(j => !['applied', 'interviewing', 'offer'].includes(j.status));
        const appliedJobs = activeJobs.filter(j => ['applied', 'interviewing', 'offer'].includes(j.status));

        // ─── Global Opportunities Sources ────────────────────────────────────────
        // These are international/remote/NGO sources that bypass local AI scoring tiers.
        // Jobs from these sources are routed directly to the 🌍 Global Opportunities tab.
        const GLOBAL_SOURCES = [
            // Remote Tech Platforms
            'We Work Remotely',
            'Remote OK',
            'Wellfound (AngelList)',
            // NGO / International Development
            'NGOJobsInAfrica',
            'ReliefWeb',
            'ReliefWeb (IT Africa)',
            'Impactpool',
            'Devex (IT Jobs)',
            // UN System
            'UN Talent Kenya',
            'UNDP Careers',
            'UNICEF',
            'UN Women',
            'World Food Programme',
            'UNOPS',
            // International Financial Institutions
            'World Bank Careers',
            'African Development Bank',
            'International Finance Corporation',
            'European Investment Bank',
            // International Foundations
            'Bill & Melinda Gates Foundation',
            'Rockefeller Foundation',
            'Ford Foundation',
        ];
        
        const globalUnapplied = unappliedJobs.filter(j => GLOBAL_SOURCES.includes(j.source_name));
        const regularUnapplied = unappliedJobs.filter(j => !GLOBAL_SOURCES.includes(j.source_name));

        const highMatches = regularUnapplied.filter((j) => j.match_score >= th.notify && j.type !== 'google');
        const strongMatches = regularUnapplied.filter(
            (j) => j.match_score >= th.dashboard && j.match_score < th.notify && j.type !== 'google'
        );
        const watchJobs = regularUnapplied.filter(
            (j) => j.match_score >= th.watch && j.match_score < th.dashboard && j.type !== 'google'
        );
        const googleJobs = regularUnapplied.filter((j) => j.type === 'google');
        const otherJobs = regularUnapplied.filter((j) => j.match_score < th.watch && j.type !== 'google');

        return NextResponse.json({ highMatches, strongMatches, watchJobs, googleJobs, otherJobs, globalJobs: globalUnapplied, appliedJobs, archivedJobs });
    } catch (error: any) {
        console.error('Fetch Jobs Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
