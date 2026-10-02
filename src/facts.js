/* Helpers for reading register records. Data lives in registry.js. */
export const isStated = (r) => !!r && r.state === 'stated' && r.value !== null && r.value !== undefined && r.value !== '';

/** Strict EVM address check: 0x + 40 hex, any case. Deliberately NOT a blanket 0x rejection. */
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const isAddress = (s) => typeof s === 'string' && ADDRESS_RE.test(s);

/** Derive a display handle from a stored profile URL. Returns null when it cannot be derived. */
export function handleOf(url) {
  try {
    const u = new URL(url);
    const first = u.pathname.split('/').filter(Boolean)[0];
    return first ? '@' + first : u.hostname;
  } catch {
    return null;
  }
}

/** A URL is only linkable when its record is stated and the URL is https. */
export function linkOf(record) {
  if (!isStated(record)) return null;
  try {
    const u = new URL(record.value);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
