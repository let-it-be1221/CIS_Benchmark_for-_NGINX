#!/usr/bin/env python3
"""Generate src/data/cis_checks.ts from cis_checks.json."""
import json
import os

with open('/home/z/my-project/scripts/cis_checks.json', encoding='utf-8') as f:
    recs = json.load(f)

SECTION_NAMES = {
    1: 'Initial Setup',
    2: 'Basic Configuration',
    3: 'Logging',
    4: 'Encryption',
    5: 'Request Filtering & Restrictions',
    6: 'Mandatory Access Control',
}

SUBSECTIONS = {
    '1.1': 'Installation',
    '1.2': 'Configure Software Updates',
    '2.1': 'Minimize NGINX Modules',
    '2.2': 'Account Security',
    '2.3': 'Permissions & Ownership',
    '2.4': 'Network Configuration',
    '2.5': 'Information Disclosure',
    '4.1': 'TLS / SSL Configuration',
    '5.1': 'Access Control',
    '5.2': 'Request Limits',
    '5.3': 'Browser Security',
}

# Which checks are auto-evaluatable from nginx -T output (config parsing)
# vs. requiring filesystem/process inspection (manual)
AUTO_EVALUATABLE = {
    '1.1.1': True,   # nginx version -V output
    '1.2.1': False,  # repo config (filesystem)
    '1.2.2': False,  # package version (needs dnf/apt)
    '2.1.1': True,   # load_module in nginx -T
    '2.2.1': True,   # user directive in nginx -T
    '2.2.2': False,  # account locked - needs /etc/shadow
    '2.2.3': False,  # invalid shell - needs /etc/passwd
    '2.3.1': False,  # file ownership - needs filesystem
    '2.3.2': False,  # file permissions - needs filesystem
    '2.3.3': False,  # PID file - needs filesystem
    '2.4.1': True,   # listen directive
    '2.4.2': True,   # default_server + return 444
    '2.4.3': True,   # keepalive_timeout
    '2.4.4': True,   # send_timeout
    '2.5.1': True,   # server_tokens off
    '2.5.2': False,  # default error pages content
    '2.5.3': True,   # location ~ /\.
    '2.5.4': True,   # proxy_hide_header / proxy_pass
    '3.1':  True,    # log_format
    '3.2':  True,    # access_log
    '3.3':  True,    # error_log info
    '3.4':  True,    # proxy_set_header X-Real-IP / X-Forwarded-For
    '4.1.1': True,   # http -> https redirect
    '4.1.2': True,   # ssl_certificate / ssl_certificate_key
    '4.1.3': False,  # private key file perms - filesystem
    '4.1.4': True,   # ssl_protocols
    '4.1.5': True,   # ssl_ciphers
    '4.1.6': True,   # informational - based on TLS 1.3 dh param
    '4.1.7': True,   # ssl_stapling on
    '4.1.8': True,   # add_header Strict-Transport-Security
    '4.1.9': True,   # proxy_ssl_certificate
    '4.1.10': True,  # proxy_ssl_trusted_certificate
    '4.1.11': True,  # ssl_session_cache / ssl_session_tickets / ssl_session_timeout
    '4.1.12': True,  # listen ... quic / http3
    '5.1.1': True,   # allow/deny
    '5.1.2': True,   # limit_except / if $request_method
    '5.2.1': True,   # client_header_timeout / client_body_timeout
    '5.2.2': True,   # client_max_body_size
    '5.2.3': True,   # large_client_header_buffers
    '5.2.4': True,   # limit_conn_zone / limit_conn
    '5.2.5': True,   # limit_req_zone / limit_req
    '5.3.1': True,   # add_header X-Content-Type-Options
    '5.3.2': True,   # add_header Content-Security-Policy
    '5.3.3': True,   # add_header Referrer-Policy
}


def quote_str(s):
    """Convert Python string to TS string literal (double-quoted)."""
    if s is None:
        return '""'
    # Strip any CR characters first
    s = s.replace('\r', '')
    # Escape backslash and double quotes
    s = s.replace('\\', '\\\\')
    s = s.replace('"', '\\"')
    # Escape newlines and tabs
    s = s.replace('\n', '\\n')
    s = s.replace('\t', '\\t')
    return '"' + s + '"'


out = []
out.append('// Auto-generated from CIS NGINX Benchmark v3.0.0 PDF')
out.append('// Source: CIS_NGINX_Benchmark_v3.0.0.pdf extracted via scripts/extract_checks.py')
out.append('// Do not edit by hand; edit scripts/extract_checks.py and regenerate.')
out.append('')
out.append('export interface CISCheck {')
out.append('  id: string;')
out.append('  title: string;')
out.append('  section: number;')
out.append('  sectionName: string;')
out.append('  subsection: string;')
out.append('  profile: string[];')
out.append('  description: string;')
out.append('  rationale: string;')
out.append('  impact: string;')
out.append('  audit: string;')
out.append('  remediation: string;')
out.append('  defaultValue: string;')
out.append('  references: string;')
out.append('  additionalInfo: string;')
out.append('  /** Whether this check can be auto-evaluated from `nginx -T` output */')
out.append('  autoEvaluatable: boolean;')
out.append('}')
out.append('')
out.append('export const CIS_CHECKS: CISCheck[] = [')

for r in recs:
    sec = int(r['id'].split('.')[0])
    sub_key = '.'.join(r['id'].split('.')[:2])
    sub = SUBSECTIONS.get(sub_key, '')
    profile_lines = [p.strip() for p in r['profile'].split('\n') if p.strip()]
    profile = []
    for p in profile_lines:
        # Strip leading bullet markers
        p = p.lstrip('- ').strip()
        if p:
            profile.append(p)
    
    auto_eval = AUTO_EVALUATABLE.get(r['id'], False)
    
    out.append('  {')
    out.append(f'    id: {quote_str(r["id"])},')
    out.append(f'    title: {quote_str(r["title"])},')
    out.append(f'    section: {sec},')
    out.append(f'    sectionName: {quote_str(SECTION_NAMES.get(sec, ""))},')
    out.append(f'    subsection: {quote_str(sub)},')
    out.append(f'    profile: [{", ".join(quote_str(p) for p in profile)}],')
    out.append(f'    description: {quote_str(r["description"])},')
    out.append(f'    rationale: {quote_str(r["rationale"])},')
    out.append(f'    impact: {quote_str(r["impact"])},')
    out.append(f'    audit: {quote_str(r["audit"])},')
    out.append(f'    remediation: {quote_str(r["remediation"])},')
    out.append(f'    defaultValue: {quote_str(r["default_value"])},')
    out.append(f'    references: {quote_str(r["references"])},')
    out.append(f'    additionalInfo: {quote_str(r["additional_info"])},')
    out.append(f'    autoEvaluatable: {"true" if auto_eval else "false"},')
    out.append('  },')

out.append('];')
out.append('')

with open('/home/z/my-project/src/data/cis_checks.ts', 'w', encoding='utf-8') as f:
    f.write('\n'.join(out))

print(f'Generated /home/z/my-project/src/data/cis_checks.ts')
print(f'Total checks: {len(recs)}')
print(f'Auto-evaluatable: {sum(1 for r in recs if AUTO_EVALUATABLE.get(r["id"], False))}')
print(f'Manual: {sum(1 for r in recs if not AUTO_EVALUATABLE.get(r["id"], False))}')
print(f'File size: {os.path.getsize("/home/z/my-project/src/data/cis_checks.ts")} bytes')
