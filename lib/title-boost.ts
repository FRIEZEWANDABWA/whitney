// ============================================================
// TITLE INTELLIGENCE BOOSTER — Entry-Level / Internship edition
// Applies score bonuses based on job title and keyword matching.
// Used by the legacy v1 scorer (embedding + boost); v2 uses
// lib/scoring-v2.ts instead, but this stays wired in as a fallback.
// ============================================================

// TIER 1 – Direct Match (Highest boost: +0.14)
const TIER_1_TITLES = [
    'intern', 'internship', 'interns wanted', 'summer intern', 'winter intern',
    'industrial attachment', 'attachment', 'apprentice', 'apprenticeship',
    'graduate trainee', 'management trainee', 'trainee program', 'trainee programme',
    'graduate program', 'graduate programme', 'graduate analyst', 'graduate associate',
    'graduate engineer', 'graduate developer', 'graduate accountant',
    'fresh graduate', 'recent graduate', 'campus hire', 'school leaver',
    'entry level', 'entry-level', 'youth program', 'youth programme',
    'fellowship', 'fellow', 'national youth service', 'nys',
    // Virtual assistant / remote support roles — explicitly requested category
    'virtual assistant', 'remote assistant', 'online assistant',
    'general virtual assistant', 'administrative virtual assistant',
    'executive virtual assistant', 'virtual admin assistant',
    'virtual executive assistant', 'remote administrative assistant',
];

// TIER 2 – Strong Alignment (Moderate boost: +0.09)
const TIER_2_TITLES = [
    'junior', 'trainee', 'trainee accountant', 'trainee teacher', 'trainee engineer',
    'assistant', 'junior developer', 'junior accountant', 'junior engineer',
    'junior analyst', 'junior officer', 'associate (entry)', 'graduate teacher',
    'teaching assistant', 'research assistant', 'lab assistant',
];

// TIER 3 – Generic roles that are usually entry-level unless senior-qualified (light boost: +0.05)
const TIER_3_TITLES = [
    'officer', 'clerk', 'coordinator', 'representative', 'data entry',
    'receptionist', 'field officer', 'sales rep', 'sales representative',
    'customer service rep', 'customer service representative', 'support agent',
    'call center agent', 'call centre agent', 'front office',
];

// Words that mean this is NOT an entry-level role — used to zero out the boost
const SENIOR_DISQUALIFIERS = [
    'senior', 'lead ', 'principal', 'chief', 'head of', 'director', 'vp ',
    'vice president', 'president', 'executive', 'manager', 'supervisor', 'expert',
];

// Keywords that boost score when found in description
const BOOST_KEYWORDS = [
    'no experience necessary', 'no experience required', 'training will be provided',
    'on-the-job training', 'mentorship', 'structured graduate program',
    'stipend', 'internship allowance', 'fresh graduates', 'recent graduates',
    'willing to learn', 'eager to learn', 'campus recruitment',
    'entry level', 'graduate program', 'growth opportunity', 'career starter',
];

/**
 * Calculate a title-based score boost for a job.
 * @param title - The job title
 * @param description - The job description
 * @returns A boost value between 0 and 0.16
 */
export function calculateTitleBoost(title: string, description: string): number {
    const lowerTitle = title.toLowerCase().trim();
    const lowerDesc = description.toLowerCase();
    let boost = 0;

    const disqualified = SENIOR_DISQUALIFIERS.some((k) => lowerTitle.includes(k))
        && !TIER_1_TITLES.some((k) => lowerTitle.includes(k)); // an explicit entry-level word always wins

    if (!disqualified) {
        // Check Tier 1 titles first (highest priority)
        for (const t of TIER_1_TITLES) {
            if (lowerTitle.includes(t)) {
                boost = 0.14;
                break;
            }
        }

        // Check Tier 2 if no Tier 1 match
        if (boost === 0) {
            for (const t of TIER_2_TITLES) {
                if (lowerTitle.includes(t)) {
                    boost = 0.09;
                    break;
                }
            }
        }

        // Check Tier 3 if no Tier 1/2 match
        if (boost === 0) {
            for (const t of TIER_3_TITLES) {
                if (lowerTitle.includes(t)) {
                    boost = 0.05;
                    break;
                }
            }
        }
    }

    // Keyword boost from description (up to +0.06)
    let keywordHits = 0;
    for (const keyword of BOOST_KEYWORDS) {
        if (lowerDesc.includes(keyword)) {
            keywordHits++;
        }
    }
    const keywordBoost = Math.min(keywordHits * 0.015, 0.06);

    // Total boost capped at 0.16 (or driven negative-adjacent to 0 for disqualified senior titles)
    return disqualified ? Math.min(keywordBoost, 0.02) : Math.min(boost + keywordBoost, 0.16);
}
