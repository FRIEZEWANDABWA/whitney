import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET all settings
export async function GET() {
    try {
        const { data, error } = await supabase.from('system_settings').select('*').order('key');
        if (error) throw error;
        return NextResponse.json(data);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// POST / Update setting
export async function POST(request: Request) {
    try {
        const { key, value } = await request.json();
        const { data, error } = await supabase
            .from('system_settings')
            .update({ value, updated_at: new Date().toISOString() })
            .eq('key', key)
            .select();
        if (error) throw error;
        return NextResponse.json(data[0]);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
