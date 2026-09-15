import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
    const newSources = [
        {
            name: 'Eagle HR Consultants',
            base_url: 'https://www.eaglehr.co.ke/careers',
            type: 'html',
            category: 'Recruitment',
            active: true,
            parsing_config: { priority_level: 1, site_url: 'https://www.eaglehr.co.ke' }
        }
    ];

    const { data, error } = await supabase.from('job_sources').insert(newSources).select();

    if (error) {
        return NextResponse.json({ success: false, error });
    }

    return NextResponse.json({ success: true, inserted: data });
}
