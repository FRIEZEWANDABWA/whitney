/**
 * JobHunterAI — Playwright Browser Scraper
 * ==========================================
 * Runs on GitHub Actions (free Chromium, no Vercel limits).
 * Handles all sources with strategy = 'playwright' in job_sources.
 *
 * Architecture:
 *   GitHub Actions → Playwright (Chromium) → Supabase direct insert
 *
 * Hash logic MUST match lib/scraper.ts generateDedupeHash().
 */

import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import crypto from 'crypto';

// ─── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Deduplication Hash (matches lib/scraper.ts exactly) ─────────────────────
function normalizeText(text) {
    if (!text) return '';
    let norm = text.toLowerCase().trim();
    norm = norm.replace(/\bsr\.?\b/g, 'senior');
    norm = norm.replace(/\bjr\.?\b/g, 'junior');
    norm = norm.replace(/[^\w\s]|_/g, '').replace(/\s+/g, ' ');
    return norm;
}

function generateDedupeHash(title, company, dateStr = null) {
    const normTitle = normalizeText(title);
    const normCompany = normalizeText(company);
    const normDate = dateStr ? new Date(dateStr).toISOString().split('T')[0] : '';
    const rawString = `${normTitle}|${normCompany}|${normDate}`;
    return crypto.createHash('sha256').update(rawString).digest('hex');
}

// ─── Site-Specific Wait Strategies ───────────────────────────────────────────
const SITE_CONFIGS = {
    // CareerJet — anti-bot protected HTML, works fine with real browser
    'careerjet': {
        waitFor: 'networkidle',
        timeout: 15000,
        itemSelector: 'article.job',
        titleSelector: 'h2 > a, .title a',
        linkSelector:  'h2 > a, .title a',
        companySelector: '.company',
        locationSelector: '.location',
    },
    // beBee — React/JS site
    'bebee': {
        waitFor: '[data-cy="job-list-item"], .job-list, article, .bee-job',
        timeout: 15000,
        itemSelector: '[data-cy="job-list-item"], article',
        titleSelector: 'h2, h3, .title, a[href*="/job"]',
        linkSelector:  'a[href*="/job"]',
        companySelector: '.company, [data-cy="company-name"]',
        locationSelector: '.location, [data-cy="location"]',
    },
    // KenyaJob — table/list format
    'kenyajob': {
        waitFor: 'networkidle',
        timeout: 15000,
        itemSelector: '.job_listing, .job-listing, article, tr:has(td)',
        titleSelector: 'h3 a, h2 a, .job-title a, td a',
        linkSelector:  'h3 a, h2 a, .job-title a, td a',
        companySelector: '.company, .employer',
        locationSelector: '.location',
    },
    // AjiraZone — full React SPA
    'ajirazone': {
        waitFor: '.job-card, [class*="JobCard"], [class*="job-card"], article',
        timeout: 20000,
        itemSelector: '.job-card, [class*="JobCard"], [class*="job-card"], article',
        titleSelector: 'h2, h3, .title, [class*="title"]',
        linkSelector:  'a',
        companySelector: '[class*="company"], [class*="employer"]',
        locationSelector: '[class*="location"]',
    },
    // Fuzu — React SPA
    'fuzu': {
        waitFor: '[class*="Job"], [class*="job-item"], [class*="listing"], article',
        timeout: 20000,
        itemSelector: '[class*="Job"], [class*="job-item"], article',
        titleSelector: 'h2, h3, a[href*="/jobs/"]',
        linkSelector:  'a[href*="/jobs/"]',
        companySelector: '[class*="company"], [class*="employer"]',
        locationSelector: '[class*="location"]',
    },
    // Eagle HR — simple company career page
    'eaglehr': {
        waitFor: 'networkidle',
        timeout: 15000,
        itemSelector: '.job, .vacancy, article, .career-item, li',
        titleSelector: 'h2 a, h3 a, .title a, a',
        linkSelector:  'a[href*="job"], a[href*="vacanc"], a[href*="career"]',
        companySelector: null,
        locationSelector: '.location',
    },
    // Generic fallback
    'default': {
        waitFor: 'networkidle',
        timeout: 15000,
        itemSelector: 'article, .job, .job-item, .job-card, .vacancy, [class*="job"]',
        titleSelector: 'h2 a, h3 a, .title a, a[href*="job"], a[href*="vacanc"]',
        linkSelector:  'h2 a, h3 a, a[href*="job"], a[href*="vacanc"]',
        companySelector: '.company, .employer, [class*="company"]',
        locationSelector: '.location, [class*="location"]',
    }
};

function getSiteConfig(sourceName, baseUrl, parsingConfig) {
    // Use parsing_config from DB if defined (trusted source of truth)
    if (parsingConfig && parsingConfig.itemSelector) {
        return {
            waitFor: 'networkidle',
            timeout: 15000,
            ...parsingConfig
        };
    }

    // Match by name/URL keywords
    const key = (sourceName + ' ' + baseUrl).toLowerCase();
    if (key.includes('careerjet')) return SITE_CONFIGS.careerjet;
    if (key.includes('bebee')) return SITE_CONFIGS.bebee;
    if (key.includes('kenyajob') || key.includes('kenya job')) return SITE_CONFIGS.kenyajob;
    if (key.includes('ajirazone')) return SITE_CONFIGS.ajirazone;
    if (key.includes('fuzu')) return SITE_CONFIGS.fuzu;
    if (key.includes('eagle')) return SITE_CONFIGS.eaglehr;

    return SITE_CONFIGS.default;
}

// ─── Core Playwright Scrape Function ─────────────────────────────────────────
async function scrapeWithPlaywright(page, source) {
    const config = getSiteConfig(source.name, source.base_url, source.parsing_config);
    console.log(`  → Config: ${JSON.stringify(config.itemSelector)}`);

    // Navigate
    try {
        await page.goto(source.base_url, {
            waitUntil: 'domcontentloaded',
            timeout: config.timeout
        });
    } catch (e) {
        console.log(`  ⚠ Navigation error: ${e.message}`);
        return [];
    }

    // Wait for JS to render
    try {
        if (config.waitFor === 'networkidle') {
            await page.waitForLoadState('networkidle', { timeout: config.timeout });
        } else {
            // Wait for a specific element to appear (SPA hydration)
            await page.waitForSelector(config.waitFor, { timeout: config.timeout })
                .catch(() => page.waitForTimeout(5000));
        }
    } catch (e) {
        console.log(`  ⚠ Wait timeout — proceeding with what loaded`);
        await page.waitForTimeout(3000);
    }

    // Get rendered HTML
    const html = await page.content();
    const $ = cheerio.load(html);

    const jobs = [];
    const seen = new Set();

    $(config.itemSelector).each((i, el) => {
        if (i > 100) return; // Safety cap

        const titleEl = $(el).find(config.titleSelector).first();
        const title = titleEl.text().trim().replace(/\s+/g, ' ');
        if (!title || title.length < 5) return;

        let link = titleEl.attr('href') || $(el).find('a').first().attr('href') || '';
        if (link && !link.startsWith('http')) {
            const base = new URL(source.base_url);
            link = link.startsWith('/') ? `${base.protocol}//${base.host}${link}` : `${base.href}/${link}`;
        }

        const company = config.companySelector
            ? $(el).find(config.companySelector).first().text().trim().replace(/\s+/g, ' ')
            : source.name;
        const location = config.locationSelector
            ? $(el).find(config.locationSelector).first().text().trim()
            : 'Kenya';

        const hash = generateDedupeHash(title, company || source.name);
        if (seen.has(hash)) return;
        seen.add(hash);

        jobs.push({ title, company: company || source.name, link, location, hash });
    });

    console.log(`  → Parsed ${jobs.length} jobs from rendered HTML`);
    return jobs;
}

// ─── Insert Jobs to Supabase ──────────────────────────────────────────────────
async function insertJobs(source, jobs, existingHashes) {
    let inserted = 0;
    let skipped = 0;

    for (const job of jobs) {
        if (existingHashes.has(job.hash)) {
            skipped++;
            continue;
        }

        const { error } = await supabase.from('jobs').insert({
            title: job.title,
            company: job.company,
            url: job.link,
            location: job.location || 'Kenya',
            source_id: source.id,
            dedupe_hash: job.hash,
            posted_date: new Date().toISOString(),
            description: `${job.title} at ${job.company}. Source: ${source.name}.`,
        });

        if (!error) {
            inserted++;
        } else if (!error.message.includes('duplicate') && !error.code?.includes('23505')) {
            console.log(`  ⚠ Insert error: ${error.message}`);
        } else {
            skipped++;
        }
    }

    return { inserted, skipped };
}

// ─── Update Source Health ─────────────────────────────────────────────────────
async function updateSourceHealth(source, jobsFound, success, errorMsg, latencyMs) {
    const oldHealth = source.source_health || {
        consecutive_failures: 0,
        consecutive_zero_runs: 0,
        avg_response_ms: 0,
        status: 'healthy',
    };

    const newFailures = success ? 0 : (oldHealth.consecutive_failures || 0) + 1;
    let newZeroRuns = oldHealth.consecutive_zero_runs || 0;
    if (success) {
        newZeroRuns = jobsFound === 0 ? newZeroRuns + 1 : 0;
    }

    const newLatency = oldHealth.avg_response_ms === 0
        ? latencyMs
        : Math.round((oldHealth.avg_response_ms + latencyMs) / 2);

    let status = 'healthy';
    if (newFailures >= 5) status = 'degraded';
    if (newZeroRuns >= 15) status = 'degraded';

    await supabase.from('job_sources').update({
        last_run_at: new Date().toISOString(),
        source_health: {
            ...oldHealth,
            last_checked_at: new Date().toISOString(),
            last_success_at: success ? new Date().toISOString() : oldHealth.last_success_at,
            jobs_found_last_run: jobsFound,
            avg_response_ms: newLatency,
            consecutive_failures: newFailures,
            consecutive_zero_runs: newZeroRuns,
            last_error: errorMsg || null,
            status,
        }
    }).eq('id', source.id);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('🎭 JobHunterAI Playwright Scraper — Starting');
    console.log(`   Time: ${new Date().toISOString()}`);

    // 1. Fetch all playwright-strategy sources that are due
    const now = new Date();
    const { data: sources, error } = await supabase
        .from('job_sources')
        .select('*')
        .eq('strategy', 'playwright')
        .eq('active', true);

    if (error) {
        console.error('❌ Failed to fetch sources:', error.message);
        process.exit(1);
    }

    // Filter to only sources due for a run
    const dueSources = (sources || []).filter(s => {
        if (!s.last_run_at) return true;
        const lastRun = new Date(s.last_run_at);
        const frequencyMs = (s.crawl_frequency_minutes || 120) * 60 * 1000;
        return (now - lastRun) >= frequencyMs;
    });

    console.log(`\n📋 Sources: ${sources.length} total | ${dueSources.length} due for run`);

    if (dueSources.length === 0) {
        console.log('✅ No sources due. Exiting.');
        return;
    }

    // 2. Launch Playwright browser
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const results = [];

    for (const source of dueSources) {
        console.log(`\n🌐 Scraping: ${source.name}`);
        console.log(`   URL: ${source.base_url}`);
        const startTime = Date.now();

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            locale: 'en-US',
            viewport: { width: 1280, height: 800 },
        });

        const page = await context.newPage();

        // Block unnecessary resources for speed
        await page.route('**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf,eot}', route => route.abort());
        await page.route('**/{analytics,tracking,ads}**', route => route.abort());

        let jobs = [];
        let success = false;
        let errorMsg = null;

        try {
            // Fetch existing hashes to deduplicate
            const { data: existing } = await supabase
                .from('jobs')
                .select('dedupe_hash')
                .eq('source_id', source.id)
                .limit(500);
            const existingHashes = new Set((existing || []).map(j => j.dedupe_hash));

            // Scrape
            jobs = await scrapeWithPlaywright(page, source);
            const { inserted, skipped } = await insertJobs(source, jobs, existingHashes);

            success = true;
            console.log(`  ✅ Found: ${jobs.length} | Inserted: ${inserted} | Skipped (dupe): ${skipped}`);
            results.push({ name: source.name, found: jobs.length, inserted, status: 'success' });

        } catch (err) {
            errorMsg = err.message;
            console.log(`  ❌ Error: ${errorMsg}`);
            results.push({ name: source.name, found: 0, inserted: 0, status: 'error', error: errorMsg });
        }

        const latencyMs = Date.now() - startTime;
        await updateSourceHealth(source, jobs.length, success, errorMsg, latencyMs);
        await context.close();

        // Polite delay between sites
        await new Promise(r => setTimeout(r, 2000));
    }

    await browser.close();

    // 3. Print final summary
    console.log('\n' + '═'.repeat(60));
    console.log('📊 PLAYWRIGHT SCRAPER RUN SUMMARY');
    console.log('═'.repeat(60));
    for (const r of results) {
        const icon = r.status === 'success' ? '✅' : '❌';
        console.log(`${icon} ${r.name}: ${r.found} found, ${r.inserted} inserted`);
        if (r.error) console.log(`   Error: ${r.error}`);
    }
    const totalInserted = results.reduce((s, r) => s + r.inserted, 0);
    console.log(`\n🎉 Total inserted: ${totalInserted} new jobs`);
}

main().catch(err => {
    console.error('💥 Fatal error:', err);
    process.exit(1);
});
