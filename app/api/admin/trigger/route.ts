import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        const cronSecret = process.env.CRON_SECRET;
        const url = new URL(request.url);
        const baseUrl = `${url.protocol}//${url.host}`;

        // 1. Manually trigger Ingest with "force" to scan everything regardless of due status
        const ingestRes = await fetch(`${baseUrl}/api/cron/ingest`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${cronSecret}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ force: true })
        });
        const ingestData = await ingestRes.json().catch(() => ({ error: `Ingest returned non-JSON response (status ${ingestRes.status})` }));
        const ingestOk = ingestRes.ok && ingestData?.success !== false;
        if (!ingestOk) console.error('Trigger: ingest step failed:', ingestRes.status, ingestData);

        // 2. Delay slightly for DB propagation
        await new Promise(r => setTimeout(r, 2000));

        // 3. Trigger Worker (Process Scrape Queue)
        const workerRes = await fetch(`${baseUrl}/api/worker/scrape`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${cronSecret}` }
        });
        const workerData = await workerRes.json().catch(() => ({ error: `Worker returned non-JSON response (status ${workerRes.status})` }));
        const workerOk = workerRes.ok && workerData?.success !== false;
        if (!workerOk) console.error('Trigger: worker step failed:', workerRes.status, workerData);

        // 4. Delay before matching
        await new Promise(r => setTimeout(r, 3000));

        // 5. Manually trigger Match
        const matchRes = await fetch(`${baseUrl}/api/cron/match`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${cronSecret}` }
        });
        const matchData = await matchRes.json().catch(() => ({ error: `Match returned non-JSON response (status ${matchRes.status})` }));
        const matchOk = matchRes.ok && matchData?.success !== false;
        if (!matchOk) console.error('Trigger: match step failed:', matchRes.status, matchData);

        // Overall success requires every step to have actually succeeded — a step returning
        // 500/non-JSON no longer gets silently reported as "Done" to the admin UI.
        const success = ingestOk && workerOk && matchOk;

        return NextResponse.json({
            success,
            ingestOk, workerOk, matchOk,
            ingestData, workerData, matchData,
        });
    } catch (error: any) {
        console.error('Trigger Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
