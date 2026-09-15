import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { openai } from '@/lib/openai';

export async function POST(request: Request) {
    // Can be called via Cron or manually via Admin Panel
    try {
        // 1. Fetch High/Strong Matches (score >= 0.70)
        const { data: scores } = await supabase
            .from('match_scores')
            .select('job_id')
            .gte('score', 0.70)
            .limit(100);

        if (!scores || scores.length === 0) {
            return NextResponse.json({ message: 'Not enough high-match jobs to analyze trends' });
        }

        const jobIds = scores.map(s => s.job_id);
        const { data: jobs } = await supabase
            .from('jobs')
            .select('description')
            .in('id', jobIds);

        if (!jobs) return NextResponse.json({ message: 'No jobs found' });

        // Combine descriptions (limit size for token constraints)
        const combinedDescriptions = jobs.map(j => j.description).join('\n\n---\n\n').substring(0, 15000);

        // 2. Ask OpenAI to extract top 20 skills
        const prompt = `
     You are an entry-level careers analyst in Kenya/Africa. Analyze the following recently posted internship, graduate trainee, and entry-level job descriptions across ALL industries (not just IT).
     Extract the top 20 most frequently required skills, tools, certifications, and qualifications that a student or recent graduate should learn to qualify for these roles.
     Return ONLY a JSON array of strings containing the exact skill names. No markdown formatting.
     
     Job Descriptions:
     ${combinedDescriptions}
     `;

        const chatResponse = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo', // Low cost model
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
        });

        let skills: string[] = [];
        try {
            const resultRaw = chatResponse.choices[0].message.content || '[]';
            // Strip markdown if present
            const cleanJson = resultRaw.replace(/```json/g, '').replace(/```/g, '').trim();
            skills = JSON.parse(cleanJson);
        } catch (e) {
            console.error('Failed to parse OpenAI skills JSON:', e);
            return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });
        }

        // 3. Update skill_trends table (upsert and increment frequency)
        for (const skill of skills) {
            // Simple increment logic via RPC or two-step fetch
            const { data: existing } = await supabase.from('skill_trends').select('*').eq('skill', skill).limit(1);

            if (existing && existing.length > 0) {
                await supabase.from('skill_trends').update({
                    frequency: existing[0].frequency + 1,
                    last_seen: new Date().toISOString()
                }).eq('id', existing[0].id);
            } else {
                await supabase.from('skill_trends').insert({ skill, frequency: 1 });
            }
        }

        return NextResponse.json({ success: true, processed_skills: skills.length, skills });

    } catch (error: any) {
        console.error('Skill Analysis Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
