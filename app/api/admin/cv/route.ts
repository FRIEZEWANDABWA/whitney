import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { generateEmbedding } from '@/lib/openai';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { cvText, email } = body;

        if (!email) {
            return NextResponse.json({ error: 'Missing email' }, { status: 400 });
        }

        // 1. Try to find the user in auth, or create them
        let { data: usersData } = await supabase.auth.admin.listUsers();
        let targetUser = usersData.users?.find(u => u.email === email);

        if (!targetUser) {
            const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
                email: email,
                email_confirm: true,
                password: crypto.randomUUID() + 'A1!'
            });
            if (createError) throw createError;
            targetUser = newUser.user;

            // Allow the Postgres trigger time to create the user_profile record
            await new Promise(r => setTimeout(r, 2000));
        }

        // 2. cvText is OPTIONAL — you can bootstrap a profile with just an email so the
        //    match engine can run in "broad entry-level feed" mode (title/experience/org/scope
        //    only, no CV comparison). Upload a CV later via this same route to switch the
        //    engine over to personalised semantic matching automatically.
        const hasCvText = typeof cvText === 'string' && cvText.trim().length > 0;

        if (hasCvText) {
            const embedding = await generateEmbedding(cvText);

            const { error } = await supabase
                .from('user_profiles')
                .update({
                    cv_text: cvText,
                    cv_embedding: embedding,
                    updated_at: new Date().toISOString()
                })
                .eq('id', targetUser.id);

            if (error) {
                console.error("Supabase Error:", error);
                return NextResponse.json({ error: error.message }, { status: 500 });
            }

            return NextResponse.json({
                success: true,
                message: 'CV uploaded, embedded, and user armed successfully — matching will now use your CV.',
                userId: targetUser.id,
                cvUploaded: true,
            });
        }

        // No CV text provided — profile exists (or was just created) but with no cv_embedding.
        // The match cron will run in CV-less mode for this profile until a CV is uploaded.
        return NextResponse.json({
            success: true,
            message: 'Profile ready with no CV uploaded — matching will run on title/experience/org/scope signals only (broad entry-level feed). POST again with cvText to switch to personalised matching.',
            userId: targetUser.id,
            cvUploaded: false,
        });
    } catch (error: any) {
        console.error('CV Upload Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
