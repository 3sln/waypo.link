// For adapter diagnostics and local browser-runner artifacts. No decoded values are logged.
export const redactIntentLog=value=>String(value).replace(/((?:[?&#]|\b)(?:bintent|bindle_intent|bindle_meta|bindle_data|sig)=)[^\s&#"'<>]*/gi,'$1[redacted]');
