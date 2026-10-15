/**
 * NGINX Configuration Parser
 *
 * Provides helpers for extracting directives from `nginx -T` (full config dump)
 * output. The parser is intentionally simple — it does not fully tokenize the
 * NGINX grammar (which would require handling nested blocks, quoted strings,
 * variables, etc.). Instead it offers a small set of regex-based helpers that
 * are sufficient for evaluating the auto-checkable CIS NGINX Benchmark
 * recommendations.
 */

/** Strip C-style and shell-style comments and normalize whitespace. */
export function normalizeConfig(raw: string): string {
  // Remove "# ..." line comments (nginx doesn't have block comments).
  // Preserve quoted strings that may contain '#'.
  const lines = raw.split('\n').map((line) => {
    // Find first unquoted '#'
    let inStr: string | null = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inStr) {
        if (ch === inStr && line[i - 1] !== '\\') inStr = null;
      } else {
        if (ch === '"' || ch === "'") inStr = ch;
        else if (ch === '#') return line.slice(0, i);
      }
    }
    return line;
  });
  return lines.join('\n');
}

/**
 * Find all values of a top-level (or block-level) directive.
 *
 * Example:
 *   findDirective(config, 'user')   // -> ['nginx']
 *   findDirective(config, 'listen') // -> ['80', '443 ssl', '443 quic']
 *
 * The "value" is the text between the directive name and the terminating ';',
 * trimmed of leading/trailing whitespace. Multi-token values (e.g. `listen 443 ssl;`)
 * are preserved as a single string ('443 ssl').
 */
export function findDirective(config: string, name: string): string[] {
  const results: string[] = [];
  // Match: optional leading whitespace, the directive name as a word,
  // whitespace, then capture everything up to the first ';' (the value).
  // We use [\s\S] (non-greedy) to handle values that span lines.
  const pattern = new RegExp(`(^|\\n)\\s*${escapeRegex(name)}\\s+([\\s\\S]*?);`, 'g');
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(config)) !== null) {
    // Collapse internal whitespace/newlines in the captured value.
    const value = m[2].replace(/\s+/g, ' ').trim();
    results.push(value);
  }
  return results;
}

/** True if the directive appears at least once with any value. */
export function hasDirective(config: string, name: string): boolean {
  return findDirective(config, name).length > 0;
}

/** True if the directive appears at least once with exactly the given value. */
export function directiveEquals(config: string, name: string, value: string): boolean {
  return findDirective(config, name).some((v) => v === value);
}

/** True if the directive appears at least once with a value containing `substring`. */
export function directiveContains(config: string, name: string, substring: string): boolean {
  const sub = substring.toLowerCase();
  return findDirective(config, name).some((v) => v.toLowerCase().includes(sub));
}

/** Find all block bodies for a named block (e.g. 'server', 'location', 'upstream').
 *  Returns the inner text of each matching block. Does NOT support nested same-name blocks
 *  — if you need location-inside-location, scope the input first.
 */
export function findBlocks(config: string, blockName: string, blockArg?: RegExp): string[] {
  const results: string[] = [];
  // Match:  blockName  [optional arg]  {  ...body...  }
  const argPattern = blockArg ? `\\s*(${blockArg.source})\\s*` : '(?:\\s+([^\\{]*?))?';
  const pattern = new RegExp(
    `(?:^|\\n)\\s*${escapeRegex(blockName)}${argPattern}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`,
    'g',
  );
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(config)) !== null) {
    results.push(m[2] ?? '');
  }
  return results;
}

/** Extract `add_header` key/value pairs across the whole config.
 *  Returns an array of { name, value } objects.
 */
export function findAddHeaders(config: string): { name: string; value: string }[] {
  const results: { name: string; value: string }[] = [];
  // add_header X-Frame-Options "DENY" always;
  // add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  const pattern = /(?:^|\n)\s*add_header\s+([A-Za-z0-9_-]+)\s+("([^"]*)"|'([^']*)'|([^\s;]+))\s*([^;]*);/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(config)) !== null) {
    const name = m[1];
    const value = m[3] ?? m[4] ?? m[5] ?? '';
    results.push({ name, value });
  }
  return results;
}

/** Extract the value of `proxy_set_header` directives for the given header name. */
export function findProxySetHeaders(config: string, headerName: string): string[] {
  const results: string[] = [];
  const pattern = new RegExp(
    `(?:^|\\n)\\s*proxy_set_header\\s+${escapeRegex(headerName)}\\s+([^;]+);`,
    'g',
  );
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(config)) !== null) {
    results.push(m[1].trim());
  }
  return results;
}

/** Parse a duration-with-unit value (e.g. '10s', '1m', '600ms') and return seconds (float). */
export function parseDuration(value: string): number | null {
  if (!value) return null;
  const m = value.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const unit = (m[2] ?? 's').toLowerCase();
  switch (unit) {
    case 'ms': return num / 1000;
    case 's':  return num;
    case 'm':  return num * 60;
    case 'h':  return num * 3600;
    case 'd':  return num * 86400;
    default:   return num;
  }
}

/** Parse a size-with-unit value (e.g. '1m', '512k', '2g') and return bytes. */
export function parseSize(value: string): number | null {
  if (!value) return null;
  const m = value.match(/^(\d+(?:\.\d+)?)\s*(k|m|g)?b?$/i);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const unit = (m[2] ?? '').toLowerCase();
  switch (unit) {
    case '':  return num;
    case 'k': return num * 1024;
    case 'm': return num * 1024 * 1024;
    case 'g': return num * 1024 * 1024 * 1024;
    default:  return num;
  }
}

/** Extract the NGINX version string from `nginx -V` output (or any version text). */
export function parseNginxVersion(nginxV: string): string | null {
  // nginx version: nginx/1.28.0
  const m = nginxV.match(/nginx version:\s*nginx\/(\d+\.\d+\.\d+)/i);
  return m ? m[1] : null;
}

/** Compare two dotted version strings. Returns -1, 0, or 1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
