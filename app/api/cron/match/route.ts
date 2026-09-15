import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { generateEmbedding } from '@/lib/openai';
import { sendEmailNotification, sendTelegramNotification } from '@/lib/notifier';
import { computeMatchScore, isScoringEngineV2 } from '@/lib/compute-match-score';

// Basic vector dot product assuming normalized embeddings for cosine similarity
function cosineSimilarity(vecA: number[] | string, vecB: number[] | string) {
    const a = typeof vecA === 'string' ? JSON.parse(vecA) : vecA;
    const b = typeof vecB === 'string' ? JSON.parse(vecB) : vecB;
    return a.reduce((sum: number, val: number, i: number) => sum + val * b[i], 0);
}

export async function POST(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    try {
        // 1. Fetch system thresholds
        const { data: settings } = await supabase.from('system_settings').select('key, value');
        const notifyThreshold = parseFloat(
            String(settings?.find((s) => s.key === 'notify_threshold')?.value ?? '0.75').replace(/^"|"$/g, '')
        );

        // 2. Fetch jobs where `embedding IS NULL`
        // Rate Limiting (Lightweight): Process max 50 at a time to avoid OpenAI burst overages
        const BATCH_SIZE = 50;
        const { data: jobsToEmbed } = await supabase
            .from('jobs')
            .select('id, title, company, url, description, embedding')
            .is('embedding', null)
            .limit(BATCH_SIZE);

        if (!jobsToEmbed || jobsToEmbed.length === 0) {
            return NextResponse.json({ message: 'No new jobs to embed' });
        }

        console.log(`Processing embeddings and matches for ${jobsToEmbed.length} jobs`);

        // 3. Find (or note the absence of) a user profile to attach scores to.
        // IMPORTANT: unlike the original design, a CV is NOT required to run matching —
        // scoring works purely on title/experience/org/scope signals when there's no CV
        // (see lib/scoring-v2.ts). We still need *a* user_profiles row to attach
        // match_scores/notifications to (foreign key), created via POST /api/admin/cv
        // with just an email (cvText optional).
        const userProfileRes = await supabase
            .from('user_profiles')
            .select('id, cv_embedding, email, telegram_chat_id')
            .limit(1)
            .maybeSingle();

        const user = userProfileRes.data;
        if (!user) {
            return NextResponse.json({
                message:
                    'No user profile found. Create one first: POST /api/admin/cv with { "email": "you@example.com" } (cvText is optional — omit it to run matching without a CV).',
            });
        }
        const hasCv = !!user.cv_embedding;

        let processed = 0;
        let highMatches = 0;

        // Process in chunks of 5 for efficiency and to stay under Vercel execution limits
        const CHUNK_SIZE = 5;
        for (let i = 0; i < jobsToEmbed.length; i += CHUNK_SIZE) {
            const chunk = jobsToEmbed.slice(i, i + CHUNK_SIZE);

            await Promise.all(chunk.map(async (job) => {
                try {
                    // Generate Embedding (still useful to store now, in case a CV is uploaded later)
                    const embedding = await generateEmbedding(job.description);
                    await supabase.from('jobs').update({ embedding }).eq('id', job.id);

                    // Calculate Score — semantic component only if a CV is on file
                    const baseScore = hasCv ? cosineSimilarity(user.cv_embedding, embedding) : null;
                    const jobTitle = job.title || job.description.split('\n')[0] || '';
                    const matchResult = computeMatchScore({
                        title: jobTitle,
                        description: job.description || '',
                        company: job.company,
                        baseSemantic: baseScore,
                        settings: settings ?? undefined,
                    });
                    const score = matchResult.score;

                    const { error: upsertError } = await supabase.from('match_scores').upsert(
                        { user_id: user.id, job_id: job.id, score },
                        { onConflict: 'user_id,job_id' }
                    );
                    if (upsertError) throw upsertError;

                    if (matchResult.score_components) {
                        const { error: compErr } = await supabase
                            .from('match_scores')
                            .update({ score_components: matchResult.score_components })
                            .eq('user_id', user.id)
                            .eq('job_id', job.id);
                        if (compErr) {
                            console.warn(
                                `score_components not saved (run supabase migration?): ${compErr.message}`
                            );
                        }
                    }

                    processed++;

                    // Handle High Match if necessary
                    if (score >= notifyThreshold) {
                        highMatches++;
                        const engine = isScoringEngineV2() ? 'v2' : 'v1';
                        const semanticLabel = baseScore !== null ? `${(baseScore * 100).toFixed(1)}%` : 'n/a (no CV)';
                        console.log(
                            `🔥 HIGH MATCH (${(score * 100).toFixed(1)}%) [engine ${engine}] base_semantic ${semanticLabel}: ${job.title || jobTitle} at ${job.company}`
                        );

                        const { data: existingNotif } = await supabase
                            .from('notifications')
                            .select('id')
                            .eq('user_id', user.id)
                            .eq('job_id', job.id)
                            .limit(1);

                        if (!existingNotif || existingNotif.length === 0) {
                            // We re-fetch full job details for notification
                            // Note: job object already contains title, company, url from initial select
                            const fullJob = { ...job, embedding }; // Add the newly generated embedding
                            if (fullJob) {
                                await sendEmailNotification(fullJob, score, user.email);
                                await sendTelegramNotification(fullJob, score, user.telegram_chat_id);
                                await supabase.from('notifications').insert({
                                    user_id: user.id,
                                    job_id: job.id,
                                    type: 'both'
                                });
                            }
                        }
                    }
                } catch (e) {
                    console.error(`Failed individual match process for job ${job.id}:`, e);
                }
            }));

            // Check for potential timeout (Vercel typically 10s)
            // If we've been running for more than 8s, we stop and let the next cron pick it up
            // This is handled by processed count returning.
        }

        return NextResponse.json({
            success: true,
            processed,
            newHighMatches: highMatches,
            scoring_engine: isScoringEngineV2() || !hasCv ? 'v2' : 'v1',
            cv_uploaded: hasCv,
        });
    } catch (error: unknown) {
        console.error('Matching Error:', error);
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
