import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET all sources
export async function GET() {
    try {
        const { data, error } = await supabase.from('job_sources').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return NextResponse.json(data);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// POST new source
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { data, error } = await supabase.from('job_sources').insert([body]).select();
        if (error) throw error;
        return NextResponse.json(data[0]);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// PUT edit existing source
export async function PUT(request: Request) {
    try {
        const body = await request.json();
        const { id, ...updates } = body;

        if (!id) return NextResponse.json({ error: 'Missing source ID' }, { status: 400 });

        const { data, error } = await supabase.from('job_sources').update(updates).eq('id', id).select();
        if (error) throw error;
        return NextResponse.json(data[0]);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// DELETE a source
export async function DELETE(request: Request) {
    try {
        const url = new URL(request.url);
        const id = url.searchParams.get('id');

        if (!id) return NextResponse.json({ error: 'Missing source ID' }, { status: 400 });

        const { error } = await supabase.from('job_sources').delete().eq('id', id);
        if (error) throw error;
        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
