import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export function validateInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Input must be an object.');
    const { searchTerms, location } = input;
    if (!Array.isArray(searchTerms) || !searchTerms.length || searchTerms.length > 10 || searchTerms.some(x => typeof x !== 'string' || !x.trim() || x.length > 150 || /[\r\n]/.test(x))) throw new Error('Provide 1–10 search terms, each at most 150 characters without newlines.');
    if (typeof location !== 'string' || !location.trim() || location.length > 200 || /[\r\n]/.test(location)) throw new Error('Provide a location of at most 200 characters without newlines.');
    const result = { searchTerms: [...new Set(searchTerms.map(x => x.trim()))], location: location.trim(), maxResults: 50, maxRunSeconds: 300, concurrency: 2, depth: 3, language: 'en', collectEmails: false, ...input };
    for (const [name, min, max] of [['maxResults',1,1000],['maxRunSeconds',30,1800],['concurrency',1,4],['depth',1,20]]) {
        if (!Number.isInteger(result[name]) || result[name] < min || result[name] > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
    }
    if (typeof result.collectEmails !== 'boolean') throw new Error('collectEmails must be a boolean.');
    if (typeof result.language !== 'string' || !/^[a-z]{2}(-[A-Za-z]{2})?$/.test(result.language)) throw new Error('Invalid language code.');
    result.searchTerms = [...new Set(searchTerms.map(x => x.trim()))];
    result.location = location.trim();
    return result;
}

export function normalizeEntry(raw, input) {
    if (!raw || typeof raw.title !== 'string' || !raw.title.trim()) return null;
    const key = raw.place_id || raw.cid || raw.data_id || raw.link || (raw.address ? `${raw.title.trim().toLowerCase()}|${raw.address.trim().toLowerCase()}` : null);
    if (!key) return null;
    return { businessId: String(key), businessName: raw.title.trim(), category: raw.category || null,
        address: raw.address || null, phone: raw.phone || null, website: raw.web_site || null,
        rating: raw.review_rating > 0 ? raw.review_rating : null, reviewCount: raw.review_count ?? null,
        latitude: raw.latitude ?? null, longitude: raw.longitude ?? raw.longtitude ?? null,
        googleMapsUrl: raw.link || null, placeId: raw.place_id || null,
        emails: input.collectEmails ? [...new Set(raw.emails || [])] : [],
        emailCollectionStatus: input.collectEmails ? 'attempted' : 'not_requested',
        locationQuery: input.location, scrapedAt: new Date().toISOString() };
}

// stdout is exclusively the engine's JSONL result stream; progress goes to stderr.
export async function runEngine({ command, prefixArgs = [], input, queryPath, proxyPath, onEntry, onStart }) {
    const args = [...prefixArgs, '-input', queryPath, '-results', 'stdout', '-json', '-c', String(input.concurrency), '-depth', String(input.depth), '-lang', input.language, '-exit-on-inactivity', '30s'];
    if (input.collectEmails) args.push('-email');
    if (proxyPath) args.push('-proxies-file', proxyPath);
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DISABLE_TELEMETRY: '1' } });
    let reason = 'completed';
    let forceTimer;
    const stop = (why) => {
        if (reason !== 'completed') return;
        reason = why;
        child.kill('SIGTERM');
        forceTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
    };
    onStart?.(stop);
    const timer = setTimeout(() => stop('time_limit'), input.maxRunSeconds * 1000);
    const closed = new Promise(resolve => {
        child.once('error', error => resolve({ error }));
        child.once('close', (code, signal) => resolve({ code, signal }));
    });
    // Do not relay engine logs: third-party logs can include proxy credentials.
    child.stderr.resume();
    let processingError;
    try {
        for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
            if (reason !== 'completed') continue;
            if (!line.trim()) continue;
            let raw;
            try { raw = JSON.parse(line); } catch { continue; } // engine banner is not JSON
            if (await onEntry(raw)) stop('result_or_charge_limit');
        }
    } catch (error) {
        processingError = error;
        stop('output_error');
    }
    const status = await closed;
    clearTimeout(timer);
    clearTimeout(forceTimer);
    if (processingError) throw processingError;
    if (status.error) throw status.error;
    if (reason === 'completed' && status.code !== 0) throw new Error(`Scraper exited with code ${status.code}; inspect the run summary and retry with a proxy.`);
    return reason;
}
