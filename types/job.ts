export interface Job {
    id: string; // uuid
    title: string;
    company: string;
    location: string | null;
    description: string;
    url: string;
    dedupe_hash: string;
    source_id: string | null; // uuid references JobSource
    posted_date: string | null;
    embedding: number[] | null; // 1536 dim vector
    created_at: string;
}

export interface MatchScore {
    id: string; // uuid
    user_id: string; // uuid references UserProfile
    job_id: string; // uuid references Job
    score: number;
    calculated_at: string;
}

export interface Application {
    id: string; // uuid
    user_id: string;
    job_id: string;
    status: 'saved' | 'applied' | 'interviewing' | 'rejected' | 'offer';
    applied_at: string | null;
    notes: string | null;
    created_at: string;
}
