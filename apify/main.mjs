import { Actor } from 'apify';
import { runActor } from './run.mjs';
await Actor.main(() => runActor(Actor));
