import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
    const { error } = await supabase
        .from('system_settings')
        .update({ value: '0.80', updated_at: new Date().toISOString() })
        .eq('key', 'notify_threshold');

    if (error) {
        return NextResponse.json({ success: false, error });
    }

    return NextResponse.json({ success: true, message: 'Updated threshold to 0.80' });
}
