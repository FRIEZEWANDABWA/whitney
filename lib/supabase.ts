import { createClient } from '@supabase/supabase-js';

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const supabaseUrl = rawUrl && rawUrl.length > 0 ? rawUrl : 'https://placeholder.supabase.co';
const supabaseKey = rawKey && rawKey.length > 0 ? rawKey : 'placeholder-key';

// Initialize the Supabase client.
// Note: We use the server role key for backend operations to bypass RLS,
// and the anon key for frontend operations.
export const supabase = createClient(supabaseUrl, supabaseKey);
