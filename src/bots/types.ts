import type { Action } from '../engine/types.js';
import type { PlayerView } from '../engine/redact.js';
import type { Rng } from '../rng/rng.js';

export type Bot = (view: PlayerView, rng: Rng) => Action;
