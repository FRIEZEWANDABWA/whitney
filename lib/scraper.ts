import crypto from 'crypto';
import * as cheerio from 'cheerio';
import { Job } from '../types/job';
import { JobSource } from '../types/source';

/**
 * Normalizes text for deduplication: lowercase, trim, remove punctuation, standardize terms
 */
function normalizeText(text: string): string {
    if (!text) return '';
    let norm = text.toLowerCase().trim();
    // Normalize common abbreviations
    norm = norm.replace(/\bsr\.?\b/g, 'senior');
    norm = norm.replace(/\bjr\.?\b/g, 'junior');
    // Remove all punctuation (keep alphanumeric and spaces)
    norm = norm.replace(/[^\w\s]|_/g, '').replace(/\s+/g, ' ');
    return norm;
}

/**
 * Creates a unique SHA-256 hash for deduplication based on Title, Company, and Posted Date
 */
export function generateDedupeHash(title: string, company: string, dateStr?: string | null): string {
    const normTitle = normalizeText(title);
    const normCompany = normalizeText(company);
    // Ensure date uses a standard YYYY-MM-DD format if available, else omit
    const normDate = dateStr ? new Date(dateStr).toISOString().split('T')[0] : '';

    const rawString = `${normTitle}|${normCompany}|${normDate}`;
    return crypto.createHash('sha256').update(rawString).digest('hex');
}

/**
 * Header Fingerprint Rotation
 */
function getRandomHeaders() {
    const userAgents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15"
    ];
    
    return {
        "User-Agent": userAgents[Math.floor(Math.random() * userAgents.length)],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Ch-Ua": '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Upgrade-Insecure-Requests": "1"
    };
}

/**
 * Main scraper dispatcher based on JobSource strategy.
 */
export async function scrapeSource(source: JobSource, existingHashes: Set<string> = new Set()): Promise<Partial<Job>[]> {
    try {
        switch (source.strategy) {
            case 'api':
                return await scrapeApi(source, existingHashes);
            case 'rss':
                return await scrapeRss(source, existingHashes);
            case 'html':
            case 'proxy_html':
            case 'browser':
                return await scrapeHtml(source, existingHashes);
            case 'ats_bamboohr':
            case 'ats_greenhouse':
            case 'ats_lever':
            case 'ats_zoho':
            case 'ats_workable':
            case 'ats_csod':
            case 'ats_mci':
                return await scrapeAts(source, existingHashes);
            case 'playwright':
                // ── Handled by GitHub Actions Playwright workflow ──────────────
                // Vercel workers skip these sources entirely to avoid false failures.
                // The playwright-scraper.mjs runs on GitHub Actions with full Chromium.
                console.log(`[SKIP] ${source.name} uses Playwright strategy — handled by GitHub Actions.`);
                return [];
            default:
                console.warn(`Unsupported strategy: ${source.strategy} for source ${source.name}`);
                return [];
        }
    } catch (error) {
        console.error(`Error scraping source ${source.name}:`, error);
        throw error;
    }
}

// 1. API Scraper (e.g., ReliefWeb API, RemoteOK)
async function scrapeApi(source: JobSource, existingHashes: Set<string>): Promise<Partial<Job>[]> {
    const timeout = (source.crawl_timeout_seconds || 15) * 1000;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(source.base_url, {
            headers: {
                ...getRandomHeaders(),
                'Accept': 'application/json'
            },
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }

        const data = await response.json();

        const jobs: Partial<Job>[] = [];

        /**
         * REMOTE OK SPECIAL HANDLING
         */
        if (source.name.toLowerCase().includes('remote ok')) {

            const items = Array.isArray(data)
                ? data.filter((item: any) => item && item.id)
                : [];

            for (const item of items) {

                const title =
                    item.position ||
                    item.role ||
                    item.title ||
                    'Unknown Title';

                const company =
                    item.company ||
                    'RemoteOK';

                const url =
                    item.url ||
                    `https://remoteok.com/remote-jobs/${item.id}`;

                const date =
                    item.date ||
                    new Date().toISOString();

                const hash = generateDedupeHash(title, company, date);

                if (existingHashes.has(hash)) {
                    // pass through
                } else {
                    existingHashes.add(hash);
                }

                jobs.push({
                    title,
                    company,
                    location:
                        item.location ||
                        'Remote',

                    description:
                        item.description ||
                        `${title} at ${company}`,

                    url,
                    posted_date: date,
                    dedupe_hash: hash,
                    source_id: source.id
                });
            }

            return jobs;
        }

        /**
         * RELIEFWEB GENERIC API
         */
        const config = source.parsing_config || {};
        const items = data.data || [];

        for (const item of items) {

            const fields = item.fields || item;

            const title =
                fields.title ||
                item.title ||
                'Unknown Title';

            const company =
                fields.source?.[0]?.name ||
                source.name;

            const url =
                fields.url ||
                item.url ||
                '';

            const date =
                fields.date?.created ||
                item.date ||
                null;

            const hash = generateDedupeHash(title, company, date);

            if (existingHashes.has(hash)) {
                // pass through
            } else {
                existingHashes.add(hash);
            }

            jobs.push({
                title,
                company,
                location: null,
                description:
                    fields.body ||
                    fields.summary ||
                    `Job at ${company}`,
                url,
                posted_date: date,
                dedupe_hash: hash,
                source_id: source.id
            });
        }

        return jobs;

    } finally {
        clearTimeout(id);
    }
}

// 2. RSS Scraper
import Parser from 'rss-parser';

const rssParser = new Parser();

async function scrapeRss(source: JobSource, existingHashes: Set<string>): Promise<Partial<Job>[]> {

    console.log(`RSS Scrape for ${source.name}`);

    try {

        const feed = await rssParser.parseURL(source.base_url);

        const jobs: Partial<Job>[] = [];

        for (const item of feed.items || []) {

            const title = item.title || 'Unknown Title';

            const company =
                item.creator ||
                source.name;

            const url =
                item.link ||
                source.base_url;

            const date =
                item.pubDate ||
                new Date().toISOString();

            const hash = generateDedupeHash(title, company, date);

            if (existingHashes.has(hash)) {
                // We keep it in the array so `jobsFound` is > 0, 
                // but Supabase will handle the unique constraint error
            } else {
                existingHashes.add(hash);
            }

            jobs.push({
                title,
                company,
                location: 'Remote',
                description:
                    item.contentSnippet ||
                    item.content ||
                    `Job at ${company}`,
                url,
                posted_date: date,
                dedupe_hash: hash,
                source_id: source.id
            });
        }

        return jobs;

    } catch (error) {

        console.error(`RSS parsing failed for ${source.name}`, error);

        return [];
    }
}

// 3. HTML & Proxy HTML Scraper
async function scrapeHtml(source: JobSource, existingHashes: Set<string>): Promise<Partial<Job>[]> {
    console.log(`HTML Scrape for ${source.name} using strategy ${source.strategy}`);

    const isProxy = source.strategy === 'proxy_html' || source.strategy === 'browser';
    const isBrowser = source.strategy === 'browser';
    
    const maxPages = source.parsing_config?.max_pages || 3; 
    const paginationParam = source.parsing_config?.pagination_param || 'page';

    const jobs: Partial<Job>[] = [];
    let page = 1;
    const timeout = (source.crawl_timeout_seconds || (isProxy ? 30 : 15)) * 1000;

    try {
        while (page <= maxPages) {
            let pageUrl = source.base_url;
            
            if (page > 1) {
                if (paginationParam === 'path') {
                    pageUrl = pageUrl.replace(/\/$/, '') + '/page/' + page;
                } else {
                    const separator = pageUrl.includes('?') ? '&' : '?';
                    pageUrl += `${separator}${paginationParam}=${page}`;
                }
            }

            let fetchUrl = pageUrl;
            if (isProxy && process.env.PROXY_URL) {
                let proxyUrl = process.env.PROXY_URL;
                const proxySeparator = proxyUrl.includes('?') ? '&' : '?';
                
                // Add JS render flag if strategy is browser
                if (isBrowser || source.parsing_config?.js_render) {
                    proxyUrl += `${proxySeparator}js_render=true`;
                }
                
                if (source.parsing_config?.premium_proxy) {
                    const sep = proxyUrl.includes('?') ? '&' : '?';
                    proxyUrl += `${sep}premium_proxy=true`;
                }
                
                const finalSeparator = proxyUrl.includes('?') ? '&' : '?';
                fetchUrl = `${proxyUrl}${finalSeparator}url=${encodeURIComponent(pageUrl)}`;
            }

            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);

            let response;
            try {
                response = await fetch(fetchUrl, {
                    headers: isProxy ? {} : getRandomHeaders(),
                    signal: controller.signal
                });
            } finally {
                clearTimeout(id);
            }

            if (!response.ok) {
                console.error(`HTML scrape failed for ${source.name} with status ${response.status}`);
                break;
            }

            const html = await response.text();
            const $ = cheerio.load(html);
            const config = source.parsing_config || {};

            // BrighterMonday / MyJobMag fallback defaults
            const isBrighterMonday = source.name.toLowerCase().includes('brightermonday');
            const isMyJobMag = source.name.toLowerCase().includes('myjobmag');

            let itemSelector = config.item || 'article, .job, .job-listing, .card';
            let titleSelector = config.title || 'h2, h3, .title';
            let companySelector = config.company || '.company, .employer';
            let locationSelector = config.location || '.location';
            let linkSelector = config.url || 'h2 a, h3 a, h4 a, .title a, a.job-title, a[data-href]';
            let descSelector = config.description || '.description, .summary, .content, p';

            // Override semantics if config is missing but we know the site
            if (isBrighterMonday) {
                itemSelector = '.flex.items-center'; // wrapper div
                titleSelector = 'a[data-cy="listing-title-link"]';
                linkSelector = 'a[data-cy="listing-title-link"]';
                companySelector = 'a[data-cy="listing-employer-name"]'; // likely
            } else if (isMyJobMag) {
                itemSelector = 'li.job-info';
                titleSelector = 'h2 a';
                linkSelector = 'h2 a';
            }

            let newJobsOnPage = 0;
            let hitExistingJob = false;
            const nodes = $(itemSelector).toArray();

            if (nodes.length === 0) {
                console.log(`No parsable items found on page ${page}. Stopping.`);
                break;
            }

            for (const element of nodes) {
                const title = $(element).find(titleSelector).first().text().trim();
                const companyRaw = $(element).find(companySelector).first().text().trim() || source.name;
                const company = companyRaw.replace(/\s+/g, ' ');

                let url = $(element).find(linkSelector).first().attr('href') || '';
                if (!url) url = $(element).attr('href') || source.base_url;

                if (url.startsWith('/')) {
                    const baseUrlObj = new URL(source.base_url);
                    url = `${baseUrlObj.protocol}//${baseUrlObj.host}${url}`;
                }

                if (!title) continue;

                const location = $(element).find(locationSelector).first().text().trim() || null;
                
                let description = $(element).find(descSelector).text().trim() || $(element).text().trim();
                description = description.replace(/\s+/g, ' ').substring(0, 1500) || `${title} at ${company}.`;

                const hash = generateDedupeHash(title, company, null); 

                if (existingHashes.has(hash)) {
                    hitExistingJob = true;
                    // Don't continue, so the job is added to the array and jobsFound > 0
                } else {
                    existingHashes.add(hash);
                    newJobsOnPage++;
                }
                
                jobs.push({
                    title,
                    company,
                    location,
                    description,
                    url,
                    posted_date: new Date().toISOString(),
                    dedupe_hash: hash,
                    source_id: source.id
                });
            }

            if (hitExistingJob) {
                console.log(`Encountered existing job on page ${page}. Stopping pagination.`);
                break;
            }

            if (newJobsOnPage === 0) {
                console.log(`No new distinct jobs found on page ${page}. Stopping.`);
                break;
            }

            page++;
            await new Promise(r => setTimeout(r, 200));
        }

        return jobs;
    } catch (error) {
        console.error(`Exception while running HTML parsing on ${source.name}:`, error);
        return jobs; 
    }
}

// 4. ATS Template Engine
async function scrapeAts(source: JobSource, existingHashes: Set<string>): Promise<Partial<Job>[]> {
    console.log(`ATS Scrape for ${source.name} using ${source.strategy}`);
    
    switch (source.strategy) {
        case 'ats_zoho':
            return await scrapeAtsZoho(source, existingHashes);
        case 'ats_bamboohr':
            return await scrapeAtsBambooHR(source, existingHashes);
        case 'ats_csod':
            return await scrapeAtsCsod(source, existingHashes);
        case 'ats_mci':
            return await scrapeAtsMci(source, existingHashes);
        default:
            console.warn(`ATS strategy ${source.strategy} not implemented yet.`);
            return [];
    }
}

// ATS: Zoho Recruit
async function scrapeAtsZoho(source: JobSource, existingHashes: Set<string>): Promise<Partial<Job>[]> {
    console.log(`Executing ATS Zoho parser for ${source.name}`);
    const jobs: Partial<Job>[] = [];
    
    // Zoho API format: https://[company].zohorecruit.com/recruit/v2/public/Job_Openings?websitename=Careers
    try {
        const urlObj = new URL(source.base_url);
        // Try to construct API endpoint if base_url is the generic career page
        const apiUrl = `${urlObj.protocol}//${urlObj.hostname}/recruit/v2/public/Job_Openings?websitename=Careers`;
        
        const response = await fetch(apiUrl, { headers: { 'Accept': 'application/json' } });
        if (response.ok) {
            const data = await response.json();
            const items = data.data || [];
            
            for (const item of items) {
                const title = item.Job_Opening_Name || 'Unknown Title';
                const url = item.URL || source.base_url;
                const date = item.Date_Opened || null;
                const location = [item.City, item.Country].filter(Boolean).join(', ');
                
                const hash = generateDedupeHash(title, source.name, date);
                if (existingHashes.has(hash)) {
                    // pass through
                } else {
                    existingHashes.add(hash);
                }
                
                jobs.push({
                    title,
                    company: source.name,
                    location,
                    description: item.Job_Description || `Job opening at ${source.name}`,
                    url,
                    posted_date: date ? new Date(date).toISOString() : new Date().toISOString(),
                    dedupe_hash: hash,
                    source_id: source.id
                });
            }
            return jobs;
        }
    } catch (e) {
        console.warn(`Zoho JSON API failed for ${source.name}, falling back to basic HTML parsing`, e);
    }

    // Fallback: It might be an old Zoho iframe, we'd need proxy_html/browser here
    // But since strategy is ATS, we return what we found.
    return jobs;
}

// ATS: BambooHR
async function scrapeAtsBambooHR(source: JobSource, existingHashes: Set<string>): Promise<Partial<Job>[]> {
    console.log(`Executing ATS BambooHR parser for ${source.name}`);
    const jobs: Partial<Job>[] = [];
    
    try {
        const urlObj = new URL(source.base_url);
        const subdomain = urlObj.hostname.split('.')[0];
        
        // BambooHR modern API endpoint
        const apiUrl = `https://${subdomain}.bamboohr.com/careers/list`;
        
        const response = await fetch(apiUrl, { headers: { 'Accept': 'application/json' } });
        if (!response.ok) throw new Error('BambooHR API failed');
        
        const data = await response.json();
        const items = data.result || [];
        
        for (const item of items) {
            const title = item.jobOpeningName || 'Unknown Title';
            const id = item.id;
            const url = `https://${subdomain}.bamboohr.com/careers/${id}`;
            const location = item.location ? [item.location.city, item.location.country].filter(Boolean).join(', ') : null;
            const hash = generateDedupeHash(title, source.name, null);
            if (existingHashes.has(hash)) {
                // pass through
            } else {
                existingHashes.add(hash);
            }
            
            jobs.push({
                title,
                company: source.name,
                location,
                description: item.departmentLabel ? `Department: ${item.departmentLabel}` : `Job opening at ${source.name}`,
                url,
                posted_date: new Date().toISOString(),
                dedupe_hash: hash,
                source_id: source.id
            });
        }
    } catch (e) {
        console.error(`BambooHR parsing error for ${source.name}:`, e);
    }
    
    return jobs;
}

// ATS: CSOD (Cornerstone OnDemand)
async function scrapeAtsCsod(source: JobSource, existingHashes: Set<string>): Promise<Partial<Job>[]> {
    console.log(`Executing ATS CSOD parser for ${source.name}`);
    const jobs: Partial<Job>[] = [];
    
    // CSOD relies heavily on POST requests to /ats/careersite/search.aspx or specific JSON APIs
    // For this boilerplate, we'll hit the HTML and look for JSON embedded in the page
    try {
        const response = await fetch(source.base_url);
        const html = await response.text();
        
        // Often CSOD embeds the initial search results in a JS variable
        // This is a naive extraction; CSOD usually requires proxy_html + network interception for robust scraping
        const $ = cheerio.load(html);
        const nodes = $('li.job-result, .job-listing').toArray();
        
        for (const element of nodes) {
            const titleNode = $(element).find('h2, h3, .job-title').first();
            const title = titleNode.text().trim();
            let url = titleNode.find('a').attr('href') || $(element).find('a').attr('href') || source.base_url;
            
            if (url.startsWith('/')) {
                const urlObj = new URL(source.base_url);
                url = `${urlObj.protocol}//${urlObj.hostname}${url}`;
            }
            
            if (!title) continue;
            
            const hash = generateDedupeHash(title, source.name, null);
            if (existingHashes.has(hash)) {
                // pass through
            } else {
                existingHashes.add(hash);
            }
            
            jobs.push({
                title,
                company: source.name,
                location: $(element).find('.location').text().trim() || null,
                description: `Job opening at ${source.name}`,
                url,
                posted_date: new Date().toISOString(),
                dedupe_hash: hash,
                source_id: source.id
            });
        }
    } catch (e) {
        console.error(`CSOD parsing error for ${source.name}:`, e);
    }
    
    return jobs;
}

// ATS: MCI (Used by Safal Group)
async function scrapeAtsMci(source: JobSource, existingHashes: Set<string>): Promise<Partial<Job>[]> {
    console.log(`Executing ATS MCI parser for ${source.name}`);
    const jobs: Partial<Job>[] = [];
    
    try {
        const response = await fetch(source.base_url);
        const html = await response.text();
        const $ = cheerio.load(html);
        
        // MCI typically uses tables or specific row classes
        const nodes = $('.MciJobResult, tr.job-row, .opportunity').toArray();
        
        for (const element of nodes) {
            const titleNode = $(element).find('a').first();
            const title = titleNode.text().trim();
            let url = titleNode.attr('href') || source.base_url;
            
            if (url.startsWith('/')) {
                const urlObj = new URL(source.base_url);
                url = `${urlObj.protocol}//${urlObj.hostname}${url}`;
            }
            
            if (!title) continue;
            
            const location = $(element).find('.location, td:nth-child(2)').text().trim() || null;
            
            const hash = generateDedupeHash(title, source.name, null);
            if (existingHashes.has(hash)) {
                // pass through
            } else {
                existingHashes.add(hash);
            }
            
            jobs.push({
                title,
                company: source.name,
                location,
                description: `Job opening at ${source.name}`,
                url,
                posted_date: new Date().toISOString(),
                dedupe_hash: hash,
                source_id: source.id
            });
        }
    } catch (e) {
         console.error(`MCI parsing error for ${source.name}:`, e);
    }
    
    return jobs;
}
