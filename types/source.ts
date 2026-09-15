export interface UserProfile {
    id: string; // uuid
    full_name: string | null;
    email: string;
    cv_text: string | null;
    cv_embedding: number[] | null;
    telegram_chat_id: string | null;
    created_at: string;
    updated_at: string;
}

export interface SourceHealth {
    consecutive_failures: number;
    consecutive_zero_runs?: number;
    success_rate: number;       // 0–100%
    avg_response_ms: number;
    last_success_at: string | null;
    last_checked_at: string | null;
    jobs_found_last_run: number;
    last_error: string | null;
    last_status_code: number | null;
    status: 'healthy' | 'degraded' | 'paused';
}


export interface JobSource {
    id: string; // uuid
    name: string;
    base_url: string;
    
    // Legacy field - keep for now, but use source_kind/strategy instead
    type: 'rss' | 'api' | 'html' | 'google'; 
    
    // New Architectural Fields
    source_kind: 'aggregator' | 'ats' | 'api' | 'rss' | 'company' | 'embassy' | 'ngo';
    strategy: 'html' | 'proxy_html' | 'browser' | 'api' | 'rss' | 'ats_bamboohr' | 'ats_greenhouse' | 'ats_lever' | 'ats_zoho' | 'ats_workable' | 'ats_csod' | 'ats_mci' | 'playwright';
    
    category: string;
    parsing_config: any | null; // JSON config (add selector_version here later)
    active: boolean;
    last_run_at: string | null;
    created_at: string;

    // Observability & Tuning
    source_health: SourceHealth | null;
    priority: 'core' | 'high' | 'medium' | 'low';
    execution_tier?: 'realtime' | 'frequent' | 'standard' | 'slow';
    expected_job_volume?: 'high' | 'medium' | 'low' | 'very_low';
    risk_level: 'low' | 'moderate' | 'high';
    crawl_frequency_minutes: number | null;
    crawl_timeout_seconds: number | null;
    last_jobs_hash: string | null;
    robots_policy: 'strict' | 'ignore' | 'api_only';
}
