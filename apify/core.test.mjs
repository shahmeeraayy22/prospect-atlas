import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateInput, normalizeEntry, runEngine } from './core.mjs';

const input = () => validateInput({ searchTerms: [' plumbers ', 'plumbers'], location: ' Austin ' });
test('validates limits and normalizes queries without allowing query injection', () => {
    assert.deepEqual(input().searchTerms, ['plumbers']);
    assert.equal(input().location, 'Austin');
    for (const override of [{ maxResults: 0 }, { concurrency: 5 }, { maxRunSeconds: -1 }, { collectEmails: 'true' }, { searchTerms: ['plumber\nextra'] }, { location: 'Austin\nother' }]) {
        assert.throws(() => validateInput({ searchTerms: ['plumbers'], location: 'Austin', ...override }));
    }
});
test('preserves branch identity, missing ratings, and email opt-in', () => {
    const raw = { title: 'Business', place_id: 'branch1', web_site: 'https://chain.example', longtitude: -97, emails: ['a@example.com', 'a@example.com'] };
    const first = normalizeEntry(raw, input());
    const second = normalizeEntry({ ...raw, place_id: 'branch2' }, input());
    assert.notEqual(first.businessId, second.businessId);
    assert.equal(first.rating, null);
    assert.equal(first.longitude, -97);
    assert.deepEqual(first.emails, []);
    assert.deepEqual(normalizeEntry(raw, { ...input(), collectEmails: true }).emails, ['a@example.com']);
    assert.equal(normalizeEntry({ title: 'No identity' }, input()), null);
});

async function fixture(source, callback) {
    const dir = await mkdtemp(join(tmpdir(), 'atlas-test-'));
    try {
        const path = join(dir, 'engine.cjs');
        await writeFile(path, source);
        await callback(path);
    } finally { await rm(dir, { recursive: true, force: true }); }
}
test('streams JSONL, ignores banner, and stops at output limit', async () => {
    await fixture(`console.log('banner'); let n=0; setInterval(()=>console.log(JSON.stringify({title:'Business',place_id:String(++n)})),20);`, async path => {
        let count = 0;
        const reason = await runEngine({ command: process.execPath, prefixArgs: [path], input: input(), queryPath: 'unused', onEntry: async () => ++count >= 2 });
        assert.equal(count, 2);
        assert.equal(reason, 'result_or_charge_limit');
    });
});
test('reports engine failure and missing binary', async () => {
    await fixture('process.exit(3)', async path => {
        await assert.rejects(runEngine({ command: process.execPath, prefixArgs: [path], input: input(), queryPath: 'unused', onEntry: async () => false }), /code 3/);
    });
    await assert.rejects(runEngine({ command: 'nonexistent-atlas-binary', input: input(), queryPath: 'unused', onEntry: async () => false }), /ENOENT/);
});
test('preserves timeout reason and propagates dataset write errors', async () => {
    await fixture('setInterval(()=>console.log(JSON.stringify({title:"Business",place_id:"one"})),20)', async path => {
        assert.equal(await runEngine({ command: process.execPath, prefixArgs: [path], input: { ...input(), maxRunSeconds: 0.2 }, queryPath: 'unused', onEntry: async () => false }), 'time_limit');
        await assert.rejects(runEngine({ command: process.execPath, prefixArgs: [path], input: input(), queryPath: 'unused', onEntry: async () => { throw new Error('Dataset unavailable'); } }), /Dataset unavailable/);
    });
});
