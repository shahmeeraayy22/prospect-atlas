import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeEntry, runEngine, validateInput } from './core.mjs';

export async function runActor(Actor, engine = runEngine) {
    const input = validateInput(await Actor.getInput());
    const directory = await mkdtemp(join(tmpdir(), 'prospect-atlas-'));
    const seen = new Set();
    let count = 0;
    let duplicates = 0;
    let stopEngine;
    let reason = 'failed';
    let completedSuccessfully = false;
    const startedAt = new Date().toISOString();
    const stop = () => stopEngine?.('interrupted');
    Actor.on('aborting', stop);
    Actor.on('migrating', stop);
    process.once('SIGTERM', stop);
    try {
        const queryPath = join(directory, 'queries.txt');
        await writeFile(queryPath, input.searchTerms.map(term => `${term} in ${input.location}`).join('\n'));
        let proxyPath;
        if (input.proxyConfiguration) {
            const proxy = await Actor.createProxyConfiguration(input.proxyConfiguration);
            if (proxy) {
                const urls = await Promise.all(Array.from({ length: input.concurrency }, (_, i) => proxy.newUrl(`atlas${i}`)));
                proxyPath = join(directory, 'proxies.txt');
                await writeFile(proxyPath, urls.join('\n'), { mode: 0o600 });
            }
        }
        await Actor.setStatusMessage('Collecting local business leads.');
        reason = await engine({ command: process.env.SCRAPER_BINARY || '/usr/bin/google-maps-scraper', input, queryPath, proxyPath,
            onStart: callback => { stopEngine = callback; },
            onEntry: async raw => {
                const row = normalizeEntry(raw, input);
                if (!row) return false;
                if (seen.has(row.businessId)) { duplicates++; return false; }
                if (Actor.getChargingManager().calculateMaxEventChargeCountWithinLimit('business-result') < 1) return true;
                const result = await Actor.pushData(row, 'business-result');
                // On unmonetized/local runs the SDK delivers normally without billing.
                if (result?.chargedCount === 0 && result?.eventChargeLimitReached) return true;
                seen.add(row.businessId);
                count++;
                return count >= input.maxResults || Boolean(result?.eventChargeLimitReached);
            }
        });
        if (!count && reason !== 'result_or_charge_limit') throw new Error('No usable businesses returned. Check the search terms/location and proxy configuration.');
        await Actor.setStatusMessage(`Saved ${count} unique businesses. Stop reason: ${reason}.`);
        completedSuccessfully = true;
    } finally {
        try {
            await Actor.setValue('RUN-SUMMARY', { startedAt, finishedAt: new Date().toISOString(), resultCount: count, duplicateCount: duplicates, stopReason: reason, successful: completedSuccessfully, requestedMaxResults: input.maxResults, partial: reason !== 'completed' });
        } finally {
            process.removeListener('SIGTERM', stop);
            await rm(directory, { recursive: true, force: true });
        }
    }
}
