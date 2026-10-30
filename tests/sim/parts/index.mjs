// Scenario parts, in run order. Each module exports {name, define(run, world, {people, alpha, beta, scale, random}),
// moments} (moments are registered in the screenshot catalogue, tests/sim/shots.mjs).
import {registerMoments} from '../shots.mjs';
import * as board from './board.mjs';
import * as meet from './meet.mjs';
import * as parlay from './parlay.mjs';
import * as accounts from './accounts.mjs';
export const PARTS=Object.freeze([board,meet,parlay,accounts].filter(p=>p.name));
for(const part of PARTS)registerMoments(part.moments);
