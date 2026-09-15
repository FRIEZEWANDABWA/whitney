import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET top 20 skills
export async function GET() {
    try {
        const { data, error } = await supabase
            .from('skill_trends')
            .select('*')
            .order('frequency', { ascending: false })
            .limit(20);

        if (error) throw error;
        return NextResponse.json(data);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
