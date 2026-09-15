import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

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
            console.error('velocity/route.ts: failed to resolve user_profiles:', profilesError);
            return NextResponse.json({ error: profilesError.message || 'Failed to reach database' }, { status: 500 });
        }

        const user = profiles?.[0];

        if (!user) {
            return NextResponse.json({ jobsFound: 0, highMatches: 0, applicationsSent: 0, conversionRate: 0 });
        }

        const userId = user.id;

        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const oneWeekAgoIso = oneWeekAgo.toISOString();

        // 1. Jobs found per week (total jobs inserted in last 7 days)
        const { count: jobsFound } = await supabase
            .from('jobs')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', oneWeekAgoIso);

        // Fetch dynamic system_settings
        const { data: settings } = await supabase.from('system_settings').select('key, value');
        const rawNotify = settings?.find((s) => s.key === 'notify_threshold')?.value;
        const notifyThreshold = parseFloat(
            rawNotify === undefined || rawNotify === null ? '0.75' : String(rawNotify).replace(/^"|"$/g, '')
        );

        // 2. High matches per week (score >= notifyThreshold in last 7 days)
        const { count: highMatches } = await supabase
            .from('match_scores')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .gte('score', notifyThreshold)
            .gte('calculated_at', oneWeekAgoIso);

        // 3. Applications sent per week
        const { count: applicationsSent } = await supabase
            .from('applications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('status', 'applied')
            .gte('applied_at', oneWeekAgoIso);

        // 4. Interview conversion rate
        const { count: totalApplications } = await supabase
            .from('applications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .in('status', ['applied', 'interviewing', 'rejected', 'offer']);

        const { count: interviews } = await supabase
            .from('applications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .in('status', ['interviewing', 'offer']);

        let conversionRate = 0;
        if (totalApplications && totalApplications > 0 && interviews) {
            conversionRate = (interviews / totalApplications) * 100;
        }

        return NextResponse.json({
            jobsFound: jobsFound || 0,
            highMatches: highMatches || 0,
            applicationsSent: applicationsSent || 0,
            conversionRate: conversionRate.toFixed(1)
        });
    } catch (error: any) {
        console.error('Fetch Velocity Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
