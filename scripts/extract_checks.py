#!/usr/bin/env python3
"""Extract CIS NGINX Benchmark recommendations from the PDF text.

Strategy: find each "Profile Applicability:" marker (which only appears in body
recommendations, not TOC). Then walk backward to find the recommendation header
which starts with an ID like X.Y or X.Y.Z.
"""
import re
import json

PDF_TEXT = "/home/z/my-project/upload/cis_nginx.txt"
OUTPUT_JSON = "/home/z/my-project/scripts/cis_checks.json"

with open(PDF_TEXT, "r", encoding="utf-8", errors="replace") as f:
    raw = f.read()

# Replace form-feed with newline to make line-based logic consistent
content = raw.replace("\x0c", "\n")

# Find all "Profile Applicability:" positions
prof_positions = [m.start() for m in re.finditer(r"(?m)^Profile Applicability:", content)]
print(f"Found {len(prof_positions)} 'Profile Applicability:' markers")

recs = []
for pos in prof_positions:
    # Walk backward from pos to find the header line: starts with X.Y[.Z] and ends with "(Manual)"
    # The header may span multiple lines due to PDF wrapping.
    # Look back up to 500 chars.
    back_text = content[max(0, pos-500):pos]
    # Find the last line that starts with a digit ID
    # Strategy: find the last index where a line starts with a digit pattern
    lines = back_text.split("\n")
    # Iterate from end, find first line that starts with digit.id
    header_lines = []
    found_header = False
    for line in reversed(lines):
        if re.match(r"^\d+\.\d+(?:\.\d+)?\s+", line):
            header_lines.insert(0, line)
            found_header = True
            break
        elif not line.strip() or line.strip().startswith("Page"):
            # Skip page footer
            if header_lines:
                break
            else:
                continue
        else:
            # Continuation of header (previous lines of multi-line title)
            if found_header:
                break
            header_lines.insert(0, line)
            if len(header_lines) > 5:
                break
    if not found_header:
        print(f"WARNING: Could not find header for Profile Applicability at pos {pos}")
        continue
    header_text = " ".join(l.strip() for l in header_lines)
    # Extract ID and title
    m = re.match(r"(\d+\.\d+(?:\.\d+)?)\s+(.+?)\s*\(Manual\)\s*$", header_text)
    if not m:
        print(f"WARNING: Header doesn't match expected pattern: {header_text!r}")
        continue
    rec_id = m.group(1)
    title = m.group(2).strip()
    # Collapse multi-space
    title = re.sub(r"\s+", " ", title)
    
    # Find the end: next "Profile Applicability:" or "Appendix: Summary Table"
    end = len(content)
    next_prof_idx = None
    for p in prof_positions:
        if p > pos:
            next_prof_idx = p
            break
    if next_prof_idx:
        # Header starts before next profile; find the header line start
        # We want to end at the start of the next recommendation header.
        # Walk backward from next_prof_idx to find the next header line.
        next_back = content[max(0, next_prof_idx-500):next_prof_idx]
        next_lines = next_back.split("\n")
        header_start_offset = None
        for line in reversed(next_lines):
            if re.match(r"^\d+\.\d+(?:\.\d+)?\s+", line):
                # Find this line's start position in content
                header_start_offset = next_prof_idx - 500 + next_back.rfind("\n" + line) - 1
                # Actually easier: find the line index
                idx_in_back = next_back.rfind(line)
                if idx_in_back != -1:
                    header_start_offset = max(0, next_prof_idx - 500) + idx_in_back
                    break
        if header_start_offset is not None and header_start_offset > pos:
            end = header_start_offset
    appendix_pos = content.find("Appendix: Summary Table", pos)
    if appendix_pos != -1 and appendix_pos < end:
        end = appendix_pos
    
    section = content[pos:end]
    # Prepend header + Profile Applicability line to make field extraction easier
    full_section = f"{rec_id} {title} (Manual)\n" + section
    
    # All known top-level field names that can appear as section markers
    FIELD_NAMES = [
        "Profile Applicability",
        "Description",
        "Rationale",
        "Impact",
        "Audit",
        "Remediation",
        "Default Value",
        "References",
        "Additional Information",
        "CIS Controls",
    ]
    # Build a regex alternation of all field names, anchored at line start
    boundary_pattern = "|".join(rf"^{re.escape(n)}:" for n in FIELD_NAMES)
    
    def extract_field(name, text):
        # Match "Name:" possibly with content on same or next line, up to next known field header
        pat = rf"(?ms)^{re.escape(name)}:\s*\n?(.*?)(?={boundary_pattern}|\Z)"
        match = re.search(pat, text)
        if not match:
            return ""
        result = match.group(1).strip()
        result = result.replace("\u2022", "-")
        return result
    
    # For Profile Applicability, only grab up to next blank-or-Description marker
    profile_match = re.search(r"(?ms)^Profile Applicability:\s*\n?(.*?)(?=^Description:|\Z)", full_section)
    profile = profile_match.group(1).strip() if profile_match else ""
    profile = profile.replace("\u2022", "-")
    # Cut at "Description:" if present
    if "Description:" in profile:
        profile = profile[:profile.find("Description:")].strip()
    
    description = extract_field("Description", full_section)
    rationale = extract_field("Rationale", full_section)
    impact = extract_field("Impact", full_section)
    audit = extract_field("Audit", full_section)
    remediation = extract_field("Remediation", full_section)
    default_value = extract_field("Default Value", full_section)
    references = extract_field("References", full_section)
    additional_info = extract_field("Additional Information", full_section)
    
    # Clean up: cut fields at section markers they shouldn't contain
    def cut_at(val, markers):
        for marker in markers:
            idx = val.find(marker)
            if idx != -1:
                val = val[:idx].strip()
        return val
    
    # Each field shouldn't contain the others' headers
    all_headers = [
        "Profile Applicability:", "Description:", "Rationale:", "Impact:",
        "Audit:", "Remediation:", "Default Value:", "References:",
        "Additional Information:", "CIS Controls:",
    ]
    
    def clean_field(val, own_header):
        others = [h for h in all_headers if h != own_header]
        return cut_at(val, others)
    
    profile = clean_field(profile, "Profile Applicability:")
    description = clean_field(description, "Description:")
    rationale = clean_field(rationale, "Rationale:")
    impact = clean_field(impact, "Impact:")
    audit = clean_field(audit, "Audit:")
    remediation = clean_field(remediation, "Remediation:")
    default_value = clean_field(default_value, "Default Value:")
    references = clean_field(references, "References:")
    additional_info = clean_field(additional_info, "Additional Information:")
    
    rec = {
        "id": rec_id,
        "title": title,
        "profile": profile,
        "description": description,
        "rationale": rationale,
        "impact": impact,
        "audit": audit,
        "remediation": remediation,
        "default_value": default_value,
        "references": references,
        "additional_info": additional_info,
    }
    recs.append(rec)

# Sort by rec_id
def sort_key(r):
    parts = r["id"].split(".")
    return tuple(int(p) for p in parts)

recs.sort(key=sort_key)

# Dedupe by id (keep the first occurrence which is the body)
seen = set()
deduped = []
for r in recs:
    if r["id"] in seen:
        continue
    seen.add(r["id"])
    deduped.append(r)

print(f"\nExtracted {len(deduped)} unique recommendations:")
for r in deduped:
    print(f"  {r['id']:10s} | audit_len={len(r['audit']):4d} | remed_len={len(r['remediation']):4d} | desc_len={len(r['description']):4d} | {r['title'][:50]}")

with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
    json.dump(deduped, f, indent=2, ensure_ascii=False)
print(f"\nSaved to {OUTPUT_JSON}")
