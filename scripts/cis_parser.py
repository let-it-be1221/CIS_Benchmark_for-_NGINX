#!/usr/bin/env python3
"""CIS Benchmark PDF parser (Python module).

Generic parser that works for any CIS Benchmark PDF:
- CIS NGINX Benchmark
- CIS Apache Benchmark
- CIS Microsoft Windows Server Benchmark
- CIS Red Hat Enterprise Linux Benchmark
- etc.

Strategy: find each "Profile Applicability:" marker (which only appears in
body recommendations, not TOC/summary). Then walk backward to find the
recommendation header which starts with an ID like X.Y or X.Y.Z and ends
with "(Manual)" or "(Automated)".
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional


SECTION_NAMES_FALLBACK = {
    1: "Initial Setup",
    2: "Basic Configuration",
    3: "Logging",
    4: "Encryption",
    5: "Request Filtering & Restrictions",
    6: "Mandatory Access Control",
    7: "Access Control",
    8: "Audit Logging",
    9: "Maintenance",
}


@dataclass
class ParsedRecommendation:
    id: str
    title: str
    section: int
    section_name: str
    subsection: str
    profile: list[str] = field(default_factory=list)
    description: str = ""
    rationale: str = ""
    impact: str = ""
    audit: str = ""
    remediation: str = ""
    default_value: str = ""
    references: str = ""
    additional_info: str = ""
    assessment_status: str = "Manual"  # "Manual" or "Automated"


@dataclass
class ParsedBenchmark:
    title: str
    version: str
    date: str
    file_name: str
    benchmark_type: str
    recommendation_count: int
    recommendations: list[ParsedRecommendation]
    sections: list[dict]
    warnings: list[str] = field(default_factory=list)


def extract_metadata(text: str) -> tuple[str, str, str]:
    """Extract (title, version, date) from the first ~800 chars."""
    head = text[:800]
    title_match = re.search(r"CIS\s+([A-Z][A-Za-z0-9 _.\-]+?)\s+Benchmark", head)
    title = f"CIS {title_match.group(1).strip()} Benchmark" if title_match else "CIS Benchmark"
    version_match = re.search(r"(?:Version\s+|v)(\d+\.\d+(?:\.\d+)?)", head, re.IGNORECASE)
    version = f"v{version_match.group(1)}" if version_match else "unknown version"
    date_match = re.search(r"(\d{1,2}-\d{1,2}-\d{4}|\d{4}-\d{1,2}-\d{1,2})", head)
    date = date_match.group(1) if date_match else ""
    return title, version, date


def detect_benchmark_type(title: str) -> str:
    lower = title.lower()
    mapping = [
        ("nginx", "nginx"),
        ("apache", "apache"), ("httpd", "apache"),
        ("microsoft", "windows") if "windows" in lower else ("microsoft iis", "iis"),
        ("red hat", "linux"), ("rhel", "linux"), ("ubuntu", "linux"),
        ("debian", "linux"), ("linux", "linux"),
        ("kubernetes", "kubernetes"),
        ("docker", "docker"),
        ("aws", "aws"),
        ("azure", "azure"),
        ("gcp", "gcp"), ("google cloud", "gcp"),
        ("postgresql", "postgresql"),
        ("mysql", "mysql"),
        ("mongodb", "mongodb"),
        ("redis", "redis"),
        ("elasticsearch", "elasticsearch"),
        ("vmware", "vmware"), ("vsphere", "vmware"),
    ]
    # Build a clean list (the conditional above produced tuples or 4-tuples)
    pairs: list[tuple[str, str]] = []
    for item in mapping:
        if isinstance(item, tuple) and len(item) == 2:
            pairs.append(item)
    for needle, type_name in pairs:
        if needle in lower:
            return type_name
    return "unknown"


def extract_section_names(text: str) -> dict[int, str]:
    """Extract section names from the TOC."""
    result: dict[int, str] = {}
    toc_start = re.search(r"(?m)^Table of Contents\s*$", text)
    if not toc_start:
        return result
    toc_end = re.search(r"(?m)^(Overview|Recommendations|Introduction)\s*$", text)
    end = toc_end.start() if toc_end else toc_start.start() + 5000
    toc = text[toc_start.start():end]
    pattern = re.compile(r"(?m)^(\d+)\s+([A-Z][A-Za-z0-9 _/\-&]+?)\s*\.{3,}\s*\d+\s*$")
    for m in pattern.finditer(toc):
        num = int(m.group(1))
        name = m.group(2).strip()
        if 1 <= num <= 20 and 2 < len(name) < 80:
            result[num] = name
    return result


def extract_subsection_names(text: str) -> dict[str, str]:
    """Extract subsection names from the TOC."""
    result: dict[str, str] = {}
    toc_start = re.search(r"(?m)^Table of Contents\s*$", text)
    if not toc_start:
        return result
    toc_end = re.search(r"(?m)^(Overview|Recommendations|Introduction)\s*$", text)
    end = toc_end.start() if toc_end else toc_start.start() + 8000
    toc = text[toc_start.start():end]
    pattern = re.compile(r"(?m)^(\d+\.\d+)\s+([A-Z][A-Za-z0-9 _/\-&]+?)\s*\.{3,}\s*\d+\s*$")
    for m in pattern.finditer(toc):
        rec_id = m.group(1)
        name = m.group(2).strip()
        if 2 < len(name) < 80:
            result[rec_id] = name
    return result


def parse_cis_benchmark(text: str, file_name: str) -> ParsedBenchmark:
    """Parse raw PDF text into a ParsedBenchmark."""
    warnings: list[str] = []
    content = text.replace("\x0c", "\n")

    title, version, date = extract_metadata(content)
    benchmark_type = detect_benchmark_type(title)
    section_names = extract_section_names(content)
    subsection_names = extract_subsection_names(content)

    # Find all "Profile Applicability:" positions
    prof_re = re.compile(r"(?m)^Profile Applicability:")
    prof_positions = [m.start() for m in prof_re.finditer(content)]

    field_names = [
        "Profile Applicability", "Description", "Rationale", "Impact",
        "Audit", "Remediation", "Default Value", "References",
        "Additional Information", "CIS Controls",
    ]
    boundary = "|".join(rf"^{re.escape(n)}:" for n in field_names)

    def extract_field(name: str, full_section: str) -> str:
        pat = re.compile(
            rf"^{re.escape(name)}:\s*\n?(.*?)(?={boundary}|\Z)",
            re.MULTILINE | re.DOTALL,
        )
        m = pat.search(full_section)
        if not m:
            return ""
        return m.group(1).replace("\u2022", "-").strip()

    def clean_field(val: str, own_header: str) -> str:
        for h in field_names:
            if h == own_header:
                continue
            idx = val.find(h + ":")
            if idx != -1:
                val = val[:idx].strip()
        return val

    recommendations: list[ParsedRecommendation] = []

    for pos in prof_positions:
        # Walk backward to find header line
        back = content[max(0, pos - 500):pos]
        back_lines = back.split("\n")
        header_lines: list[str] = []
        found_header = False
        for line in reversed(back_lines):
            if re.match(r"^\d+\.\d+(?:\.\d+)?\s+", line):
                header_lines.insert(0, line)
                found_header = True
                break
            elif not line.strip() or line.strip().startswith("Page"):
                if header_lines:
                    break
                continue
            else:
                if found_header:
                    break
                header_lines.insert(0, line)
                if len(header_lines) > 5:
                    break
        if not found_header:
            continue
        header_text = " ".join(l.strip() for l in header_lines)
        header_match = re.match(
            r"(\d+\.\d+(?:\.\d+)?)\s+(.+?)\s*\((Manual|Automated)\)\s*$",
            header_text,
        )
        if not header_match:
            continue
        rec_id = header_match.group(1)
        rec_title = re.sub(r"\s+", " ", header_match.group(2)).strip()
        assessment_status = header_match.group(3)

        # Find end: next Profile Applicability or appendix
        next_pos = None
        for p in prof_positions:
            if p > pos:
                next_pos = p
                break
        if next_pos is None:
            end_pos = len(content)
        else:
            # Walk back from next_pos to find header start
            back2 = content[max(0, next_pos - 500):next_pos]
            back_lines2 = back2.split("\n")
            end_pos = next_pos
            for line in reversed(back_lines2):
                if re.match(r"^\d+\.\d+(?:\.\d+)?\s+", line):
                    idx = back2.rfind(line)
                    if idx != -1:
                        end_pos = max(0, next_pos - 500) + idx
                        break
        appendix_pos = content.find("Appendix: Summary Table", pos)
        if appendix_pos != -1 and appendix_pos < end_pos:
            end_pos = appendix_pos

        section_text = content[pos:end_pos]
        full_section = f"{rec_id} {rec_title} ({assessment_status})\n" + section_text

        profile = extract_field("Profile Applicability", full_section)
        profile = clean_field(profile, "Profile Applicability")
        profile_arr = [
            p.strip().lstrip("- ").strip()
            for p in profile.split("\n")
            if p.strip()
        ]

        description = clean_field(extract_field("Description", full_section), "Description")
        rationale = clean_field(extract_field("Rationale", full_section), "Rationale")
        impact = clean_field(extract_field("Impact", full_section), "Impact")
        audit = clean_field(extract_field("Audit", full_section), "Audit")
        remediation = clean_field(extract_field("Remediation", full_section), "Remediation")
        default_value = clean_field(extract_field("Default Value", full_section), "Default Value")
        references = clean_field(extract_field("References", full_section), "References")
        additional_info = clean_field(extract_field("Additional Information", full_section), "Additional Information")

        sec_num = int(rec_id.split(".")[0])
        sub_key = ".".join(rec_id.split(".")[:2])
        sec_name = section_names.get(sec_num) or SECTION_NAMES_FALLBACK.get(sec_num) or f"Section {sec_num}"
        sub_name = subsection_names.get(sub_key) or ""

        recommendations.append(ParsedRecommendation(
            id=rec_id,
            title=rec_title,
            section=sec_num,
            section_name=sec_name,
            subsection=sub_name,
            profile=profile_arr,
            description=description,
            rationale=rationale,
            impact=impact,
            audit=audit,
            remediation=remediation,
            default_value=default_value,
            references=references,
            additional_info=additional_info,
            assessment_status=assessment_status,
        ))

    # Sort by ID
    def sort_key(r: ParsedRecommendation) -> tuple:
        parts = [int(p) for p in r.id.split(".")]
        return tuple(parts)
    recommendations.sort(key=sort_key)

    # Dedupe
    seen: set[str] = set()
    deduped: list[ParsedRecommendation] = []
    for r in recommendations:
        if r.id in seen:
            continue
        seen.add(r.id)
        deduped.append(r)

    # Build sections summary
    section_counts: dict[int, int] = {}
    section_name_map: dict[int, str] = {}
    for r in deduped:
        section_counts[r.section] = section_counts.get(r.section, 0) + 1
        section_name_map[r.section] = r.section_name
    sections = [
        {"section": s, "section_name": section_name_map[s], "recommendation_count": c}
        for s, c in sorted(section_counts.items())
    ]

    if not deduped:
        warnings.append("No recommendations found. The PDF may not follow the standard CIS Benchmark format.")
    elif len(deduped) < 10:
        warnings.append(f"Only {len(deduped)} recommendations parsed (typically 50+). Verify the PDF is a valid CIS Benchmark.")

    return ParsedBenchmark(
        title=title,
        version=version,
        date=date,
        file_name=file_name,
        benchmark_type=benchmark_type,
        recommendation_count=len(deduped),
        recommendations=deduped,
        sections=sections,
        warnings=warnings,
    )


def extract_pdf_text(pdf_path: Path) -> str:
    """Extract text from a PDF using the system `pdftotext` binary.

    Raises FileNotFoundError if pdftotext isn't installed.
    Raises RuntimeError if pdftotext produces empty output.
    """
    try:
        result = subprocess.run(
            ["pdftotext", "-layout", str(pdf_path), "-"],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if result.returncode != 0:
            # Try without -layout
            result = subprocess.run(
                ["pdftotext", str(pdf_path), "-"],
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )
        text = result.stdout
        if not text or len(text) < 100:
            raise RuntimeError(
                "pdftotext produced empty output. The PDF may be a scanned image. "
                "Install OCR tools (e.g. ocrmypdf) to process it."
            )
        return text
    except FileNotFoundError:
        raise FileNotFoundError(
            "pdftotext binary not found. Install poppler-utils: "
            "macOS: `brew install poppler`, Ubuntu: `sudo apt install poppler-utils`, "
            "Fedora: `sudo dnf install poppler-utils`."
        )


def parse_pdf_file(pdf_path: Path) -> ParsedBenchmark:
    """Parse a PDF file: extract text via pdftotext, then run the parser."""
    text = extract_pdf_text(pdf_path)
    return parse_cis_benchmark(text, pdf_path.name)


def to_dict(benchmark: ParsedBenchmark) -> dict:
    """Serialize to a JSON-serializable dict."""
    return {
        "title": benchmark.title,
        "version": benchmark.version,
        "date": benchmark.date,
        "fileName": benchmark.file_name,
        "benchmarkType": benchmark.benchmark_type,
        "recommendationCount": benchmark.recommendation_count,
        "recommendations": [asdict(r) for r in benchmark.recommendations],
        "sections": benchmark.sections,
        "warnings": benchmark.warnings,
    }


# CLI when run directly ----------------------------------------------------

if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser(
        description="Parse a CIS Benchmark PDF and emit JSON.",
        epilog="Example: python cis_parser.py input.pdf -o parsed.json",
    )
    p.add_argument("pdf", help="Path to the CIS Benchmark PDF file")
    p.add_argument("-o", "--output", default="-", help="Output file (default: stdout)")
    p.add_argument("--pretty", action="store_true", help="Pretty-print JSON")
    args = p.parse_args()

    try:
        benchmark = parse_pdf_file(Path(args.pdf))
    except (FileNotFoundError, RuntimeError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    data = to_dict(benchmark)
    json_str = json.dumps(data, indent=2 if args.pretty else None, ensure_ascii=False)

    if args.output == "-":
        print(json_str)
    else:
        Path(args.output).write_text(json_str, encoding="utf-8")
        print(f"Wrote {args.output} ({len(json_str)} bytes)", file=sys.stderr)
        print(f"  Title: {benchmark.title} {benchmark.version}", file=sys.stderr)
        print(f"  Recommendations: {benchmark.recommendation_count}", file=sys.stderr)
        print(f"  Sections: {len(benchmark.sections)}", file=sys.stderr)
        if benchmark.warnings:
            print(f"  Warnings: {len(benchmark.warnings)}", file=sys.stderr)
            for w in benchmark.warnings:
                print(f"    - {w}", file=sys.stderr)
