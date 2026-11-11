/** Accept only a same-origin absolute path; reject encoded path separators and controls. */
export function safeInternalRedirect(value: string | null | undefined, fallback = '/profile'): string {
  if (!value || value.length > 2048 || /[\\\u0000-\u001f\u007f]/.test(value) || value.startsWith('//') || !value.startsWith('/')) return fallback;
  let decoded = value;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { decoded = decodeURIComponent(decoded); } catch { return fallback; }
    if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith('//') || decoded.startsWith('/\\')) return fallback;
    if (!decoded.includes('%')) break;
    if (attempt === 9) return fallback;
  }
  try {
    const parsed = new URL(value, 'https://wankas.invalid');
    if (parsed.origin !== 'https://wankas.invalid') return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return fallback; }
}
