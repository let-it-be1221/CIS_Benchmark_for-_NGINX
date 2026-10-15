/**
 * CIS NGINX Benchmark — Check Evaluators
 *
 * Each evaluator takes an AuditContext (the `nginx -T` and `nginx -V` outputs)
 * and returns a CheckResult indicating pass/fail/manual plus a human-readable
 * explanation and supporting evidence snippet.
 *
 * Checks that cannot be auto-evaluated from config text alone (e.g. filesystem
 * permissions, account lock status, package versions) do not have an entry in
 * this map and the UI will show them as "Manual review required".
 */

import {
  normalizeConfig,
  findDirective,
  hasDirective,
  directiveEquals,
  directiveContains,
  findBlocks,
  findAddHeaders,
  findProxySetHeaders,
  parseDuration,
  parseSize,
  parseNginxVersion,
  compareVersions,
} from './nginxParser';

export type CheckStatus = 'pass' | 'fail' | 'manual';

export interface CheckResult {
  status: CheckStatus;
  message: string;
  /** Optional code/config snippet showing why this result was produced. */
  evidence?: string;
  /** Optional list of remediation hints specific to this run. */
  hints?: string[];
}

export interface AuditContext {
  /** Output of `nginx -T` (full configuration dump). */
  nginxT: string;
  /** Output of `nginx -V` (version + compile options). */
  nginxV: string;
}

export type Evaluator = (ctx: AuditContext) => CheckResult;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function failIf<T>(value: T | null | undefined, failMsg: string, passMsg: string, evidence?: string): CheckResult {
  if (value === null || value === undefined) {
    return { status: 'fail', message: failMsg, evidence };
  }
  return { status: 'pass', message: passMsg, evidence: evidence ?? String(value) };
}

/** Find the value of a single-valued directive (first match). */
function firstDirectiveValue(config: string, name: string): string | null {
  const values = findDirective(config, name);
  return values.length > 0 ? values[0] : null;
}

// -----------------------------------------------------------------------------
// Evaluators — keyed by recommendation ID
// -----------------------------------------------------------------------------

export const EVALUATORS: Record<string, Evaluator> = {

  // 1.1.1 Ensure NGINX is installed (version >= 1.28.0)
  '1.1.1': (ctx) => {
    const version = parseNginxVersion(ctx.nginxV);
    if (!version) {
      return {
        status: 'fail',
        message: 'Could not detect NGINX version. Is `nginx -V` output available?',
        evidence: ctx.nginxV.split('\n').slice(0, 3).join('\n'),
      };
    }
    const cmp = compareVersions(version, '1.28.0');
    if (cmp >= 0) {
      return {
        status: 'pass',
        message: `NGINX ${version} is installed (≥ 1.28.0 required).`,
        evidence: `nginx version: nginx/${version}`,
      };
    }
    return {
      status: 'fail',
      message: `NGINX ${version} is older than required 1.28.0. Upgrade to 1.28.0 or later.`,
      evidence: `nginx version: nginx/${version}`,
      hints: ['Install or upgrade NGINX to version 1.28.0 or later from a trusted repository.'],
    };
  },

  // 2.1.1 Ensure only required dynamic modules are loaded
  '2.1.1': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const loaded = findDirective(config, 'load_module');
    if (loaded.length === 0) {
      return {
        status: 'pass',
        message: 'No dynamic modules are loaded (no `load_module` directives).',
      };
    }
    return {
      status: 'manual',
      message: `${loaded.length} dynamic module(s) loaded. Review each for necessity.`,
      evidence: loaded.map((m) => `load_module ${m};`).join('\n'),
      hints: loaded.map((m) => `Verify whether "${m}" is required by the application.`),
    };
  },

  // 2.2.1 Ensure NGINX is run using a non-privileged, dedicated service account
  '2.2.1': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const userVal = firstDirectiveValue(config, 'user');
    if (!userVal) {
      return {
        status: 'fail',
        message: 'No `user` directive found. Worker processes run as `nobody` by default — define a dedicated service account.',
        hints: ['Add `user nginx;` (or a dedicated account name) to the `http` block.'],
      };
    }
    const user = userVal.split(/\s+/)[0];
    const privileged = ['root', 'nobody', 'www-data', 'apache', 'bin', 'daemon'];
    if (privileged.includes(user.toLowerCase())) {
      if (user.toLowerCase() === 'root') {
        return {
          status: 'fail',
          message: `Worker processes run as \`${user}\` — this is a critical security risk.`,
          evidence: `user ${userVal};`,
          hints: ['Switch to a non-privileged, dedicated account such as `nginx`.'],
        };
      }
      return {
        status: 'manual',
        message: `Worker processes run as \`${user}\`. Verify this is a dedicated service account with no shell and no login.`,
        evidence: `user ${userVal};`,
        hints: [`Create a dedicated \`nginx\` account and update the \`user\` directive.`],
      };
    }
    return {
      status: 'pass',
      message: `Worker processes run as \`${user}\` (non-privileged).`,
      evidence: `user ${userVal};`,
    };
  },

  // 2.4.1 Ensure NGINX only listens on authorized ports
  '2.4.1': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const listens = findDirective(config, 'listen');
    if (listens.length === 0) {
      return { status: 'fail', message: 'No `listen` directives found.', };
    }
    // Authorized ports: 80, 443, 8080 (commonly). We flag anything else.
    const allowed = new Set([80, 443, 8000, 8080, 8443]);
    const flagged: string[] = [];
    for (const v of listens) {
      // listen 80;     listen 443 ssl;     listen [::]:80;    listen 127.0.0.1:8080;
      const m = v.match(/^(?:\[?([0-9a-fA-F:.]+)\]?:)?(\d+)/);
      if (!m) continue;
      const port = parseInt(m[2], 10);
      if (!allowed.has(port)) flagged.push(`${v} (port ${port})`);
    }
    if (flagged.length > 0) {
      return {
        status: 'manual',
        message: `The following listen directives use non-standard ports. Confirm each is authorized:`,
        evidence: flagged.join('\n'),
        hints: flagged.map((f) => `Verify necessity of: ${f}`),
      };
    }
    return {
      status: 'pass',
      message: `All ${listens.length} listen directives use standard ports (80/443/8080/8443/8000).`,
      evidence: listens.slice(0, 8).map((l) => `listen ${l};`).join('\n'),
    };
  },

  // 2.4.2 Ensure requests for unknown host names are rejected
  '2.4.2': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    // Look for a server block with `default_server` that returns 444/404/etc.
    const servers = findBlocks(config, 'server');
    let found = false;
    let evidence = '';
    for (const s of servers) {
      const listenVals = findDirective(s, 'listen');
      const isDefault = listenVals.some((v) => v.includes('default_server'));
      if (!isDefault) continue;
      // Check for `return 444;` or `return 404;`
      const returnMatch = s.match(/return\s+(444|404|421)/);
      if (isDefault && returnMatch) {
        found = true;
        evidence = `listen ${listenVals.find((v) => v.includes('default_server'))};\n  ${returnMatch[0]};`;
        break;
      }
    }
    if (found) {
      return {
        status: 'pass',
        message: 'A default_server block is configured to reject unknown hostnames.',
        evidence,
      };
    }
    return {
      status: 'fail',
      message: 'No default_server block returning 444/404 found. Requests to unknown hostnames will fall through to the first server block.',
      hints: [
        'Add a default server block:\n```\nserver {\n  listen 80 default_server;\n  listen [::]:80 default_server;\n  server_name _;\n  return 444;\n}\n```',
      ],
    };
  },

  // 2.4.3 Ensure keepalive_timeout is 10 seconds or less, but not 0
  '2.4.3': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const v = firstDirectiveValue(config, 'keepalive_timeout');
    if (!v) {
      return {
        status: 'fail',
        message: '`keepalive_timeout` is not set (default 75s — too long).',
        hints: ['Add `keepalive_timeout 10;` to the http block.'],
      };
    }
    const seconds = parseDuration(v.split(/\s+/)[0]);
    if (seconds === null) {
      return { status: 'manual', message: `Could not parse keepalive_timeout value: \`${v}\`.`, evidence: `keepalive_timeout ${v};` };
    }
    if (seconds === 0) {
      return { status: 'fail', message: 'keepalive_timeout is 0 — disables keepalive, which harms performance.', evidence: `keepalive_timeout ${v};` };
    }
    if (seconds <= 10) {
      return { status: 'pass', message: `keepalive_timeout is ${seconds}s (≤ 10s, not 0).`, evidence: `keepalive_timeout ${v};` };
    }
    return {
      status: 'fail',
      message: `keepalive_timeout is ${seconds}s — exceeds 10s limit.`,
      evidence: `keepalive_timeout ${v};`,
      hints: ['Set `keepalive_timeout 10;` (or lower).'],
    };
  },

  // 2.4.4 Ensure send_timeout is set to 10 seconds or less, but not 0
  '2.4.4': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const v = firstDirectiveValue(config, 'send_timeout');
    if (!v) {
      return {
        status: 'fail',
        message: '`send_timeout` is not set (default 60s — too long).',
        hints: ['Add `send_timeout 10;` to the http block.'],
      };
    }
    const seconds = parseDuration(v.split(/\s+/)[0]);
    if (seconds === null) {
      return { status: 'manual', message: `Could not parse send_timeout value: \`${v}\`.`, evidence: `send_timeout ${v};` };
    }
    if (seconds === 0) {
      return { status: 'fail', message: 'send_timeout is 0 — disables the timeout.', evidence: `send_timeout ${v};` };
    }
    if (seconds <= 10) {
      return { status: 'pass', message: `send_timeout is ${seconds}s (≤ 10s, not 0).`, evidence: `send_timeout ${v};` };
    }
    return {
      status: 'fail',
      message: `send_timeout is ${seconds}s — exceeds 10s limit.`,
      evidence: `send_timeout ${v};`,
      hints: ['Set `send_timeout 10;` (or lower).'],
    };
  },

  // 2.5.1 Ensure server_tokens directive is set to `off`
  '2.5.1': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const v = firstDirectiveValue(config, 'server_tokens');
    if (!v) {
      return {
        status: 'fail',
        message: '`server_tokens` is not set (default `on` — leaks NGINX version).',
        hints: ['Add `server_tokens off;` to the http block.'],
      };
    }
    if (v === 'off') {
      return { status: 'pass', message: 'server_tokens is set to `off`.', evidence: `server_tokens ${v};` };
    }
    return {
      status: 'fail',
      message: `server_tokens is \`${v}\` — version information is exposed in responses.`,
      evidence: `server_tokens ${v};`,
      hints: ['Set `server_tokens off;`.'],
    };
  },

  // 2.5.3 Ensure hidden file serving is disabled
  '2.5.3': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    // Look for a location block matching ~ /\. (or ~ /\.) with deny all;
    const locations = findBlocks(config, 'location', /~\\s*\/\\\./);
    if (locations.length === 0) {
      // Also check simpler form
      const m = config.match(/location\s+~\s*\/\\\.\s*\{[^}]*?deny\s+all\s*;/);
      if (!m) {
        return {
          status: 'fail',
          message: 'No location block found that denies access to hidden files (location ~ /\\.).',
          hints: ['Add the following to your server block:\n```\nlocation ~ /\\. {\n  deny all;\n}\n```'],
        };
      }
    }
    // Confirm deny all is present in the matching block
    const matching = config.match(/location\s+~\s*\/\\\.[\s\S]*?\}/);
    if (matching && /deny\s+all/.test(matching[0])) {
      return { status: 'pass', message: 'Hidden file serving is disabled.', evidence: matching[0] };
    }
    return {
      status: 'fail',
      message: 'A `location ~ /\\.` block exists but does not contain `deny all;`.',
      evidence: matching ? matching[0] : undefined,
      hints: ['Ensure the hidden-file location block contains `deny all;`.'],
    };
  },

  // 2.5.4 Ensure the NGINX reverse proxy does not enable information disclosure
  '2.5.4': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    // Best practice: proxy_hide_header for X-Powered-By, Server, etc.
    const hidden = findDirective(config, 'proxy_hide_header');
    if (hidden.length === 0) {
      return {
        status: 'manual',
        message: 'No `proxy_hide_header` directives found. Confirm that upstream-applied headers (X-Powered-By, Via, Server) do not leak through.',
        hints: ['Add `proxy_hide_header X-Powered-By;` and similar for any headers the upstream exposes.'],
      };
    }
    return {
      status: 'pass',
      message: `${hidden.length} header(s) are hidden from upstream responses.`,
      evidence: hidden.map((h) => `proxy_hide_header ${h};`).join('\n'),
    };
  },

  // 3.1 Ensure detailed logging is enabled
  '3.1': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const formats = findDirective(config, 'log_format');
    if (formats.length === 0) {
      return {
        status: 'fail',
        message: 'No custom `log_format` defined. Use the default `combined` format which lacks security-relevant fields.',
        hints: ['Define a `log_format` that includes `$remote_addr`, `$time_local`, `$request`, `$status`, `$body_bytes_sent`, `$http_referer`, `$http_user_agent`, `$http_x_forwarded_for`.'],
      };
    }
    // Check that the format includes key security fields
    const formatStr = formats.join('\n');
    const required = ['remote_addr', 'request', 'status', 'http_user_agent'];
    const missing = required.filter((f) => !formatStr.includes(f));
    if (missing.length > 0) {
      return {
        status: 'manual',
        message: `A log_format is defined but is missing fields: ${missing.join(', ')}.`,
        evidence: formats.map((f) => `log_format ${f};`).join('\n'),
        hints: [`Add \`${missing.map((m) => '$' + m).join(' ')}\` to the log_format definition.`],
      };
    }
    return {
      status: 'pass',
      message: 'Detailed log_format is configured with required fields.',
      evidence: formats.map((f) => `log_format ${f};`).join('\n'),
    };
  },

  // 3.2 Ensure access logging is enabled
  '3.2': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const values = findDirective(config, 'access_log');
    if (values.length === 0) {
      return {
        status: 'fail',
        message: 'No `access_log` directive found — access logging is using defaults.',
        hints: ['Add `access_log /var/log/nginx/access.log main;` to the http block.'],
      };
    }
    // Check for `access_log off;`
    if (values.some((v) => v.trim() === 'off')) {
      return {
        status: 'fail',
        message: 'Access logging is explicitly disabled (`access_log off;`).',
        evidence: 'access_log off;',
        hints: ['Remove `access_log off;` or replace with a proper log path.'],
      };
    }
    return {
      status: 'pass',
      message: `Access logging is enabled (${values.length} directive(s)).`,
      evidence: values.slice(0, 3).map((v) => `access_log ${v};`).join('\n'),
    };
  },

  // 3.3 Ensure error logging is enabled and set to the info logging level
  '3.3': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const values = findDirective(config, 'error_log');
    if (values.length === 0) {
      return {
        status: 'fail',
        message: 'No `error_log` directive found — defaults to logs/error.log with `error` level.',
        hints: ['Add `error_log /var/log/nginx/error.log info;` to the http block.'],
      };
    }
    // Look for at least one with info level
    const hasInfo = values.some((v) => /\binfo\b/.test(v));
    if (hasInfo) {
      return {
        status: 'pass',
        message: 'error_log is set to info level.',
        evidence: values.filter((v) => /info/.test(v)).map((v) => `error_log ${v};`).join('\n'),
      };
    }
    return {
      status: 'fail',
      message: 'error_log is configured but not at the `info` level.',
      evidence: values.map((v) => `error_log ${v};`).join('\n'),
      hints: ['Change error_log level to `info` (e.g. `error_log /var/log/nginx/error.log info;`).'],
    };
  },

  // 3.4 Ensure proxies pass source IP information
  '3.4': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const realIp = findProxySetHeaders(config, 'X-Real-IP');
    const xff = findProxySetHeaders(config, 'X-Forwarded-For');
    const evidence = [
      ...realIp.map((v) => `proxy_set_header X-Real-IP ${v};`),
      ...xff.map((v) => `proxy_set_header X-Forwarded-For ${v};`),
    ].join('\n');
    if (realIp.length > 0 && xff.length > 0) {
      return {
        status: 'pass',
        message: 'Both X-Real-IP and X-Forwarded-For are forwarded to upstreams.',
        evidence,
      };
    }
    const missing: string[] = [];
    if (realIp.length === 0) missing.push('X-Real-IP');
    if (xff.length === 0) missing.push('X-Forwarded-For');
    return {
      status: 'fail',
      message: `Missing proxy_set_header directives for: ${missing.join(', ')}.`,
      evidence: evidence || undefined,
      hints: [
        'Add the following to your proxy location/server blocks:',
        '```\nproxy_set_header X-Real-IP $remote_addr;\nproxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n```',
      ],
    };
  },

  // 4.1.1 Ensure HTTP is redirected to HTTPS
  '4.1.1': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    // Look for either: separate server on :80 returning 301 https://...
    // OR `if ($scheme = http) { return 301 https://... }`
    const servers = findBlocks(config, 'server');
    let found = false;
    let evidence = '';
    for (const s of servers) {
      const listens = findDirective(s, 'listen');
      const isHttp = listens.some((l) => /\b80\b/.test(l) && !/ssl/.test(l));
      // Check for `return 301 https`
      const ret = s.match(/return\s+301\s+https:\/\//);
      if (isHttp && ret) {
        found = true;
        evidence = `listen ${listens.find((l) => /80/.test(l))};\n  ${ret[0]};`;
        break;
      }
    }
    // Also accept `if ($scheme = http) { return 301 https://... }`
    if (!found) {
      const m = config.match(/if\s*\(\s*\$scheme\s*=~?\s*http[^)]*\)\s*\{[\s\S]*?return\s+301\s+https:\/\//);
      if (m) {
        found = true;
        evidence = m[0];
      }
    }
    if (found) {
      return { status: 'pass', message: 'HTTP→HTTPS redirect is configured.', evidence };
    }
    return {
      status: 'fail',
      message: 'No HTTP→HTTPS redirect found. Plain-HTTP requests are not redirected to HTTPS.',
      hints: [
        'Add a dedicated :80 server block:',
        '```\nserver {\n  listen 80;\n  listen [::]:80;\n  server_name example.com;\n  return 301 https://$host$request_uri;\n}\n```',
      ],
    };
  },

  // 4.1.2 Ensure a trusted certificate and trust chain is installed
  '4.1.2': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const certs = findDirective(config, 'ssl_certificate');
    const keys = findDirective(config, 'ssl_certificate_key');
    if (certs.length === 0 || keys.length === 0) {
      return {
        status: 'fail',
        message: 'No ssl_certificate / ssl_certificate_key directives found — HTTPS is not configured.',
        hints: ['Obtain a certificate from a trusted CA and configure it:\n```\nssl_certificate /etc/nginx/ssl/example.com.crt;\nssl_certificate_key /etc/nginx/ssl/example.com.key;\n```'],
      };
    }
    // Check the cert path — should end in .crt/.pem, not be empty
    const evidence = [
      ...certs.map((c) => `ssl_certificate ${c};`),
      ...keys.map((k) => `ssl_certificate_key ${k};`),
    ].join('\n');
    return {
      status: 'pass',
      message: `${certs.length} certificate(s) and ${keys.length} key(s) configured.`,
      evidence,
      hints: ['Verify that the configured certificate is signed by a trusted CA and includes the intermediate chain.'],
    };
  },

  // 4.1.4 Ensure only modern TLS protocols are used
  '4.1.4': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const v = firstDirectiveValue(config, 'ssl_protocols');
    if (!v) {
      // Default is TLSv1 TLSv1.2 in older NGINX — fail
      return {
        status: 'fail',
        message: 'No `ssl_protocols` directive set — older defaults may include TLSv1 / TLSv1.1.',
        hints: ['Add `ssl_protocols TLSv1.2 TLSv1.3;` to the http or server block.'],
      };
    }
    const tokens = v.split(/\s+/);
    const forbidden = ['SSLv2', 'SSLv3', 'TLSv1', 'TLSv1.1'];
    const bad = tokens.filter((t) => forbidden.includes(t));
    if (bad.length > 0) {
      return {
        status: 'fail',
        message: `ssl_protocols includes deprecated protocols: ${bad.join(', ')}.`,
        evidence: `ssl_protocols ${v};`,
        hints: ['Set `ssl_protocols TLSv1.2 TLSv1.3;`.'],
      };
    }
    if (!tokens.includes('TLSv1.3')) {
      return {
        status: 'manual',
        message: 'TLSv1.3 is not enabled — strongly recommended for modern clients.',
        evidence: `ssl_protocols ${v};`,
        hints: ['Add TLSv1.3 to ssl_protocols for forward secrecy and performance.'],
      };
    }
    return {
      status: 'pass',
      message: `Only modern TLS protocols are enabled: ${v}.`,
      evidence: `ssl_protocols ${v};`,
    };
  },

  // 4.1.5 Disable weak ciphers
  '4.1.5': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const v = firstDirectiveValue(config, 'ssl_ciphers');
    if (!v) {
      return {
        status: 'fail',
        message: 'No `ssl_ciphers` directive set — defaults may allow weak ciphers.',
        hints: ['Add `ssl_ciphers ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:!aNULL:!MD5:!RC4:!DES;!3DES;`;'],
      };
    }
    // Check for absence of weak cipher indicators
    const weakPatterns = [/^!?\s*RC4/i, /^!?\s*MD5/i, /^!?\s*DES(?!EDH|3)/i, /^!?\s*3DES/i, /^!?\s*aNULL/i, /^!?\s*eNULL/i, /^!?\s*EXP/i, /^!?\s*LOW/i];
    // We pass if RC4, MD5, DES are explicitly negated OR not present at all
    const hasRC4Neg = /!RC4|!RC4-SHA|!ECDHE-RSA-RC4/i.test(v) || !/\bRC4\b/i.test(v);
    const hasMD5Neg = /!MD5/i.test(v) || !/\bMD5\b/i.test(v);
    const has3DESNeg = /!3DES/i.test(v) || !/\b3DES\b/i.test(v);
    const hasANULL = /!aNULL/i.test(v);
    if (!hasANULL) {
      return {
        status: 'fail',
        message: 'ssl_ciphers does not exclude aNULL (anonymous key exchange).',
        evidence: `ssl_ciphers ${v};`,
        hints: ['Add `!aNULL` to the ssl_ciphers list.'],
      };
    }
    if (!hasRC4Neg || !hasMD5Neg || !has3DESNeg) {
      const missing: string[] = [];
      if (!hasRC4Neg) missing.push('RC4');
      if (!hasMD5Neg) missing.push('MD5');
      if (!has3DESNeg) missing.push('3DES');
      return {
        status: 'fail',
        message: `ssl_ciphers allows weak ciphers: ${missing.join(', ')}.`,
        evidence: `ssl_ciphers ${v};`,
        hints: [`Add !${missing.join(' !')} to the ssl_ciphers list.`],
      };
    }
    return {
      status: 'pass',
      message: 'ssl_ciphers exclude weak ciphers (RC4, MD5, 3DES, aNULL).',
      evidence: `ssl_ciphers ${v};`,
    };
  },

  // 4.1.6 Awareness of TLS 1.3 new Diffie-Hellman parameters (informational)
  '4.1.6': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const hasTls13 = (firstDirectiveValue(config, 'ssl_protocols') || '').includes('TLSv1.3');
    const dh = firstDirectiveValue(config, 'ssl_dhparam');
    if (!hasTls13) {
      return {
        status: 'manual',
        message: 'TLS 1.3 is not enabled. This recommendation is informational when TLS 1.3 is in use.',
        hints: ['Enable TLSv1.3 in ssl_protocols.'],
      };
    }
    if (!dh) {
      return {
        status: 'manual',
        message: 'TLS 1.3 is enabled but no custom `ssl_dhparam` is configured. TLS 1.3 uses a new DH param mechanism and does not require ssl_dhparam.',
        evidence: 'ssl_protocols ... TLSv1.3;',
      };
    }
    return {
      status: 'pass',
      message: 'TLS 1.3 is enabled. Note: TLS 1.3 uses a built-in DH parameter set (RFC 8446); ssl_dhparam is for TLS 1.2 EDH ciphersuites only.',
      evidence: `ssl_protocols ... TLSv1.3;\nssl_dhparam ${dh};`,
    };
  },

  // 4.1.7 Ensure OCSP stapling is enabled
  '4.1.7': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const stapling = firstDirectiveValue(config, 'ssl_stapling');
    const verify = firstDirectiveValue(config, 'ssl_stapling_verify');
    const trusted = firstDirectiveValue(config, 'ssl_trusted_certificate');
    const resolver = firstDirectiveValue(config, 'resolver');
    const evidence = [
      stapling ? `ssl_stapling ${stapling};` : '/* ssl_stapling missing */',
      verify ? `ssl_stapling_verify ${verify};` : '/* ssl_stapling_verify missing */',
      trusted ? `ssl_trusted_certificate ${trusted};` : '/* ssl_trusted_certificate missing */',
      resolver ? `resolver ${resolver};` : '/* resolver missing */',
    ].join('\n');
    const missing: string[] = [];
    if (stapling !== 'on') missing.push('ssl_stapling on;');
    if (verify !== 'on') missing.push('ssl_stapling_verify on;');
    if (!trusted) missing.push('ssl_trusted_certificate /path/to/chain.pem;');
    if (!resolver) missing.push('resolver A.B.C.D;');
    if (missing.length === 0) {
      return { status: 'pass', message: 'OCSP stapling is fully configured.', evidence };
    }
    return {
      status: 'fail',
      message: `OCSP stapling is incomplete. Missing: ${missing.join(', ')}.`,
      evidence,
      hints: [`Add the missing directives:\n\`\`\`\n${missing.join('\n')}\n\`\`\``],
    };
  },

  // 4.1.8 Ensure HSTS is enabled
  '4.1.8': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const headers = findAddHeaders(config);
    const hsts = headers.find((h) => h.name.toLowerCase() === 'strict-transport-security');
    if (!hsts) {
      return {
        status: 'fail',
        message: 'No Strict-Transport-Security header is set.',
        hints: ['Add `add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;` to the HTTPS server block.'],
      };
    }
    // Must include max-age
    const m = hsts.value.match(/max-age=(\d+)/i);
    if (!m) {
      return {
        status: 'fail',
        message: 'HSTS header is set but missing max-age.',
        evidence: `add_header Strict-Transport-Security "${hsts.value}";`,
        hints: ['Include `max-age=31536000` in the HSTS header.'],
      };
    }
    const age = parseInt(m[1], 10);
    if (age < 31536000) {
      return {
        status: 'manual',
        message: `HSTS max-age is ${age}s — recommend at least 1 year (31536000s).`,
        evidence: `add_header Strict-Transport-Security "${hsts.value}";`,
      };
    }
    return {
      status: 'pass',
      message: 'HSTS header is configured with a long max-age.',
      evidence: `add_header Strict-Transport-Security "${hsts.value}";`,
    };
  },

  // 4.1.9 Ensure upstream server traffic is authenticated with a client certificate
  '4.1.9': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const cert = findDirective(config, 'proxy_ssl_certificate');
    const key = findDirective(config, 'proxy_ssl_certificate_key');
    if (cert.length === 0 && key.length === 0) {
      return {
        status: 'fail',
        message: 'No `proxy_ssl_certificate` / `proxy_ssl_certificate_key` directives found — upstream traffic is not authenticated with a client cert.',
        hints: ['Configure mTLS to upstreams:\n```\nproxy_ssl_certificate /etc/nginx/ssl/client.crt;\nproxy_ssl_certificate_key /etc/nginx/ssl/client.key;\n`'],
      };
    }
    return {
      status: 'pass',
      message: `${cert.length} client cert(s) configured for upstream authentication.`,
      evidence: [
        ...cert.map((c) => `proxy_ssl_certificate ${c};`),
        ...key.map((k) => `proxy_ssl_certificate_key ${k};`),
      ].join('\n'),
    };
  },

  // 4.1.10 Ensure the upstream traffic server certificate is trusted
  '4.1.10': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const trusted = findDirective(config, 'proxy_ssl_trusted_certificate');
    const verify = firstDirectiveValue(config, 'proxy_ssl_verify');
    if (trusted.length === 0) {
      return {
        status: 'fail',
        message: 'No `proxy_ssl_trusted_certificate` directive — upstream certificates are not validated.',
        hints: ['Configure upstream cert validation:\n```\nproxy_ssl_trusted_certificate /etc/nginx/ssl/upstream-ca.pem;\nproxy_ssl_verify on;\nproxy_ssl_verify_depth 2;\n`'],
      };
    }
    if (verify !== 'on') {
      return {
        status: 'manual',
        message: 'Upstream CA bundle is configured but `proxy_ssl_verify` is not `on`.',
        evidence: `proxy_ssl_trusted_certificate ${trusted[0]};`,
        hints: ['Add `proxy_ssl_verify on;`.'],
      };
    }
    return {
      status: 'pass',
      message: 'Upstream certificate validation is enabled.',
      evidence: [
        ...trusted.map((t) => `proxy_ssl_trusted_certificate ${t};`),
        `proxy_ssl_verify ${verify};`,
      ].join('\n'),
    };
  },

  // 4.1.11 Ensure Secure Session Resumption is Enabled
  '4.1.11': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const cache = firstDirectiveValue(config, 'ssl_session_cache');
    const tickets = firstDirectiveValue(config, 'ssl_session_tickets');
    const timeout = firstDirectiveValue(config, 'ssl_session_timeout');
    const evidence = [
      cache ? `ssl_session_cache ${cache};` : '/* ssl_session_cache missing */',
      tickets ? `ssl_session_tickets ${tickets};` : '/* ssl_session_tickets missing (default: on) */',
      timeout ? `ssl_session_timeout ${timeout};` : '/* ssl_session_timeout missing */',
    ].join('\n');
    const issues: string[] = [];
    if (!cache || !cache.includes('shared')) issues.push('ssl_session_cache should be `shared:SSL:10m` (or similar)');
    if (tickets === 'off') issues.push('ssl_session_tickets is off — session resumption via tickets is disabled');
    if (!timeout) issues.push('ssl_session_timeout is not set (default 5m)');
    if (issues.length === 0) {
      return { status: 'pass', message: 'Secure session resumption is configured.', evidence };
    }
    return {
      status: 'manual',
      message: `Session resumption configuration has notes: ${issues.join('; ')}.`,
      evidence,
      hints: issues,
    };
  },

  // 4.1.12 Ensure HTTP/3.0 is used
  '4.1.12': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const listens = findDirective(config, 'listen');
    const http3 = listens.filter((l) => /\b(quic|http3)\b/i.test(l));
    if (http3.length === 0) {
      return {
        status: 'fail',
        message: 'No `listen ... quic` (HTTP/3) directives found.',
        hints: ['Enable HTTP/3:\n```\nlisten 443 quic reuseport;\nlisten 443 ssl;\nhttp3 on;\n` Add the Alt-Svc header:\n`add_header Alt-Svc \'h3=":443"; ma=86400\' always;`'],
      };
    }
    const altSvc = findAddHeaders(config).find((h) => h.name.toLowerCase() === 'alt-svc');
    if (!altSvc) {
      return {
        status: 'manual',
        message: 'HTTP/3 listen is configured but no Alt-Svc header advertises it to clients.',
        evidence: http3.map((h) => `listen ${h};`).join('\n'),
        hints: ['Add `add_header Alt-Svc \'h3=":443"; ma=86400\' always;` so clients discover HTTP/3.'],
      };
    }
    return {
      status: 'pass',
      message: 'HTTP/3 is enabled and advertised via Alt-Svc.',
      evidence: [
        ...http3.map((h) => `listen ${h};`),
        `add_header Alt-Svc "${altSvc.value}";`,
      ].join('\n'),
    };
  },

  // 5.1.1 Ensure allow and deny filters limit access to specific IP addresses
  '5.1.1': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const allows = findDirective(config, 'allow');
    const denies = findDirective(config, 'deny');
    if (allows.length === 0 && denies.length === 0) {
      return {
        status: 'manual',
        message: 'No `allow`/`deny` directives found. This is acceptable if IP-based access control is delegated to a WAF/firewall, but should be reviewed.',
        hints: ['If IP-level access control is required, add `allow 192.168.1.0/24; deny all;` to the appropriate location blocks.'],
      };
    }
    return {
      status: 'manual',
      message: `${allows.length} allow rule(s) and ${denies.length} deny rule(s) are configured. Verify they match your IP allowlist policy.`,
      evidence: [
        ...allows.map((a) => `allow ${a};`).slice(0, 5),
        ...denies.map((d) => `deny ${d};`).slice(0, 5),
      ].join('\n'),
    };
  },

  // 5.1.2 Ensure only approved HTTP methods are allowed
  '5.1.2': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const limitExcept = findBlocks(config, 'limit_except');
    const methodIfs = (config.match(/if\s*\(\s*\$request_method[\s\S]*?\}/g) || []).filter((s) => /method/.test(s));
    if (limitExcept.length === 0 && methodIfs.length === 0) {
      return {
        status: 'fail',
        message: 'No HTTP method restrictions found (`limit_except` or `if ($request_method ...)`).',
        hints: ['Add method restrictions to sensitive locations:\n```\nlocation / {\n  limit_except GET POST HEAD {\n    deny all;\n  }\n}\n`'],
      };
    }
    return {
      status: 'pass',
      message: `${limitExcept.length} limit_except block(s) and ${methodIfs.length} method-checking if block(s) found.`,
      evidence: [
        ...limitExcept.map((b) => `limit_except ... { ... }`),
        ...methodIfs.map((b) => b.replace(/\s+/g, ' ').slice(0, 100)),
      ].join('\n'),
    };
  },

  // 5.2.1 Ensure timeout values for reading the client header and body are set correctly
  '5.2.1': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const header = firstDirectiveValue(config, 'client_header_timeout');
    const body = firstDirectiveValue(config, 'client_body_timeout');
    if (!header || !body) {
      const missing = [!header && 'client_header_timeout', !body && 'client_body_timeout'].filter(Boolean);
      return {
        status: 'fail',
        message: `Missing timeout directives: ${missing.join(', ')}.`,
        hints: ['Add `client_header_timeout 10;` and `client_body_timeout 10;` to the http block.'],
      };
    }
    const ht = parseDuration(header);
    const bt = parseDuration(body);
    if (ht === null || bt === null) {
      return { status: 'manual', message: 'Could not parse timeout values.', evidence: `client_header_timeout ${header};\nclient_body_timeout ${body};` };
    }
    if (ht > 10 || bt > 10) {
      return {
        status: 'fail',
        message: `Timeouts exceed 10s (header=${ht}s, body=${bt}s).`,
        evidence: `client_header_timeout ${header};\nclient_body_timeout ${body};`,
        hints: ['Set both to 10s or lower.'],
      };
    }
    return {
      status: 'pass',
      message: `Client header (${ht}s) and body (${bt}s) timeouts are within limits.`,
      evidence: `client_header_timeout ${header};\nclient_body_timeout ${body};`,
    };
  },

  // 5.2.2 Ensure the maximum request body size is set correctly
  '5.2.2': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const v = firstDirectiveValue(config, 'client_max_body_size');
    if (!v) {
      return {
        status: 'fail',
        message: '`client_max_body_size` is not set — defaults to 1m. Configure explicitly.',
        hints: ['Add `client_max_body_size 10m;` (or as small as your application allows).'],
      };
    }
    if (v === '0') {
      return {
        status: 'fail',
        message: 'client_max_body_size is 0 — unlimited upload size. Significant DoS risk.',
        evidence: `client_max_body_size ${v};`,
        hints: ['Set a finite limit, e.g. `client_max_body_size 10m;`.'],
      };
    }
    const bytes = parseSize(v);
    if (bytes === null) {
      return { status: 'manual', message: `Could not parse client_max_body_size: \`${v}\`.`, evidence: `client_max_body_size ${v};` };
    }
    // >100MB is suspicious
    if (bytes > 100 * 1024 * 1024) {
      return {
        status: 'manual',
        message: `client_max_body_size is very large (${(bytes / 1024 / 1024).toFixed(0)}MB) — confirm this is necessary.`,
        evidence: `client_max_body_size ${v};`,
      };
    }
    return {
      status: 'pass',
      message: `client_max_body_size is set to ${v}.`,
      evidence: `client_max_body_size ${v};`,
    };
  },

  // 5.2.3 Ensure the maximum buffer size for URIs is defined
  '5.2.3': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const v = firstDirectiveValue(config, 'large_client_header_buffers');
    if (!v) {
      return {
        status: 'fail',
        message: '`large_client_header_buffers` is not set (defaults to 4 8k — verify this matches your environment).',
        hints: ['Add `large_client_header_buffers 4 8k;` (or smaller) to the http block.'],
      };
    }
    // Format: <count> <size>
    const parts = v.split(/\s+/);
    if (parts.length !== 2) {
      return { status: 'manual', message: `Unexpected large_client_header_buffers format: \`${v}\`.`, evidence: `large_client_header_buffers ${v};` };
    }
    const count = parseInt(parts[0], 10);
    const size = parseSize(parts[1]);
    if (size === null || size > 16 * 1024) {
      return {
        status: 'manual',
        message: `large_client_header_buffers size is large (${parts[1]}) — could allow oversized URI attacks.`,
        evidence: `large_client_header_buffers ${v};`,
        hints: ['Reduce buffer size to 8k or smaller.'],
      };
    }
    return {
      status: 'pass',
      message: `large_client_header_buffers is ${v}.`,
      evidence: `large_client_header_buffers ${v};`,
    };
  },

  // 5.2.4 Ensure the number of connections per IP address is limited
  '5.2.4': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const zone = findDirective(config, 'limit_conn_zone');
    const limit = findDirective(config, 'limit_conn');
    if (zone.length === 0 || limit.length === 0) {
      const missing = [zone.length === 0 && 'limit_conn_zone', limit.length === 0 && 'limit_conn'].filter(Boolean);
      return {
        status: 'fail',
        message: `Missing: ${missing.join(', ')}.`,
        hints: ['Add:\n```\nlimit_conn_zone $binary_remote_addr zone=conn_per_ip:10m;\nlimit_conn conn_per_ip 10;\n`'],
      };
    }
    return {
      status: 'pass',
      message: 'Connection-per-IP limit is configured.',
      evidence: [
        ...zone.map((z) => `limit_conn_zone ${z};`),
        ...limit.map((l) => `limit_conn ${l};`),
      ].join('\n'),
    };
  },

  // 5.2.5 Ensure rate limits by IP address are set
  '5.2.5': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const zone = findDirective(config, 'limit_req_zone');
    const limit = findDirective(config, 'limit_req');
    if (zone.length === 0 || limit.length === 0) {
      const missing = [zone.length === 0 && 'limit_req_zone', limit.length === 0 && 'limit_req'].filter(Boolean);
      return {
        status: 'fail',
        message: `Missing: ${missing.join(', ')}.`,
        hints: ['Add:\n```\nlimit_req_zone $binary_remote_addr zone=req_limit:10m rate=10r/s;\nlimit_req zone=req_limit burst=20 nodelay;\n`'],
      };
    }
    return {
      status: 'pass',
      message: 'Rate limiting is configured.',
      evidence: [
        ...zone.map((z) => `limit_req_zone ${z};`),
        ...limit.map((l) => `limit_req ${l};`),
      ].join('\n'),
    };
  },

  // 5.3.1 Ensure X-Content-Type-Options header is configured and enabled
  '5.3.1': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const headers = findAddHeaders(config);
    const found = headers.find((h) => h.name.toLowerCase() === 'x-content-type-options');
    if (!found) {
      return {
        status: 'fail',
        message: 'X-Content-Type-Options header is not set.',
        hints: ['Add `add_header X-Content-Type-Options "nosniff" always;` to the server or http block.'],
      };
    }
    if (found.value.toLowerCase() !== 'nosniff') {
      return {
        status: 'fail',
        message: `X-Content-Type-Options is set to "${found.value}" — should be "nosniff".`,
        evidence: `add_header X-Content-Type-Options "${found.value}";`,
        hints: ['Set value to "nosniff".'],
      };
    }
    return {
      status: 'pass',
      message: 'X-Content-Type-Options: nosniff is configured.',
      evidence: `add_header X-Content-Type-Options "${found.value}";`,
    };
  },

  // 5.3.2 Ensure that Content Security Policy (CSP) is enabled and configured properly
  '5.3.2': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const headers = findAddHeaders(config);
    const csp = headers.find((h) => h.name.toLowerCase() === 'content-security-policy');
    if (!csp) {
      return {
        status: 'fail',
        message: 'Content-Security-Policy header is not set.',
        hints: ['Add a CSP header. A reasonable starting point:\n`add_header Content-Security-Policy "default-src \'self\'; object-src \'none\'; frame-ancestors \'none\'" always;`'],
      };
    }
    // Basic sanity: should have at least one directive (default-src or similar)
    if (!/default-src|script-src|img-src|style-src/i.test(csp.value)) {
      return {
        status: 'manual',
        message: `CSP header is set but does not contain a default-src or similar directive. Value: "${csp.value}".`,
        evidence: `add_header Content-Security-Policy "${csp.value}";`,
        hints: ['Include a default-src directive in your CSP.'],
      };
    }
    return {
      status: 'pass',
      message: 'Content-Security-Policy is configured.',
      evidence: `add_header Content-Security-Policy "${csp.value}";`,
    };
  },

  // 5.3.3 Ensure the Referrer Policy is enabled and configured properly
  '5.3.3': (ctx) => {
    const config = normalizeConfig(ctx.nginxT);
    const headers = findAddHeaders(config);
    const ref = headers.find((h) => h.name.toLowerCase() === 'referrer-policy');
    if (!ref) {
      return {
        status: 'fail',
        message: 'Referrer-Policy header is not set.',
        hints: ['Add `add_header Referrer-Policy "strict-origin-when-cross-origin" always;` to the server block.'],
      };
    }
    const good = ['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin'];
    if (!good.includes(ref.value.toLowerCase())) {
      return {
        status: 'manual',
        message: `Referrer-Policy is "${ref.value}" — consider using "strict-origin-when-cross-origin" for privacy.`,
        evidence: `add_header Referrer-Policy "${ref.value}";`,
      };
    }
    return {
      status: 'pass',
      message: `Referrer-Policy is "${ref.value}".`,
      evidence: `add_header Referrer-Policy "${ref.value}";`,
    };
  },
};

/**
 * Returns true if the given benchmark type has any auto-evaluators registered.
 */
export function hasEvaluatorsForBenchmark(benchmarkType: string): boolean {
  return !!EVALUATOR_REGISTRY[benchmarkType] && Object.keys(EVALUATOR_REGISTRY[benchmarkType]).length > 0;
}

/**
 * Run the evaluator for a given check ID within a specific benchmark type.
 * Returns null if no evaluator is registered for this benchmark+check.
 */
export function runEvaluatorForBenchmark(benchmarkType: string, id: string, ctx: AuditContext): CheckResult | null {
  const registry = EVALUATOR_REGISTRY[benchmarkType];
  if (!registry) {
    return {
      status: 'manual',
      message: `No auto-evaluators are registered for benchmark type "${benchmarkType}". Manual review required.`,
    };
  }
  const fn = registry[id];
  if (!fn) return null;
  try {
    return fn(ctx);
  } catch (e) {
    return {
      status: 'manual',
      message: `Evaluator error: ${(e as Error).message}`,
    };
  }
}

/** Returns true if a given (benchmarkType, checkId) pair has an automated evaluator. */
export function hasEvaluatorForCheck(benchmarkType: string, id: string): boolean {
  const registry = EVALUATOR_REGISTRY[benchmarkType];
  return !!registry && Object.prototype.hasOwnProperty.call(registry, id);
}

/**
 * Per-benchmark evaluator registry.
 *
 * Each entry maps a recommendation id (e.g. "1.1.1") to an evaluator function.
 * Benchmarks without a registered entry fall back to "manual review required".
 *
 * Currently registered:
 *   - 'nginx'  : 35 evaluators covering most auto-checkable recommendations
 */
export const EVALUATOR_REGISTRY: Record<string, Record<string, Evaluator>> = {
  nginx: { ...EVALUATORS },
};

