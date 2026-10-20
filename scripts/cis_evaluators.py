#!/usr/bin/env python3
"""CIS Benchmark evaluators (Python port of the TypeScript evaluators).

Each evaluator takes an AuditContext (nginx -T and nginx -V outputs) and
returns a CheckResult indicating pass/fail/manual plus a message and an
optional evidence snippet.

Currently registered:
  - 'nginx': 35 evaluators covering most auto-checkable recommendations

For other benchmark types (apache, windows, etc.), no evaluators are
registered and the auditor will mark all checks as "Manual review required".
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable, Optional


@dataclass
class CheckResult:
    status: str = "manual"  # "pass", "fail", "manual"
    message: str = ""
    evidence: Optional[str] = None
    hints: list[str] = field(default_factory=list)


@dataclass
class AuditContext:
    nginx_t: str = ""
    nginx_v: str = ""


Evaluator = Callable[[AuditContext], CheckResult]


# -----------------------------------------------------------------------------
# NGINX config parser helpers
# -----------------------------------------------------------------------------

def normalize_config(raw: str) -> str:
    """Strip '#' comments while preserving quoted strings."""
    lines = []
    for line in raw.split("\n"):
        in_str = None
        out = []
        i = 0
        while i < len(line):
            ch = line[i]
            if in_str:
                out.append(ch)
                if ch == in_str and line[i - 1] != "\\":
                    in_str = None
            else:
                if ch in ('"', "'"):
                    in_str = ch
                    out.append(ch)
                elif ch == "#":
                    break
                else:
                    out.append(ch)
            i += 1
        lines.append("".join(out))
    return "\n".join(lines)


def find_directive(config: str, name: str) -> list[str]:
    """Return all values of a directive (text between name and ';')."""
    results: list[str] = []
    pattern = re.compile(
        r"(^|\n)\s*" + re.escape(name) + r"\s+([\s\S]*?);",
        re.MULTILINE,
    )
    for m in pattern.finditer(config):
        value = re.sub(r"\s+", " ", m.group(2)).strip()
        results.append(value)
    return results


def has_directive(config: str, name: str) -> bool:
    return len(find_directive(config, name)) > 0


def first_directive_value(config: str, name: str) -> Optional[str]:
    vals = find_directive(config, name)
    return vals[0] if vals else None


def find_blocks(config: str, block_name: str, block_arg: Optional[str] = None) -> list[str]:
    """Return the inner text of each matching block."""
    results: list[str] = []
    arg_pattern = (
        rf"\s*({block_arg})\s*" if block_arg else r"(?:\s+([^\{]*?))?"
    )
    pattern = re.compile(
        r"(?:^|\n)\s*" + re.escape(block_name) + arg_pattern + r"\s*\{([\s\S]*?)\n\s*\}",
        re.MULTILINE | re.DOTALL,
    )
    for m in pattern.finditer(config):
        results.append(m.group(2) or "")
    return results


def find_add_headers(config: str) -> list[dict]:
    results: list[dict] = []
    pattern = re.compile(
        r"(?:^|\n)\s*add_header\s+([A-Za-z0-9_-]+)\s+"
        r'("([^"]*)"|\'([^\']*)\'|([^\s;]+))\s*([^;]*);',
        re.MULTILINE,
    )
    for m in pattern.finditer(config):
        results.append({
            "name": m.group(1),
            "value": m.group(3) or m.group(4) or m.group(5) or "",
        })
    return results


def find_proxy_set_headers(config: str, header_name: str) -> list[str]:
    results: list[str] = []
    pattern = re.compile(
        r"(?:^|\n)\s*proxy_set_header\s+" + re.escape(header_name) + r"\s+([^;]+);",
        re.MULTILINE,
    )
    for m in pattern.finditer(config):
        results.append(m.group(1).strip())
    return results


def parse_duration(value: str) -> Optional[float]:
    if not value:
        return None
    m = re.match(r"^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$", value, re.IGNORECASE)
    if not m:
        return None
    num = float(m.group(1))
    unit = (m.group(2) or "s").lower()
    return {
        "ms": num / 1000,
        "s": num,
        "m": num * 60,
        "h": num * 3600,
        "d": num * 86400,
    }.get(unit, num)


def parse_size(value: str) -> Optional[float]:
    if not value:
        return None
    m = re.match(r"^(\d+(?:\.\d+)?)\s*(k|m|g)?b?$", value, re.IGNORECASE)
    if not m:
        return None
    num = float(m.group(1))
    unit = (m.group(2) or "").lower()
    return {
        "": num,
        "k": num * 1024,
        "m": num * 1024 * 1024,
        "g": num * 1024 * 1024 * 1024,
    }.get(unit, num)


def parse_nginx_version(nginx_v: str) -> Optional[str]:
    m = re.search(r"nginx version:\s*nginx/(\d+\.\d+\.\d+)", nginx_v, re.IGNORECASE)
    return m.group(1) if m else None


def compare_versions(a: str, b: str) -> int:
    pa = [int(x) for x in a.split(".")]
    pb = [int(x) for x in b.split(".")]
    for i in range(max(len(pa), len(pb))):
        av = pa[i] if i < len(pa) else 0
        bv = pb[i] if i < len(pb) else 0
        if av < bv:
            return -1
        if av > bv:
            return 1
    return 0


# -----------------------------------------------------------------------------
# NGINX Evaluators
# -----------------------------------------------------------------------------

NGINX_EVALUATORS: dict[str, Evaluator] = {}


def register(name: str):
    def decorator(fn: Evaluator) -> Evaluator:
        NGINX_EVALUATORS[name] = fn
        return fn
    return decorator


@register("1.1.1")
def _1_1_1(ctx: AuditContext) -> CheckResult:
    version = parse_nginx_version(ctx.nginx_v)
    if not version:
        return CheckResult(
            status="fail",
            message="Could not detect NGINX version. Is `nginx -V` output available?",
            evidence="\n".join(ctx.nginx_v.split("\n")[:3]),
        )
    if compare_versions(version, "1.28.0") >= 0:
        return CheckResult(
            status="pass",
            message=f"NGINX {version} is installed (>= 1.28.0 required).",
            evidence=f"nginx version: nginx/{version}",
        )
    return CheckResult(
        status="fail",
        message=f"NGINX {version} is older than required 1.28.0.",
        evidence=f"nginx version: nginx/{version}",
        hints=["Upgrade to NGINX 1.28.0 or later."],
    )


@register("2.1.1")
def _2_1_1(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    loaded = find_directive(config, "load_module")
    if not loaded:
        return CheckResult(status="pass", message="No dynamic modules are loaded.")
    return CheckResult(
        status="manual",
        message=f"{len(loaded)} dynamic module(s) loaded. Review each for necessity.",
        evidence="\n".join(f"load_module {m};" for m in loaded),
        hints=[f"Verify whether \"{m}\" is required." for m in loaded],
    )


@register("2.2.1")
def _2_2_1(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    user_val = first_directive_value(config, "user")
    if not user_val:
        return CheckResult(
            status="fail",
            message="No `user` directive found. Workers run as `nobody` by default.",
            hints=["Add `user nginx;` to the http block."],
        )
    user = user_val.split()[0]
    if user.lower() == "root":
        return CheckResult(
            status="fail",
            message=f"Worker processes run as `{user}` — critical security risk.",
            evidence=f"user {user_val};",
            hints=["Switch to a non-privileged, dedicated account."],
        )
    return CheckResult(
        status="pass",
        message=f"Worker processes run as `{user}` (non-privileged).",
        evidence=f"user {user_val};",
    )


@register("2.4.1")
def _2_4_1(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    listens = find_directive(config, "listen")
    if not listens:
        return CheckResult(status="fail", message="No `listen` directives found.")
    allowed = {80, 443, 8000, 8080, 8443}
    flagged: list[str] = []
    for v in listens:
        m = re.match(r"^(?:\[?([0-9a-fA-F:.]+)\]?:)?(\d+)", v)
        if not m:
            continue
        port = int(m.group(2))
        if port not in allowed:
            flagged.append(f"{v} (port {port})")
    if flagged:
        return CheckResult(
            status="manual",
            message="Non-standard listen ports detected. Verify each is authorized.",
            evidence="\n".join(flagged),
        )
    return CheckResult(
        status="pass",
        message=f"All {len(listens)} listen directives use standard ports.",
        evidence="\n".join(f"listen {l};" for l in listens[:8]),
    )


@register("2.4.2")
def _2_4_2(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    servers = find_blocks(config, "server")
    for s in servers:
        listens = find_directive(s, "listen")
        if not any("default_server" in v for v in listens):
            continue
        m = re.search(r"return\s+(444|404|421)", s)
        if m:
            return CheckResult(
                status="pass",
                message="A default_server block rejects unknown hostnames.",
                evidence=f"listen {[v for v in listens if 'default_server' in v][0]};\n  {m.group(0)};",
            )
    return CheckResult(
        status="fail",
        message="No default_server with return 444/404 found.",
        hints=["Add a default server block returning 444 for unknown hosts."],
    )


@register("2.4.3")
def _2_4_3(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    v = first_directive_value(config, "keepalive_timeout")
    if not v:
        return CheckResult(status="fail", message="`keepalive_timeout` is not set (default 75s).",
                           hints=["Add `keepalive_timeout 10;` to the http block."])
    seconds = parse_duration(v.split()[0])
    if seconds is None:
        return CheckResult(status="manual", message=f"Could not parse keepalive_timeout: `{v}`.",
                           evidence=f"keepalive_timeout {v};")
    if seconds == 0:
        return CheckResult(status="fail", message="keepalive_timeout is 0.",
                           evidence=f"keepalive_timeout {v};")
    if seconds <= 10:
        return CheckResult(status="pass", message=f"keepalive_timeout is {seconds}s.",
                           evidence=f"keepalive_timeout {v};")
    return CheckResult(status="fail", message=f"keepalive_timeout is {seconds}s — exceeds 10s.",
                      evidence=f"keepalive_timeout {v};", hints=["Set `keepalive_timeout 10;`."])


@register("2.4.4")
def _2_4_4(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    v = first_directive_value(config, "send_timeout")
    if not v:
        return CheckResult(status="fail", message="`send_timeout` is not set (default 60s).",
                           hints=["Add `send_timeout 10;` to the http block."])
    seconds = parse_duration(v.split()[0])
    if seconds is None:
        return CheckResult(status="manual", message=f"Could not parse send_timeout: `{v}`.",
                           evidence=f"send_timeout {v};")
    if seconds == 0:
        return CheckResult(status="fail", message="send_timeout is 0.",
                           evidence=f"send_timeout {v};")
    if seconds <= 10:
        return CheckResult(status="pass", message=f"send_timeout is {seconds}s.",
                           evidence=f"send_timeout {v};")
    return CheckResult(status="fail", message=f"send_timeout is {seconds}s — exceeds 10s.",
                      evidence=f"send_timeout {v};", hints=["Set `send_timeout 10;`."])


@register("2.5.1")
def _2_5_1(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    v = first_directive_value(config, "server_tokens")
    if not v:
        return CheckResult(status="fail", message="`server_tokens` not set (default `on`).",
                           hints=["Add `server_tokens off;` to the http block."])
    if v == "off":
        return CheckResult(status="pass", message="server_tokens is `off`.",
                           evidence=f"server_tokens {v};")
    return CheckResult(status="fail", message=f"server_tokens is `{v}` — version info exposed.",
                      evidence=f"server_tokens {v};", hints=["Set `server_tokens off;`."])


@register("2.5.3")
def _2_5_3(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    matching = re.search(r"location\s+~\s*/\\\.[\s\S]*?\}", config)
    if matching and re.search(r"deny\s+all", matching.group(0)):
        return CheckResult(status="pass", message="Hidden file serving is disabled.",
                           evidence=matching.group(0))
    return CheckResult(status="fail", message="No `location ~ /\\.` block with `deny all;`.",
                       hints=["Add:\n```\nlocation ~ /\\. {\n  deny all;\n}\n```"])


@register("2.5.4")
def _2_5_4(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    hidden = find_directive(config, "proxy_hide_header")
    if not hidden:
        return CheckResult(
            status="manual",
            message="No `proxy_hide_header` directives found.",
            hints=["Add `proxy_hide_header X-Powered-By;` etc."],
        )
    return CheckResult(
        status="pass",
        message=f"{len(hidden)} header(s) hidden from upstream responses.",
        evidence="\n".join(f"proxy_hide_header {h};" for h in hidden),
    )


@register("3.1")
def _3_1(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    formats = find_directive(config, "log_format")
    if not formats:
        return CheckResult(status="fail", message="No custom `log_format` defined.",
                           hints=["Define a log_format with $remote_addr, $request, $status, etc."])
    format_str = "\n".join(formats)
    required = ["remote_addr", "request", "status", "http_user_agent"]
    missing = [f for f in required if f not in format_str]
    if missing:
        return CheckResult(status="manual", message=f"log_format missing: {', '.join(missing)}.",
                           evidence="\n".join(f"log_format {f};" for f in formats))
    return CheckResult(status="pass", message="Detailed log_format configured.",
                      evidence="\n".join(f"log_format {f};" for f in formats))


@register("3.2")
def _3_2(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    values = find_directive(config, "access_log")
    if not values:
        return CheckResult(status="fail", message="No `access_log` directive found.",
                           hints=["Add `access_log /var/log/nginx/access.log main;`."])
    if any(v.strip() == "off" for v in values):
        return CheckResult(status="fail", message="Access logging is disabled.",
                           evidence="access_log off;", hints=["Remove `access_log off;`."])
    return CheckResult(status="pass", message=f"Access logging enabled ({len(values)} directive(s)).",
                      evidence="\n".join(f"access_log {v};" for v in values[:3]))


@register("3.3")
def _3_3(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    values = find_directive(config, "error_log")
    if not values:
        return CheckResult(status="fail", message="No `error_log` directive found.",
                           hints=["Add `error_log /var/log/nginx/error.log info;`."])
    if not any(re.search(r"\binfo\b", v) for v in values):
        return CheckResult(status="fail", message="error_log not at info level.",
                           evidence="\n".join(f"error_log {v};" for v in values),
                           hints=["Set error_log to `info` level."])
    return CheckResult(status="pass", message="error_log set to info level.",
                      evidence="\n".join(f"error_log {v};" for v in values if "info" in v))


@register("3.4")
def _3_4(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    real_ip = find_proxy_set_headers(config, "X-Real-IP")
    xff = find_proxy_set_headers(config, "X-Forwarded-For")
    if real_ip and xff:
        return CheckResult(status="pass", message="Both X-Real-IP and X-Forwarded-For forwarded.",
                           evidence="\n".join(
                               [f"proxy_set_header X-Real-IP {v};" for v in real_ip] +
                               [f"proxy_set_header X-Forwarded-For {v};" for v in xff]
                           ))
    missing = []
    if not real_ip: missing.append("X-Real-IP")
    if not xff: missing.append("X-Forwarded-For")
    return CheckResult(status="fail", message=f"Missing: {', '.join(missing)}.",
                       hints=["Add proxy_set_header directives."])


@register("4.1.1")
def _4_1_1(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    servers = find_blocks(config, "server")
    for s in servers:
        listens = find_directive(s, "listen")
        if not any(re.search(r"\b80\b", l) and "ssl" not in l for l in listens):
            continue
        if re.search(r"return\s+301\s+https://", s):
            return CheckResult(status="pass", message="HTTP->HTTPS redirect configured.",
                               evidence="return 301 https://...")
    return CheckResult(status="fail", message="No HTTP->HTTPS redirect.",
                       hints=["Add a :80 server with `return 301 https://$host$request_uri;`."])


@register("4.1.2")
def _4_1_2(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    certs = find_directive(config, "ssl_certificate")
    keys = find_directive(config, "ssl_certificate_key")
    if not certs or not keys:
        return CheckResult(status="fail", message="No ssl_certificate/ssl_certificate_key found.",
                           hints=["Configure TLS certificates."])
    return CheckResult(status="pass",
                       message=f"{len(certs)} cert(s) and {len(keys)} key(s) configured.",
                       evidence="\n".join(
                           [f"ssl_certificate {c};" for c in certs] +
                           [f"ssl_certificate_key {k};" for k in keys]
                       ))


@register("4.1.4")
def _4_1_4(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    v = first_directive_value(config, "ssl_protocols")
    if not v:
        return CheckResult(status="fail", message="No `ssl_protocols` directive set.",
                           hints=["Add `ssl_protocols TLSv1.2 TLSv1.3;`."])
    tokens = v.split()
    forbidden = ["SSLv2", "SSLv3", "TLSv1", "TLSv1.1"]
    bad = [t for t in tokens if t in forbidden]
    if bad:
        return CheckResult(status="fail", message=f"Deprecated protocols: {', '.join(bad)}.",
                           evidence=f"ssl_protocols {v};",
                           hints=["Set `ssl_protocols TLSv1.2 TLSv1.3;`."])
    if "TLSv1.3" not in tokens:
        return CheckResult(status="manual", message="TLSv1.3 not enabled.",
                           evidence=f"ssl_protocols {v};",
                           hints=["Add TLSv1.3 to ssl_protocols."])
    return CheckResult(status="pass", message=f"Modern TLS: {v}.",
                       evidence=f"ssl_protocols {v};")


@register("4.1.5")
def _4_1_5(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    v = first_directive_value(config, "ssl_ciphers")
    if not v:
        return CheckResult(status="fail", message="No `ssl_ciphers` directive set.",
                           hints=["Configure strong ciphers with !aNULL, !MD5, !RC4, !3DES."])
    if "!aNULL" not in v:
        return CheckResult(status="fail", message="ssl_ciphers does not exclude aNULL.",
                           evidence=f"ssl_ciphers {v};", hints=["Add `!aNULL`."])
    if not re.search(r"!RC4|!RC4-SHA|!ECDHE-RSA-RC4", v) and re.search(r"\bRC4\b", v):
        return CheckResult(status="fail", message="ssl_ciphers allows RC4.",
                           evidence=f"ssl_ciphers {v};", hints=["Add `!RC4`."])
    if not re.search(r"!MD5", v) and re.search(r"\bMD5\b", v):
        return CheckResult(status="fail", message="ssl_ciphers allows MD5.",
                           evidence=f"ssl_ciphers {v};", hints=["Add `!MD5`."])
    if not re.search(r"!3DES", v) and re.search(r"\b3DES\b", v):
        return CheckResult(status="fail", message="ssl_ciphers allows 3DES.",
                           evidence=f"ssl_ciphers {v};", hints=["Add `!3DES`."])
    return CheckResult(status="pass", message="ssl_ciphers exclude weak ciphers.",
                       evidence=f"ssl_ciphers {v};")


@register("4.1.6")
def _4_1_6(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    has_tls13 = "TLSv1.3" in (first_directive_value(config, "ssl_protocols") or "")
    dh = first_directive_value(config, "ssl_dhparam")
    if not has_tls13:
        return CheckResult(status="manual", message="TLS 1.3 not enabled.",
                           hints=["Enable TLSv1.3."])
    if not dh:
        return CheckResult(status="manual",
                           message="TLS 1.3 enabled; no ssl_dhparam (not required for TLS 1.3).",
                           evidence="ssl_protocols ... TLSv1.3;")
    return CheckResult(status="pass",
                       message="TLS 1.3 enabled. ssl_dhparam is for TLS 1.2 EDH only.",
                       evidence=f"ssl_dhparam {dh};")


@register("4.1.7")
def _4_1_7(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    stapling = first_directive_value(config, "ssl_stapling")
    verify = first_directive_value(config, "ssl_stapling_verify")
    trusted = first_directive_value(config, "ssl_trusted_certificate")
    resolver = first_directive_value(config, "resolver")
    evidence_lines = [
        f"ssl_stapling {stapling};" if stapling else "/* ssl_stapling missing */",
        f"ssl_stapling_verify {verify};" if verify else "/* ssl_stapling_verify missing */",
        f"ssl_trusted_certificate {trusted};" if trusted else "/* ssl_trusted_certificate missing */",
        f"resolver {resolver};" if resolver else "/* resolver missing */",
    ]
    missing = []
    if stapling != "on": missing.append("ssl_stapling on;")
    if verify != "on": missing.append("ssl_stapling_verify on;")
    if not trusted: missing.append("ssl_trusted_certificate /path/chain.pem;")
    if not resolver: missing.append("resolver A.B.C.D;")
    if not missing:
        return CheckResult(status="pass", message="OCSP stapling fully configured.",
                           evidence="\n".join(evidence_lines))
    return CheckResult(status="fail", message=f"OCSP stapling incomplete. Missing: {', '.join(missing)}.",
                       evidence="\n".join(evidence_lines),
                       hints=["Add missing OCSP directives."])


@register("4.1.8")
def _4_1_8(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    headers = find_add_headers(config)
    hsts = next((h for h in headers if h["name"].lower() == "strict-transport-security"), None)
    if not hsts:
        return CheckResult(status="fail", message="No HSTS header.",
                           hints=["Add `add_header Strict-Transport-Security \"max-age=31536000; includeSubDomains\" always;`."])
    m = re.search(r"max-age=(\d+)", hsts["value"], re.IGNORECASE)
    if not m:
        return CheckResult(status="fail", message="HSTS missing max-age.",
                           evidence=f'add_header Strict-Transport-Security "{hsts["value"]}";')
    age = int(m.group(1))
    if age < 31536000:
        return CheckResult(status="manual", message=f"HSTS max-age is {age}s.",
                           evidence=f'add_header Strict-Transport-Security "{hsts["value"]}";')
    return CheckResult(status="pass", message="HSTS configured with long max-age.",
                       evidence=f'add_header Strict-Transport-Security "{hsts["value"]}";')


@register("4.1.9")
def _4_1_9(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    cert = find_directive(config, "proxy_ssl_certificate")
    key = find_directive(config, "proxy_ssl_certificate_key")
    if not cert and not key:
        return CheckResult(status="fail", message="No proxy_ssl_certificate/key directives.",
                           hints=["Configure mTLS to upstreams."])
    return CheckResult(status="pass",
                       message=f"{len(cert)} client cert(s) configured.",
                       evidence="\n".join(
                           [f"proxy_ssl_certificate {c};" for c in cert] +
                           [f"proxy_ssl_certificate_key {k};" for k in key]
                       ))


@register("4.1.10")
def _4_1_10(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    trusted = find_directive(config, "proxy_ssl_trusted_certificate")
    verify = first_directive_value(config, "proxy_ssl_verify")
    if not trusted:
        return CheckResult(status="fail", message="No proxy_ssl_trusted_certificate directive.",
                           hints=["Configure upstream cert validation."])
    if verify != "on":
        return CheckResult(status="manual",
                           message="Upstream CA bundle configured but proxy_ssl_verify is not 'on'.",
                           evidence=f"proxy_ssl_trusted_certificate {trusted[0]};",
                           hints=["Add `proxy_ssl_verify on;`."])
    return CheckResult(status="pass", message="Upstream certificate validation enabled.",
                       evidence="\n".join(
                           [f"proxy_ssl_trusted_certificate {t};" for t in trusted] +
                           [f"proxy_ssl_verify {verify};"]
                       ))


@register("4.1.11")
def _4_1_11(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    cache = first_directive_value(config, "ssl_session_cache")
    tickets = first_directive_value(config, "ssl_session_tickets")
    timeout = first_directive_value(config, "ssl_session_timeout")
    evidence_lines = [
        f"ssl_session_cache {cache};" if cache else "/* ssl_session_cache missing */",
        f"ssl_session_tickets {tickets};" if tickets else "/* ssl_session_tickets missing */",
        f"ssl_session_timeout {timeout};" if timeout else "/* ssl_session_timeout missing */",
    ]
    issues = []
    if not cache or "shared" not in cache:
        issues.append("ssl_session_cache should be shared:SSL:10m")
    if tickets == "off":
        issues.append("ssl_session_tickets is off")
    if not timeout:
        issues.append("ssl_session_timeout not set")
    if not issues:
        return CheckResult(status="pass", message="Secure session resumption configured.",
                           evidence="\n".join(evidence_lines))
    return CheckResult(status="manual",
                       message=f"Session resumption notes: {'; '.join(issues)}.",
                       evidence="\n".join(evidence_lines), hints=issues)


@register("4.1.12")
def _4_1_12(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    listens = find_directive(config, "listen")
    http3 = [l for l in listens if re.search(r"\b(quic|http3)\b", l, re.IGNORECASE)]
    if not http3:
        return CheckResult(status="fail", message="No `listen ... quic` directives found.",
                           hints=["Enable HTTP/3: `listen 443 quic reuseport;`"])
    alt_svc = next((h for h in find_add_headers(config) if h["name"].lower() == "alt-svc"), None)
    if not alt_svc:
        return CheckResult(status="manual",
                           message="HTTP/3 listen configured but no Alt-Svc header advertised.",
                           evidence="\n".join(f"listen {h};" for h in http3),
                           hints=["Add `add_header Alt-Svc 'h3=\":443\"; ma=86400' always;`."])
    return CheckResult(status="pass", message="HTTP/3 enabled and advertised via Alt-Svc.",
                       evidence="\n".join([f"listen {h};" for h in http3] +
                                          [f'add_header Alt-Svc "{alt_svc["value"]}";']))


@register("5.1.1")
def _5_1_1(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    allows = find_directive(config, "allow")
    denies = find_directive(config, "deny")
    if not allows and not denies:
        return CheckResult(status="manual", message="No allow/deny directives.",
                           hints=["Add IP allowlist rules if needed."])
    return CheckResult(status="manual",
                       message=f"{len(allows)} allow + {len(denies)} deny rules. Verify against policy.",
                       evidence="\n".join(
                           [f"allow {a};" for a in allows[:5]] +
                           [f"deny {d};" for d in denies[:5]]
                       ))


@register("5.1.2")
def _5_1_2(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    limit_excepts = find_blocks(config, "limit_except")
    method_ifs = [s for s in re.findall(r"if\s*\(\s*\$request_method[\s\S]*?\}", config)
                  if "method" in s]
    if not limit_excepts and not method_ifs:
        return CheckResult(status="fail", message="No HTTP method restrictions.",
                           hints=["Add `limit_except GET POST HEAD { deny all; }`."])
    return CheckResult(status="pass",
                       message=f"{len(limit_excepts)} limit_except + {len(method_ifs)} method-if blocks.")


@register("5.2.1")
def _5_2_1(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    header = first_directive_value(config, "client_header_timeout")
    body = first_directive_value(config, "client_body_timeout")
    if not header or not body:
        missing = []
        if not header: missing.append("client_header_timeout")
        if not body: missing.append("client_body_timeout")
        return CheckResult(status="fail", message=f"Missing: {', '.join(missing)}.",
                           hints=["Add `client_header_timeout 10;` and `client_body_timeout 10;`."])
    ht = parse_duration(header)
    bt = parse_duration(body)
    if ht is None or bt is None:
        return CheckResult(status="manual", message="Could not parse timeout values.",
                           evidence=f"client_header_timeout {header};\nclient_body_timeout {body};")
    if ht > 10 or bt > 10:
        return CheckResult(status="fail",
                           message=f"Timeouts exceed 10s (header={ht}s, body={bt}s).",
                           evidence=f"client_header_timeout {header};\nclient_body_timeout {body};",
                           hints=["Set both to <= 10s."])
    return CheckResult(status="pass",
                       message=f"Header ({ht}s) and body ({bt}s) timeouts within limits.",
                       evidence=f"client_header_timeout {header};\nclient_body_timeout {body};")


@register("5.2.2")
def _5_2_2(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    v = first_directive_value(config, "client_max_body_size")
    if not v:
        return CheckResult(status="fail", message="`client_max_body_size` not set.",
                           hints=["Add `client_max_body_size 10m;`."])
    if v == "0":
        return CheckResult(status="fail", message="client_max_body_size is 0 (unlimited).",
                           evidence=f"client_max_body_size {v};",
                           hints=["Set a finite limit."])
    return CheckResult(status="pass", message=f"client_max_body_size is {v}.",
                       evidence=f"client_max_body_size {v};")


@register("5.2.3")
def _5_2_3(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    v = first_directive_value(config, "large_client_header_buffers")
    if not v:
        return CheckResult(status="fail", message="`large_client_header_buffers` not set.",
                           hints=["Add `large_client_header_buffers 4 8k;`."])
    parts = v.split()
    if len(parts) != 2:
        return CheckResult(status="manual", message=f"Unexpected format: `{v}`.",
                           evidence=f"large_client_header_buffers {v};")
    size = parse_size(parts[1])
    if size is None or size > 16 * 1024:
        return CheckResult(status="manual",
                           message=f"Buffer size is large ({parts[1]}).",
                           evidence=f"large_client_header_buffers {v};",
                           hints=["Reduce buffer size."])
    return CheckResult(status="pass", message=f"large_client_header_buffers is {v}.",
                       evidence=f"large_client_header_buffers {v};")


@register("5.2.4")
def _5_2_4(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    zone = find_directive(config, "limit_conn_zone")
    limit = find_directive(config, "limit_conn")
    if not zone or not limit:
        missing = []
        if not zone: missing.append("limit_conn_zone")
        if not limit: missing.append("limit_conn")
        return CheckResult(status="fail", message=f"Missing: {', '.join(missing)}.",
                           hints=["Add limit_conn_zone and limit_conn directives."])
    return CheckResult(status="pass", message="Connection-per-IP limit configured.",
                       evidence="\n".join(
                           [f"limit_conn_zone {z};" for z in zone] +
                           [f"limit_conn {l};" for l in limit]
                       ))


@register("5.2.5")
def _5_2_5(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    zone = find_directive(config, "limit_req_zone")
    limit = find_directive(config, "limit_req")
    if not zone or not limit:
        missing = []
        if not zone: missing.append("limit_req_zone")
        if not limit: missing.append("limit_req")
        return CheckResult(status="fail", message=f"Missing: {', '.join(missing)}.",
                           hints=["Add limit_req_zone and limit_req directives."])
    return CheckResult(status="pass", message="Rate limiting configured.",
                       evidence="\n".join(
                           [f"limit_req_zone {z};" for z in zone] +
                           [f"limit_req {l};" for l in limit]
                       ))


@register("5.3.1")
def _5_3_1(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    headers = find_add_headers(config)
    h = next((x for x in headers if x["name"].lower() == "x-content-type-options"), None)
    if not h:
        return CheckResult(status="fail", message="X-Content-Type-Options not set.",
                           hints=["Add `add_header X-Content-Type-Options \"nosniff\" always;`."])
    if h["value"].lower() != "nosniff":
        return CheckResult(status="fail",
                           message=f'X-Content-Type-Options is "{h["value"]}" — should be "nosniff".',
                           evidence=f'add_header X-Content-Type-Options "{h["value"]}";')
    return CheckResult(status="pass", message="X-Content-Type-Options: nosniff configured.",
                       evidence=f'add_header X-Content-Type-Options "{h["value"]}";')


@register("5.3.2")
def _5_3_2(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    headers = find_add_headers(config)
    csp = next((x for x in headers if x["name"].lower() == "content-security-policy"), None)
    if not csp:
        return CheckResult(status="fail", message="Content-Security-Policy not set.",
                           hints=["Add a CSP header with default-src."])
    if not re.search(r"default-src|script-src|img-src|style-src", csp["value"], re.IGNORECASE):
        return CheckResult(status="manual", message="CSP set but no default-src or similar directive.",
                           evidence=f'add_header Content-Security-Policy "{csp["value"]}";')
    return CheckResult(status="pass", message="CSP configured.",
                       evidence=f'add_header Content-Security-Policy "{csp["value"]}";')


@register("5.3.3")
def _5_3_3(ctx: AuditContext) -> CheckResult:
    config = normalize_config(ctx.nginx_t)
    headers = find_add_headers(config)
    ref = next((x for x in headers if x["name"].lower() == "referrer-policy"), None)
    if not ref:
        return CheckResult(status="fail", message="Referrer-Policy not set.",
                           hints=["Add `add_header Referrer-Policy \"strict-origin-when-cross-origin\" always;`."])
    good = ["no-referrer", "same-origin", "strict-origin", "strict-origin-when-cross-origin"]
    if ref["value"].lower() not in good:
        return CheckResult(status="manual",
                           message=f'Referrer-Policy is "{ref["value"]}" — consider "strict-origin-when-cross-origin".',
                           evidence=f'add_header Referrer-Policy "{ref["value"]}";')
    return CheckResult(status="pass", message=f'Referrer-Policy is "{ref["value"]}".',
                       evidence=f'add_header Referrer-Policy "{ref["value"]}";')


# Registry keyed by benchmark type --------------------------------------------

EVALUATOR_REGISTRY: dict[str, dict[str, Evaluator]] = {
    "nginx": NGINX_EVALUATORS,
}


def has_evaluators_for_benchmark(benchmark_type: str) -> bool:
    return bool(EVALUATOR_REGISTRY.get(benchmark_type))


def has_evaluator_for_check(benchmark_type: str, rec_id: str) -> bool:
    return rec_id in EVALUATOR_REGISTRY.get(benchmark_type, {})


def run_evaluator(benchmark_type: str, rec_id: str, ctx: AuditContext) -> Optional[CheckResult]:
    """Run a single evaluator. Returns None if no evaluator registered for this check."""
    registry = EVALUATOR_REGISTRY.get(benchmark_type)
    if not registry:
        return CheckResult(
            status="manual",
            message=f"No auto-evaluators registered for benchmark type '{benchmark_type}'. Manual review required.",
        )
    fn = registry.get(rec_id)
    if not fn:
        return None
    try:
        return fn(ctx)
    except Exception as e:
        return CheckResult(status="manual", message=f"Evaluator error: {e}")
