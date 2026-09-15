/**
 * Production-safe multi-signal scorer (v2) — Entry-Level / Internship edition.
 * Title-first signal without hard rejection; thresholds align with system_settings.
 *
 * This scorer favours: internships, graduate/management trainee programmes,
 * attachments/apprenticeships, "entry level" / "junior" roles, virtual
 * assistant roles, and any role requiring roughly 0-2 years of experience —
 * across ALL industries, not just IT. It actively de-prioritises (but does
 * not hard-block) senior/leadership titles and roles demanding several years
 * of experience.
 *
 * Works WITHOUT a CV: `baseSemantic` may be `null` (no CV uploaded yet), in
 * which case the score is built entirely from title/experience/org/scope
 * signals (renormalised to 100%), so the system can surface a broad feed of
 * every entry-level-looking posting. Once a CV is uploaded, semantic
 * similarity is folded back in automatically — no code change needed.
 */

export type ScoringJobInput = {
    title: string;
    description: string;
    company?: string;
};

export type ScoreComponents = {
    semantic: number | null;
    title: number;
    org: number;
    experience: number;
    scope: number;
};

export type ScoreTier = "high" | "strong" | "watch" | "other";

export type TierThresholds = {
    /** High / notify band */
    notify: number;
    /** Strong band lower bound */
    dashboard: number;
    /** Watch band lower bound */
    watch: number;
};

export type ScoreResult = {
    finalScore: number;
    tier: ScoreTier;
    components: ScoreComponents;
};

const WEIGHT_SEMANTIC = 0.45;
const WEIGHT_TITLE = 0.3;
const WEIGHT_ORG = 0.05;
const WEIGHT_EXPERIENCE = 0.15;
const WEIGHT_SCOPE = 0.05;

// Weights used when there's no CV yet (semantic dropped, rest renormalised to 1.0)
const NO_CV_WEIGHT_SUM = WEIGHT_TITLE + WEIGHT_ORG + WEIGHT_EXPERIENCE + WEIGHT_SCOPE; // 0.55
const NO_CV_WEIGHT_TITLE = WEIGHT_TITLE / NO_CV_WEIGHT_SUM;
const NO_CV_WEIGHT_ORG = WEIGHT_ORG / NO_CV_WEIGHT_SUM;
const NO_CV_WEIGHT_EXPERIENCE = WEIGHT_EXPERIENCE / NO_CV_WEIGHT_SUM;
const NO_CV_WEIGHT_SCOPE = WEIGHT_SCOPE / NO_CV_WEIGHT_SUM;

/** Default watch floor when `watch_threshold` is not in DB — kept low so a
 *  broad "everything entry-level-looking" feed isn't filtered too hard
 *  before you've had a chance to review it and tighten things up. */
export const DEFAULT_WATCH_THRESHOLD = 0.4;
export const DEFAULT_DASHBOARD_THRESHOLD = 0.55;
export const DEFAULT_NOTIFY_THRESHOLD = 0.75;

// ------------------------------------------------------------------
// TITLE SIGNAL
// ------------------------------------------------------------------

/** TIER 1 – Unmistakably entry-level / explicitly requested categories (highest confidence) */
const TIER_1_TITLES = [
    "intern", "internship", "industrial attachment", "attachment",
    "apprentice", "apprenticeship",
    "graduate trainee", "management trainee", "trainee", "trainee program",
    "graduate program", "graduate programme", "graduate analyst",
    "graduate associate", "fresh graduate", "recent graduate",
    "entry level", "entry-level", "campus hire", "school leaver",
    "junior", "youth program", "youth programme", "fellowship", "fellow",
    // Virtual assistant / remote support roles — explicitly requested category
    "virtual assistant", "remote assistant", "online assistant",
    "general virtual assistant", "administrative virtual assistant",
    "executive virtual assistant", "virtual admin assistant",
    "virtual executive assistant", "remote administrative assistant",
];

/** TIER 2 – Roles that are typically entry-level unless paired with a seniority word */
const TIER_2_TITLES = [
    "assistant", "associate", "officer", "clerk", "trainee accountant",
    "coordinator", "representative", "data entry", "receptionist",
    "field officer", "research assistant", "teaching assistant",
    "sales rep", "customer service rep", "customer service representative",
    "support agent", "call center agent", "call centre agent",
    "junior developer", "junior accountant", "junior engineer",
    "graduate engineer", "trainee engineer", "trainee teacher",
];

/** Words that signal a SENIOR / experienced role — these push a title's score down
 *  (but don't zero it out — we'd rather surface a borderline posting for you to
 *  reject manually than silently drop it). */
const SENIOR_DISQUALIFIERS = [
    "senior", "sr.", "sr ", "lead ", "principal", "chief", "head of", "head,",
    "director", "vp ", "vice president", "president", "executive",
    "manager", "supervisor", "specialist ii", "specialist iii",
    "10+ years", "consultant (senior", "expert", "architect",
];

function hasSeniorDisqualifier(t: string): boolean {
    return SENIOR_DISQUALIFIERS.some((k) => t.includes(k));
}

export function getTitleScore(title: string): number {
    const t = (title || "").toLowerCase().trim();
    if (!t) return 0.5;

    const isTier1 = TIER_1_TITLES.some((k) => t.includes(k));
    const isTier2 = !isTier1 && TIER_2_TITLES.some((k) => t.includes(k));
    const disqualified = hasSeniorDisqualifier(t);

    if (isTier1) {
        // An explicit entry-level/VA word is the most specific signal — trust it
        // even if a seniority word co-occurs (e.g. "Virtual Executive Assistant").
        return 0.95;
    }

    if (disqualified) {
        // Clearly leans senior/leadership/expert — de-prioritise, but keep it
        // visible in a low band rather than zeroing it out entirely.
        return 0.2;
    }

    if (isTier2) {
        return 0.75;
    }

    // Unknown/neutral title — don't reward or punish strongly.
    return 0.45;
}

// ------------------------------------------------------------------
// ORG SIGNAL
// ------------------------------------------------------------------

/** Employers well known for running structured graduate/internship programmes in Kenya/Africa */
const GRAD_PROGRAM_ORGS = [
    "unicef", "undp", "unops", "unhcr", "wfp", "who", "world bank", "afdb",
    "african development bank", "mastercard foundation", "gates foundation",
    "rockefeller foundation", "kcb", "equity bank", "ncba", "safaricom",
    "cooperative bank", "absa", "stanbic", "diamond trust", "standard chartered",
    "kpmg", "deloitte", "pwc", "ey", "ernst & young", "unilever", "coca-cola",
    "coca cola", "nestle", "ibm", "microsoft", "google", "safal group",
];

export function getOrgScore(company: string): number {
    const c = (company || "").toLowerCase();
    if (!c) return 0.55;
    if (GRAD_PROGRAM_ORGS.some((org) => c.includes(org))) return 0.9;
    return 0.55;
}

// ------------------------------------------------------------------
// EXPERIENCE SIGNAL — inverted vs. the executive scorer: LESS experience required = HIGHER score.
// Widened so the 1-2 year (and even 2-3 year) range still scores well, since
// that's an explicit target range, not just 0-year internships.
// ------------------------------------------------------------------

export function getExperienceScore(desc: string): number {
    const d = (desc || "").toLowerCase();

    if (
        /\bno experience (is )?(required|necessary)\b/.test(d) ||
        /\bno prior experience\b/.test(d) ||
        /\bfresh graduates?\b/.test(d) ||
        /\brecent graduates?\b/.test(d) ||
        /\b0\s*[-–to]+\s*1\s*years?\b/.test(d)
    ) {
        return 1.0;
    }

    if (
        /\b1\s*[-–to]+\s*2\s*years?\b/.test(d) ||
        /\bat least 1 year\b/.test(d) ||
        /\b1\+?\s*years?\b/.test(d)
    ) {
        return 0.9;
    }

    if (
        /\b2\s*[-–to]+\s*3\s*years?\b/.test(d) ||
        /\bat least 2 years\b/.test(d) ||
        /\b2\+?\s*years?\b/.test(d)
    ) {
        // Explicit target range — still a strong match, not a drop-off.
        return 0.8;
    }

    if (/\b3\+?\s*years?\b/.test(d) || /\b4\+?\s*years?\b/.test(d)) {
        return 0.55;
    }

    if (/\b5\+?\s*years?\b/.test(d) || /\b6\+?\s*years?\b/.test(d)) {
        return 0.3;
    }

    if (/\b(7|8|9|10|12|15)\+?\s*years?\b/.test(d)) {
        return 0.1;
    }

    // No experience requirement mentioned at all — neutral-friendly default,
    // since many internship/entry/VA posts simply omit this line.
    return 0.65;
}

// ------------------------------------------------------------------
// SCOPE / LEVEL SIGNAL — internship & training hallmarks, softly penalise senior scope language
// ------------------------------------------------------------------

const LEVEL_HINTS: { re: RegExp; add: number }[] = [
    { re: /\btraining (will be )?provided\b|\bon[- ]the[- ]job training\b/i, add: 0.12 },
    { re: /\bmentorship\b|\bstructured (graduate|training) program(me)?\b/i, add: 0.12 },
    { re: /\bstipend\b|\ballowance\b|\binternship (allowance|stipend)\b/i, add: 0.12 },
    { re: /\bfresh(ly)? graduated\b|\brecent(ly)? graduated\b|\bcampus\b/i, add: 0.1 },
    { re: /\bno experience necessary\b|\bwilling to learn\b|\beager to learn\b/i, add: 0.1 },
    { re: /\bremote\b|\bwork from home\b|\bwfh\b/i, add: 0.05 },
];

const SENIOR_SCOPE_PENALTIES: { re: RegExp; sub: number }[] = [
    { re: /\bbudget ownership\b|\bp&l responsibility\b/i, sub: 0.1 },
    { re: /\bdirect reports?\b|\bline management\b|\bmanage a team of\b/i, sub: 0.1 },
    { re: /\b(10|15|20)\+?\s*years?\b/i, sub: 0.08 },
];

export function getScopeScore(desc: string): number {
    const d = desc || "";
    let score = 0.5;
    for (const { re, add } of LEVEL_HINTS) {
        if (re.test(d)) score += add;
    }
    for (const { re, sub } of SENIOR_SCOPE_PENALTIES) {
        if (re.test(d)) score -= sub;
    }
    return Math.min(Math.max(score, 0), 1.0);
}

// ------------------------------------------------------------------
// COMBINING
// ------------------------------------------------------------------

export function applySafeFloor(score: number, title: number, semantic: number | null): number {
    // With no CV, `semantic` is null — treat that as "no signal against it" rather
    // than "fails the floor check", so confident entry-level/VA titles still float up.
    if (title > 0.9 && (semantic === null || semantic > 0.4)) {
        return Math.max(score, 0.75);
    }
    return score;
}

export function applyPromotion(job: ScoringJobInput, score: number): number {
    const t = (job.title || "").toLowerCase();
    const c = (job.company || "").toLowerCase();
    const gradProgramOrg = GRAD_PROGRAM_ORGS.some((org) => c.includes(org));
    if (gradProgramOrg && (t.includes("graduate") || t.includes("intern") || t.includes("trainee")) && score > 0.7) {
        return Math.min(score + 0.03, 1.0);
    }
    return score;
}

export function normalizeTierThresholds(raw: TierThresholds): TierThresholds {
    const notify = clamp01(raw.notify);
    let dashboard = clamp01(raw.dashboard);
    let watch = clamp01(raw.watch);

    if (dashboard > notify - 0.02) dashboard = Math.max(0, notify - 0.02);
    if (watch > dashboard - 0.02) watch = Math.max(0, dashboard - 0.02);
    if (watch < 0) watch = 0;

    return { notify, dashboard, watch };
}

function clamp01(n: number): number {
    if (Number.isNaN(n) || n < 0) return 0;
    if (n > 1) return 1;
    return n;
}

export function classifyTier(score: number, t: TierThresholds): ScoreTier {
    const th = normalizeTierThresholds(t);
    if (score >= th.notify) return "high";
    if (score >= th.dashboard) return "strong";
    if (score >= th.watch) return "watch";
    return "other";
}

export function parseTierThresholdsFromSettings(
    settings: { key: string; value: unknown }[] | null | undefined
): TierThresholds {
    const num = (key: string, def: number) => {
        const raw = settings?.find((s) => s.key === key)?.value;
        if (raw === undefined || raw === null) return def;
        if (typeof raw === "number") return raw;
        const s = String(raw).replace(/^"|"$/g, "");
        const v = parseFloat(s);
        return Number.isNaN(v) ? def : v;
    };

    return normalizeTierThresholds({
        notify: num("notify_threshold", DEFAULT_NOTIFY_THRESHOLD),
        dashboard: num("dashboard_threshold", DEFAULT_DASHBOARD_THRESHOLD),
        watch: num("watch_threshold", DEFAULT_WATCH_THRESHOLD),
    });
}

/**
 * @param baseSemantic Cosine similarity to the user's CV embedding, or `null`
 *   when no CV has been uploaded yet. When `null`, the semantic component is
 *   dropped and the remaining signals (title/org/experience/scope) are
 *   renormalised to 100%, so scoring still works as a broad entry-level feed.
 */
export function scoreJobV2(
    job: ScoringJobInput,
    baseSemantic: number | null,
    thresholds: TierThresholds
): ScoreResult {
    const title = getTitleScore(job.title);
    const org = getOrgScore(job.company || "");
    const experience = getExperienceScore(job.description);
    const scope = getScopeScore(job.description);

    const hasSemantic = baseSemantic !== null && baseSemantic !== undefined;
    const sem = hasSemantic ? clamp01(baseSemantic as number) : null;

    let score: number;
    if (hasSemantic && sem !== null) {
        score =
            sem * WEIGHT_SEMANTIC +
            title * WEIGHT_TITLE +
            org * WEIGHT_ORG +
            experience * WEIGHT_EXPERIENCE +
            scope * WEIGHT_SCOPE;
    } else {
        score =
            title * NO_CV_WEIGHT_TITLE +
            org * NO_CV_WEIGHT_ORG +
            experience * NO_CV_WEIGHT_EXPERIENCE +
            scope * NO_CV_WEIGHT_SCOPE;
    }

    score = applySafeFloor(score, title, sem);
    score = applyPromotion(job, score);

    const finalScore = Math.min(Math.max(score, 0), 1.0);
    const tier = classifyTier(finalScore, thresholds);

    return {
        finalScore,
        tier,
        components: {
            semantic: sem,
            title,
            org,
            experience,
            scope,
        },
    };
}
