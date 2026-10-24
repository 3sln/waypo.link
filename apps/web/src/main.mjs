import {captureOnboardingEntry} from './providers/onboarding-entry.mjs';
captureOnboardingEntry(location,history);
const adminQuery = new URLSearchParams(location.search);
// Host administration has its own lazily loaded composition root; the ordinary
// console never imports it.
if (adminQuery.get('member_certify') === '1') {
  await import('./certify-member.mjs');
} else if (location.pathname === '/console' && (adminQuery.has('boot') || adminQuery.has('admin'))) {
  await import('./admin-entry.mjs');
} else if (new URLSearchParams(location.search).get('demo') === '1' && ['localhost','127.0.0.1','[::1]'].includes(location.hostname)) {
  await import('./demo-main.mjs');
} else {
  // Context-sensitive release screens do not need the ordinary console preload.
  if (location.pathname !== '/token-onboarding' && !location.pathname.startsWith('/recovery/') && !/^\/orgs\/[^/]+\/invitation\/?$/.test(location.pathname)) {
    const preload = document.createElement('link');
    preload.rel = 'modulepreload';
    preload.href = import.meta.resolve('./release.mjs');
    document.head.append(preload);
  }
  await import('./release.mjs');
}
