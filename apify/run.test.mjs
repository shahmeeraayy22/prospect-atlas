import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Actor } from 'apify';
import { runActor } from './run.mjs';

function fakeActor(overrides = {}) {
    const rows = [];
    const values = {};
    const events = [];
    return { rows, values, events,
        getInput: async () => ({ searchTerms: ['dentist'], location: 'Austin', maxResults: 2 }),
        on: () => {}, setStatusMessage: async () => {},
        pushData: async (row, event) => { rows.push(row); events.push(event); return { chargedCount: 1 }; },
        setValue: async (key, value) => { values[key] = value; },
        getChargingManager: () => ({ calculateMaxEventChargeCountWithinLimit: () => Infinity }),
        ...overrides };
}
test('complete lifecycle deduplicates, retains branches, exports and cleans temporary input', async () => {
    const actor = fakeActor();
    let path;
    await runActor(actor, async ({ queryPath, onEntry }) => {
        path = queryPath;
        assert.equal(await readFile(queryPath, 'utf8'), 'dentist in Austin');
        assert.equal(await onEntry({ title: 'Dentist', place_id: 'A' }), false);
        assert.equal(await onEntry({ title: 'Dentist', place_id: 'A' }), false);
        assert.equal(await onEntry({ title: 'Dentist', place_id: 'B' }), true);
        return 'result_or_charge_limit';
    });
    assert.equal(actor.rows.length, 2);
    assert.deepEqual(actor.events, ['business-result', 'business-result']);
    assert.equal(actor.values['RUN-SUMMARY'].duplicateCount, 1);
    await assert.rejects(access(path));
});
test('zero output fails explicitly and still writes a run summary', async () => {
    const actor = fakeActor();
    await assert.rejects(runActor(actor, async () => 'completed'), /No usable businesses/);
    assert.equal(actor.values['RUN-SUMMARY'].resultCount, 0);
});
test('exhausted budget stops before delivering or charging another row', async () => {
    const actor = fakeActor({ getChargingManager: () => ({ calculateMaxEventChargeCountWithinLimit: () => 0 }) });
    await runActor(actor, async ({ onEntry }) => {
        assert.equal(await onEntry({ title: 'Dentist', place_id: 'A' }), true);
        return 'result_or_charge_limit';
    });
    assert.equal(actor.rows.length, 0);
});
test('real Apify SDK writes local dataset and summary through the adapter', async () => {
    const storage = await mkdtemp(join(tmpdir(), 'atlas-sdk-test-'));
    const previousStorage = process.env.APIFY_LOCAL_STORAGE_DIR;
    process.env.APIFY_LOCAL_STORAGE_DIR = storage;
    await Actor.init();
    try {
        await Actor.setValue('INPUT', { searchTerms: ['fixture'], location: 'Test city', maxResults: 1 });
        await runActor(Actor, async ({ onEntry }) => {
            assert.equal(await onEntry({ title: 'Integration fixture only', place_id: 'fixture-one', review_rating: 4.5, review_count: 17 }), true);
            return 'result_or_charge_limit';
        });
        const dataset = await Actor.openDataset();
        const { items } = await dataset.getData();
        assert.equal(items.at(-1).businessName, 'Integration fixture only');
        assert.equal((await Actor.getValue('RUN-SUMMARY')).resultCount, 1);
    } finally {
        await Actor.exit({ exit: false });
        if (previousStorage === undefined) delete process.env.APIFY_LOCAL_STORAGE_DIR;
        else process.env.APIFY_LOCAL_STORAGE_DIR = previousStorage;
        await rm(storage, { recursive: true, force: true });
    }
});
