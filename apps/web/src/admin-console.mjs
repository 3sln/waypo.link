// Lazily imported by admin-entry.mjs once a boot session exists or administrator
// authority is confirmed. Ordinary accounts and anonymous visitors never load it,
// and the public service worker does not precache it.
import {constructors as baseConstructors} from './bl/admin-console.mjs';
import {flagConstructors} from './bl/admin-flags.mjs';
import {experimentConstructors} from './bl/admin-experiments.mjs';
export {EnterConsole} from './bl/admin-console.mjs';
export const constructors={...baseConstructors,...flagConstructors,...experimentConstructors};
export {consoleView} from './ui/admin-flags.mjs';
