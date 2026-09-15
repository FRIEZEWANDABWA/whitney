import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { action, jobIds } = body as { action: string, jobIds: string[] };

        if (!action || !jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
            return NextResponse.json({ error: 'Missing parameters or empty job list' }, { status: 400 });
        }

        // Resolve user
        const { data: profiles } = await supabase
            .from('user_profiles')
            .select('id')
            .limit(1);

        const user = profiles?.[0];
        if (!user) {
            return NextResponse.json({ error: 'No user found' }, { status: 401 });
        }

        if (action === 'delete') {
            // Because of ON DELETE CASCADE, this will also wipe matching notifications, applications, and match_scores
            const { error } = await supabase.from('jobs').delete().in('id', jobIds);
            if (error) throw error;
            return NextResponse.json({ success: true, action: 'delete', count: jobIds.length });
        } else {
            // For 'applied', 'rejected', 'unarchive' (which is just another status in the DB, or we can handle it specially)
            // Wait, unarchive might mean restoring to the feed. In the frontend it sets status: 'unarchive'.
            const payloads = jobIds.map(jobId => {
                const payload: any = {
                    user_id: user.id,
                    job_id: jobId,
                    status: action
                };
                if (action === 'applied') {
                    payload.applied_at = new Date().toISOString();
                }
                return payload;
            });

            const { data, error } = await supabase
                .from('applications')
                .upsert(payloads, { onConflict: 'user_id,job_id' })
                .select();

            if (error) throw error;
            return NextResponse.json({ success: true, action, count: jobIds.length });
        }
    } catch (e: any) {
        console.error('Batch Action Error:', e);
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 });
    }
}
