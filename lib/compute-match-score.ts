/**
 * Match scoring entry point.
 *
 * Env:
 * - SCORING_ENGINE=v2 — multi-signal scorer (`lib/scoring-v2.ts`). This project defaults to v2 in
 *   `.env.local`/`.env.example` because v2 is what makes CV-less scoring work; v1 (embedding + legacy
 *   title boost) is kept only as a fallback and REQUIRES a CV to produce a meaningful score.
 * - SCORING_SHADOW=true — log JSON lines comparing v1 vs v2 (safe with v1 or v2 primary).
 *
 * Supabase: run `supabase/migrations/20260412120000_scoring_v2_score_components.sql` before relying on
 * persisted `score_components` when using v2.
 */
import { calculateTitleBoost } from "@/lib/title-boost";
import {
    classifyTier,
    parseTierThresholdsFromSettings,
    scoreJobV2,
    type ScoringJobInput,
    type ScoreTier,
} from "@/lib/scoring-v2";

export type SettingsRow = { key: string; value: unknown };

export function isScoringEngineV2(): boolean {
    // v2 is the default for this project (see .env.local) — only explicit "v1" opts back out.
    return (process.env.SCORING_ENGINE || "v2").toLowerCase() !== "v1";
}

export function isScoringShadowEnabled(): boolean {
    return (process.env.SCORING_SHADOW || "").toLowerCase() === "true";
}

export type ComputeMatchScoreResult = {
    score: number;
    /** Stored when v2 is active and DB supports `score_components` */
    score_components: Record<string, unknown> | null;
    tier: ScoreTier;
    legacyV1Score: number;
    engine: "v1" | "v2";
};

function jobInputFromParts(title: string, description: string, company?: string): ScoringJobInput {
    return {
        title: title || description.split("\n")[0] || "",
        description: description || "",
        company,
    };
}

/**
 * Single entry point for match cron + rescore: v1 (embedding + legacy title boost) or v2 (multi-signal).
 *
 * @param baseSemantic Cosine similarity to the user's CV embedding, or `null`/`undefined` when no CV
 *   has been uploaded yet. v2 handles `null` gracefully (drops the semantic component and renormalises
 *   the rest); v1 cannot, so when there's no CV the effective engine is always v2 regardless of the
 *   SCORING_ENGINE setting.
 */
export function computeMatchScore(params: {
    title: string;
    description: string;
    company?: string;
    baseSemantic: number | null | undefined;
    settings?: SettingsRow[] | null;
}): ComputeMatchScoreResult {
    const thresholds = parseTierThresholdsFromSettings(params.settings ?? null);
    const job = jobInputFromParts(params.title, params.description, params.company);
    const hasSemantic = params.baseSemantic !== null && params.baseSemantic !== undefined;

    const legacyV1Score = hasSemantic
        ? Math.min((params.baseSemantic as number) + calculateTitleBoost(job.title, job.description), 1.0)
        : Math.min(calculateTitleBoost(job.title, job.description), 1.0);

    const v2Result = scoreJobV2(job, hasSemantic ? (params.baseSemantic as number) : null, thresholds);

    if (isScoringShadowEnabled()) {
        console.log(
            JSON.stringify({
                scoring_shadow: true,
                engine: isScoringEngineV2() ? "v2" : "v1",
                title: job.title.slice(0, 120),
                base_semantic: hasSemantic ? Number((params.baseSemantic as number).toFixed(4)) : null,
                v1_score: Number(legacyV1Score.toFixed(4)),
                v2_score: Number(v2Result.finalScore.toFixed(4)),
                v2_tier: v2Result.tier,
            })
        );
    }

    // No CV yet → v1 (embedding-based) has nothing to work with, so always use v2 in that case,
    // regardless of the SCORING_ENGINE setting.
    if (isScoringEngineV2() || !hasSemantic) {
        return {
            score: v2Result.finalScore,
            score_components: {
                ...v2Result.components,
                tier: v2Result.tier,
                engine: "v2",
            },
            tier: v2Result.tier,
            legacyV1Score: legacyV1Score,
            engine: "v2",
        };
    }

    return {
        score: legacyV1Score,
        score_components: null,
        tier: classifyTier(legacyV1Score, thresholds),
        legacyV1Score,
        engine: "v1",
    };
}
