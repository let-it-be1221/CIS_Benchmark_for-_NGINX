/**
 * Generic CIS Benchmark PDF parser — TypeScript port of scripts/extract_checks.py.
 *
 * Strategy: find each "Profile Applicability:" marker (which only appears in
 * body recommendations, not TOC/summary). Then walk backward to find the
 * recommendation header which starts with an ID like X.Y or X.Y.Z and ends
 * with "(Manual)" or "(Automated)".
 *
 * Works for any CIS Benchmark PDF that follows the standard format:
 *   - CIS NGINX Benchmark
 *   - CIS Apache Benchmark
 *   - CIS Microsoft Windows Server Benchmark
 *   - CIS Red Hat Enterprise Linux Benchmark
 *   - etc.
 */

export interface ParsedRecommendation {
  id: string;            // "1.1.1" or "3.2"
  title: string;
  section: number;       // 1, 2, 3, ...
  sectionName: string;   // "Initial Setup"
  subsection: string;    // "Installation"
  profile: string[];     // ["Level 1 - Webserver", ...]
  description: string;
  rationale: string;
  impact: string;
  audit: string;
  remediation: string;
  defaultValue: string;
  references: string;
  additionalInfo: string;
  assessmentStatus: 'Manual' | 'Automated' | 'Unknown';
}

export interface ParsedBenchmark {
  title: string;          // "CIS NGINX Benchmark"
  version: string;       // "v3.0.0"
  date: string;          // "12-24-2025"
  fileName: string;      // "CIS_NGINX_Benchmark_v3.0.0.pdf"
  /** Detected benchmark type — used to look up auto-evaluators and sample configs. */
  benchmarkType: string; // 'nginx' | 'apache' | 'windows' | 'linux' | 'unknown'
  recommendationCount: number;
  recommendations: ParsedRecommendation[];
  /** Sections discovered while parsing — useful for sidebar display. */
  sections: { section: number; sectionName: string; recommendationCount: number }[];
  /** Any warnings encountered during parsing. */
  warnings: string[];
}

const SECTION_NAMES_FALLBACK: Record<number, string> = {
  1: 'Initial Setup',
  2: 'Basic Configuration',
  3: 'Logging',
  4: 'Encryption',
  5: 'Request Filtering & Restrictions',
  6: 'Mandatory Access Control',
  7: 'Access Control',
  8: 'Audit Logging',
  9: 'Maintenance',
};

/**
 * Extract the benchmark title, version, and date from the first few lines
 * of the PDF text.
 *
 * Example: "CIS NGINX Benchmark\nv3.0.0 - 12-24-2025"
 */
function extractMetadata(text: string): { title: string; version: string; date: string } {
  // Look at first ~500 chars for "CIS XYZ Benchmark" pattern
  const head = text.slice(0, 800);
  const titleMatch = head.match(/CIS\s+([A-Z][A-Za-z0-9 _.\-]+?)\s+Benchmark/);
  const title = titleMatch ? `CIS ${titleMatch[1].trim()} Benchmark` : 'CIS Benchmark';

  // Version: "v3.0.0" or "Version 3.0.0"
  const versionMatch = head.match(/(?:Version\s+|v)(\d+\.\d+(?:\.\d+)?)/i);
  const version = versionMatch ? `v${versionMatch[1]}` : 'unknown version';

  // Date: "12-24-2025" or "2025-12-24"
  const dateMatch = head.match(/(\d{1,2}-\d{1,2}-\d{4}|\d{4}-\d{1,2}-\d{1,2})/);
  const date = dateMatch ? dateMatch[1] : '';

  return { title, version, date };
}

/**
 * Detect the benchmark type from the title. Used to look up the
 * benchmark-specific evaluator registry and sample configs.
 */
function detectBenchmarkType(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes('nginx')) return 'nginx';
  if (lower.includes('apache') || lower.includes('httpd')) return 'apache';
  if (lower.includes('microsoft') && lower.includes('windows')) return 'windows';
  if (lower.includes('microsoft') && lower.includes('iis')) return 'iis';
  if (lower.includes('red hat') || lower.includes('rhel') || lower.includes('ubuntu') || lower.includes('debian') || lower.includes('linux')) return 'linux';
  if (lower.includes('kubernetes')) return 'kubernetes';
  if (lower.includes('docker')) return 'docker';
  if (lower.includes('aws')) return 'aws';
  if (lower.includes('azure')) return 'azure';
  if (lower.includes('gcp') || lower.includes('google cloud')) return 'gcp';
  if (lower.includes('postgresql')) return 'postgresql';
  if (lower.includes('mysql')) return 'mysql';
  if (lower.includes('mongodb')) return 'mongodb';
  if (lower.includes('redis')) return 'redis';
  if (lower.includes('elasticsearch')) return 'elasticsearch';
  if (lower.includes('vmware') || lower.includes('vsphere')) return 'vmware';
  return 'unknown';
}

/**
 * Extract section names from the TOC. The TOC has lines like:
 *   "1 Initial Setup ............ 16"
 *   "2 Basic Configuration ...... 26"
 *
 * If TOC extraction fails, fall back to SECTION_NAMES_FALLBACK.
 */
function extractSectionNames(text: string): Map<number, string> {
  const map = new Map<number, string>();
  // Pattern: at start of line, "N SomeName" followed by dots+page number
  const pattern = new RegExp('^(\\d+)\\s+([A-Z][A-Za-z0-9 _/\\-&]+?)\\s*\\.{3,}\\s*\\d+\\s*$', 'm');
  // Also accept without dots: "1 Initial Setup"
  const patternNoDots = new RegExp('^(\\d+)\\s+([A-Z][A-Za-z0-9 _/\\-&]+?)\\s*$', 'm');

  // Find TOC region — usually between "Table of Contents" and "Overview" or first "Recommendations"
  const tocStart = text.search(new RegExp('^Table of Contents\\s*$', 'm'));
  const tocEnd = text.search(new RegExp('^(Overview|Recommendations|Introduction)\\s*$', 'm'));
  if (tocStart === -1) {
    return map;
  }
  const tocRegion = text.slice(tocStart, tocEnd === -1 ? tocStart + 5000 : tocEnd);

  let m: RegExpExecArray | null;
  const re = new RegExp(pattern.source, 'gm');
  while ((m = re.exec(tocRegion)) !== null) {
    const num = parseInt(m[1], 10);
    const name = m[2].trim();
    if (num >= 1 && num <= 20 && name.length > 2 && name.length < 80) {
      map.set(num, name);
    }
  }
  return map;
}

/**
 * Extract recommendation subsection names from the TOC.
 * Pattern: "1.1 Installation ........... 17"
 */
function extractSubsectionNames(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const pattern = new RegExp('^(\\d+\\.\\d+)\\s+([A-Z][A-Za-z0-9 _/\\-&]+?)\\s*\\.{3,}\\s*\\d+\\s*$', 'm');
  const tocStart = text.search(new RegExp('^Table of Contents\\s*$', 'm'));
  const tocEnd = text.search(new RegExp('^(Overview|Recommendations|Introduction)\\s*$', 'm'));
  if (tocStart === -1) return map;
  const tocRegion = text.slice(tocStart, tocEnd === -1 ? tocStart + 8000 : tocEnd);

  let m: RegExpExecArray | null;
  const re = new RegExp(pattern.source, 'gm');
  while ((m = re.exec(tocRegion)) !== null) {
    const id = m[1];
    const name = m[2].trim();
    if (name.length > 2 && name.length < 80) {
      map.set(id, name);
    }
  }
  return map;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Main entry: parse raw PDF text into a ParsedBenchmark.
 */
export function parseCisBenchmark(text: string, fileName: string): ParsedBenchmark {
  const warnings: string[] = [];
  const content = text.replace(/\x0c/g, '\n');

  const { title, version, date } = extractMetadata(content);
  const benchmarkType = detectBenchmarkType(title);

  const sectionNames = extractSectionNames(content);
  const subsectionNames = extractSubsectionNames(content);

  // Find all "Profile Applicability:" positions
  const profRe = new RegExp('^Profile Applicability:', 'gm');
  const profPositions: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = profRe.exec(content)) !== null) {
    profPositions.push(m.index);
  }

  const recommendations: ParsedRecommendation[] = [];

  for (const pos of profPositions) {
    // Walk backward to find the header. It looks like:
    //   "1.1.1 Ensure XYZ (Manual)" or "3.2 Ensure ABC (Automated)"
    // The header may span multiple lines due to PDF word wrap.
    const back = content.slice(Math.max(0, pos - 500), pos);
    const backLines = back.split('\n');

    const headerLines: string[] = [];
    let foundHeader = false;
    for (const line of backLines.slice().reverse()) {
      if (/^\d+\.\d+(?:\.\d+)?\s+/.test(line)) {
        headerLines.unshift(line);
        foundHeader = true;
        break;
      } else if (!line.trim() || line.trim().startsWith('Page')) {
        if (headerLines.length > 0) break;
        continue;
      } else {
        if (foundHeader) break;
        headerLines.unshift(line);
        if (headerLines.length > 5) break;
      }
    }
    if (!foundHeader) continue;

    const headerText = headerLines.map((l) => l.trim()).join(' ');
    const headerMatch = headerText.match(
      /(\d+\.\d+(?:\.\d+)?)\s+(.+?)\s*\((Manual|Automated)\)\s*$/,
    );
    if (!headerMatch) continue;

    const recId = headerMatch[1];
    const recTitle = headerMatch[2].replace(/\s+/g, ' ').trim();
    const assessmentStatus = headerMatch[3] as 'Manual' | 'Automated';

    // Find the end: position of next "Profile Applicability:" or appendix
    const nextPosIdx = profPositions.findIndex((p) => p > pos);
    const nextPos = nextPosIdx !== -1 ? profPositions[nextPosIdx] : content.length;

    // Walk back from nextPos to find next header start
    let endPos = nextPos;
    if (nextPosIdx !== -1) {
      const back2 = content.slice(Math.max(0, nextPos - 500), nextPos);
      const backLines2 = back2.split('\n');
      for (const line of backLines2.slice().reverse()) {
        if (/^\d+\.\d+(?:\.\d+)?\s+/.test(line)) {
          const idx = back2.lastIndexOf(line);
          if (idx !== -1) {
            endPos = Math.max(0, nextPos - 500) + idx;
            break;
          }
        }
      }
    }
    const appendixPos = content.indexOf('Appendix: Summary Table', pos);
    if (appendixPos !== -1 && appendixPos < endPos) {
      endPos = appendixPos;
    }

    const section = content.slice(pos, endPos);
    const fullSection = `${recId} ${recTitle} (${assessmentStatus})\n` + section;

    const FIELD_NAMES = [
      'Profile Applicability', 'Description', 'Rationale', 'Impact',
      'Audit', 'Remediation', 'Default Value', 'References',
      'Additional Information', 'CIS Controls',
    ];
    const boundaryPattern = FIELD_NAMES.map((n) => `^${escapeRegex(n)}:`).join('|');

    function extractField(name: string): string {
      const re = new RegExp(
        `^(?:${escapeRegex(name)}):\\s*\\n?([\\s\\S]*?)(?=${boundaryPattern}|\\Z)`,
        'm',
      );
      const m = re.exec(fullSection);
      if (!m) return '';
      return m[1].replace(/\u2022/g, '-').trim();
    }

    function cleanField(val: string, ownHeader: string): string {
      let result = val;
      for (const h of FIELD_NAMES) {
        if (h === ownHeader) continue;
        const idx = result.indexOf(h + ':');
        if (idx !== -1) {
          result = result.slice(0, idx).trim();
        }
      }
      return result;
    }

    let profile = extractField('Profile Applicability');
    profile = cleanField(profile, 'Profile Applicability');
    const profileArr = profile
      .split('\n')
      .map((s) => s.trim().replace(/^-\s*/, '').trim())
      .filter((s) => s.length > 0);

    let description = extractField('Description');
    description = cleanField(description, 'Description');
    let rationale = extractField('Rationale');
    rationale = cleanField(rationale, 'Rationale');
    let impact = extractField('Impact');
    impact = cleanField(impact, 'Impact');
    let audit = extractField('Audit');
    audit = cleanField(audit, 'Audit');
    let remediation = extractField('Remediation');
    remediation = cleanField(remediation, 'Remediation');
    let defaultValue = extractField('Default Value');
    defaultValue = cleanField(defaultValue, 'Default Value');
    let references = extractField('References');
    references = cleanField(references, 'References');
    let additionalInfo = extractField('Additional Information');
    additionalInfo = cleanField(additionalInfo, 'Additional Information');

    const sec = parseInt(recId.split('.')[0], 10);
    const subKey = recId.split('.').slice(0, 2).join('.');
    const secName = sectionNames.get(sec) ?? SECTION_NAMES_FALLBACK[sec] ?? `Section ${sec}`;
    const subName = subsectionNames.get(subKey) ?? '';

    recommendations.push({
      id: recId,
      title: recTitle,
      section: sec,
      sectionName: secName,
      subsection: subName,
      profile: profileArr,
      description,
      rationale,
      impact,
      audit,
      remediation,
      defaultValue,
      references,
      additionalInfo,
      assessmentStatus,
    });
  }

  // Sort by ID
  recommendations.sort((a, b) => {
    const pa = a.id.split('.').map(Number);
    const pb = b.id.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const av = pa[i] ?? 0;
      const bv = pb[i] ?? 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  });

  // Dedupe by ID (keep first)
  const seen = new Set<string>();
  const deduped: ParsedRecommendation[] = [];
  for (const r of recommendations) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    deduped.push(r);
  }

  // Build sections summary
  const sectionCountMap = new Map<number, number>();
  const sectionNameMap = new Map<number, string>();
  for (const r of deduped) {
    sectionCountMap.set(r.section, (sectionCountMap.get(r.section) ?? 0) + 1);
    sectionNameMap.set(r.section, r.sectionName);
  }
  const sections = Array.from(sectionCountMap.entries())
    .map(([section, recommendationCount]) => ({
      section,
      sectionName: sectionNameMap.get(section) ?? `Section ${section}`,
      recommendationCount,
    }))
    .sort((a, b) => a.section - b.section);

  if (deduped.length === 0) {
    warnings.push('No recommendations found. The PDF may not follow the standard CIS Benchmark format.');
  }
  if (deduped.length > 0 && deduped.length < 10) {
    warnings.push(`Only ${deduped.length} recommendations were parsed (typically CIS Benchmarks have 50+). Verify the PDF is a valid CIS Benchmark.`);
  }

  return {
    title,
    version,
    date,
    fileName,
    benchmarkType,
    recommendationCount: deduped.length,
    recommendations: deduped,
    sections,
    warnings,
  };
}
