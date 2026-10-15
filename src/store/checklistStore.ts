/**
 * Checklist store — manages the currently-loaded benchmark, per-check
 * statuses, notes, evaluator outputs, and filter state.
 *
 * State is persisted to localStorage so a user can refresh the page
 * without losing their work.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ParsedBenchmark } from '@/lib/cisParser';
import { SAMPLE_PROFILES } from '@/data/sampleNginx';
import { EVALUATOR_REGISTRY, runEvaluatorForBenchmark, type AuditContext, type CheckResult } from '@/lib/evaluators';

export type CheckStatus = 'pass' | 'fail' | 'manual' | 'na' | 'pending';

export interface CheckStatusEntry {
  status: CheckStatus;
  evaluatorMessage?: string;
  evaluatorEvidence?: string;
  evaluatorHints?: string[];
  notes?: string;
  updatedAt?: string;
}

interface ChecklistState {
  /** The currently-loaded parsed benchmark. Null = no benchmark loaded. */
  benchmark: ParsedBenchmark | null;
  /** Status of each check id -> entry */
  statuses: Record<string, CheckStatusEntry>;
  /** Currently selected sample profile id (only for nginx benchmark). */
  activeProfileId: string | null;
  /** User-pasted custom nginx -T output. */
  customNginxT: string;
  /** User-pasted custom nginx -V output. */
  customNginxV: string;
  /** Per-check UI expansion state. */
  expandedCheckIds: Record<string, boolean>;
  /** Section filter (0 = all). */
  sectionFilter: number;
  /** Status filter. */
  statusFilter: CheckStatus | 'all';
  /** Search query. */
  searchQuery: string;
  /** Whether the upload is currently in progress. */
  uploadInProgress: boolean;
  /** Upload error message. */
  uploadError: string | null;

  // Actions
  setBenchmark: (b: ParsedBenchmark | null) => void;
  setStatus: (id: string, status: CheckStatus, notes?: string) => void;
  updateNotes: (id: string, notes: string) => void;
  setExpanded: (id: string, expanded: boolean) => void;
  setSectionFilter: (section: number) => void;
  setStatusFilter: (status: CheckStatus | 'all') => void;
  setSearchQuery: (q: string) => void;
  setActiveProfile: (id: string | null) => void;
  setCustomNginx: (nginxT: string, nginxV: string) => void;
  runAllEvaluators: () => void;
  runEvaluatorFor: (id: string) => void;
  resetAll: () => void;
  setUploadInProgress: (b: boolean) => void;
  setUploadError: (s: string | null) => void;
}

function getActiveContext(state: ChecklistState): AuditContext | null {
  let nginxT = state.customNginxT;
  let nginxV = state.customNginxV;
  if (state.activeProfileId) {
    const profile = SAMPLE_PROFILES.find((p) => p.id === state.activeProfileId);
    if (profile) {
      nginxT = profile.nginxT;
      nginxV = profile.nginxV;
    }
  }
  if (!nginxT && !nginxV) return null;
  return { nginxT, nginxV };
}

function applyResult(result: CheckResult | null): Partial<CheckStatusEntry> {
  if (!result) {
    return {
      status: 'manual' as CheckStatus,
      evaluatorMessage: 'Manual review required — this check cannot be auto-evaluated from the configuration text.',
      updatedAt: new Date().toISOString(),
    };
  }
  return {
    status: result.status,
    evaluatorMessage: result.message,
    evaluatorEvidence: result.evidence,
    evaluatorHints: result.hints,
    updatedAt: new Date().toISOString(),
  };
}

export const useChecklistStore = create<ChecklistState>()(
  persist(
    (set, get) => ({
      benchmark: null,
      statuses: {},
      activeProfileId: 'noncompliant',
      customNginxT: '',
      customNginxV: '',
      expandedCheckIds: {},
      sectionFilter: 0,
      statusFilter: 'all',
      searchQuery: '',
      uploadInProgress: false,
      uploadError: null,

      setBenchmark: (b) =>
        set((s) => ({
          benchmark: b,
          // Reset statuses and filters when a new benchmark is loaded
          statuses: {},
          expandedCheckIds: {},
          sectionFilter: 0,
          statusFilter: 'all',
          searchQuery: '',
          // Only pre-select the sample profile if this is the nginx benchmark
          activeProfileId: b?.benchmarkType === 'nginx' ? 'noncompliant' : null,
          customNginxT: b?.benchmarkType === 'nginx' ? s.customNginxT : '',
          customNginxV: b?.benchmarkType === 'nginx' ? s.customNginxV : '',
          uploadError: null,
        })),

      setStatus: (id, status, notes) =>
        set((s) => ({
          statuses: {
            ...s.statuses,
            [id]: {
              ...s.statuses[id],
              status,
              ...(notes !== undefined ? { notes } : {}),
              updatedAt: new Date().toISOString(),
            },
          },
        })),

      updateNotes: (id, notes) =>
        set((s) => ({
          statuses: {
            ...s.statuses,
            [id]: {
              ...s.statuses[id],
              status: s.statuses[id]?.status ?? 'pending',
              notes,
              updatedAt: new Date().toISOString(),
            },
          },
        })),

      setExpanded: (id, expanded) =>
        set((s) => ({
          expandedCheckIds: {
            ...s.expandedCheckIds,
            [id]: expanded,
          },
        })),

      setSectionFilter: (section) => set({ sectionFilter: section }),
      setStatusFilter: (status) => set({ statusFilter: status }),
      setSearchQuery: (q) => set({ searchQuery: q }),
      setActiveProfile: (id) => set({ activeProfileId: id }),
      setCustomNginx: (nginxT, nginxV) =>
        set({ customNginxT: nginxT, customNginxV: nginxV, activeProfileId: null }),
      setUploadInProgress: (b) => set({ uploadInProgress: b }),
      setUploadError: (s) => set({ uploadError: s }),

      runEvaluatorFor: (id) => {
        const state = get();
        if (!state.benchmark) return;
        const ctx = getActiveContext(state);
        if (!ctx) return;
        const result = runEvaluatorForBenchmark(state.benchmark.benchmarkType, id, ctx);
        set((s) => ({
          statuses: {
            ...s.statuses,
            [id]: {
              ...s.statuses[id],
              ...applyResult(result),
            } as CheckStatusEntry,
          },
        }));
      },

      runAllEvaluators: () => {
        const state = get();
        if (!state.benchmark) return;
        const ctx = getActiveContext(state);
        if (!ctx) return;
        const evaluators = EVALUATOR_REGISTRY[state.benchmark.benchmarkType];
        if (!evaluators) return;
        const newStatuses: Record<string, CheckStatusEntry> = { ...state.statuses };
        for (const rec of state.benchmark.recommendations) {
          if (!evaluators[rec.id]) continue;
          const result = runEvaluatorForBenchmark(state.benchmark.benchmarkType, rec.id, ctx);
          newStatuses[rec.id] = {
            ...newStatuses[rec.id],
            ...applyResult(result),
          } as CheckStatusEntry;
        }
        set({ statuses: newStatuses });
      },

      resetAll: () =>
        set({
          statuses: {},
          expandedCheckIds: {},
        }),
    }),
    {
      name: 'cis-benchmark-checklist',
      partialize: (s) => ({
        benchmark: s.benchmark,
        statuses: s.statuses,
        activeProfileId: s.activeProfileId,
        customNginxT: s.customNginxT,
        customNginxV: s.customNginxV,
      }),
    },
  ),
);

// Selector helpers ----------------------------------------------------------

export interface SectionStat {
  section: number;
  sectionName: string;
  total: number;
  pass: number;
  fail: number;
  manual: number;
  pending: number;
  na: number;
}

export function computeSectionStats(
  benchmark: ParsedBenchmark | null,
  statuses: Record<string, CheckStatusEntry>,
): SectionStat[] {
  if (!benchmark) return [];
  const map = new Map<number, SectionStat>();
  for (const rec of benchmark.recommendations) {
    if (!map.has(rec.section)) {
      map.set(rec.section, {
        section: rec.section,
        sectionName: rec.sectionName,
        total: 0, pass: 0, fail: 0, manual: 0, pending: 0, na: 0,
      });
    }
    const s = map.get(rec.section)!;
    s.total++;
    const status = statuses[rec.id]?.status ?? 'pending';
    if (status === 'pass') s.pass++;
    else if (status === 'fail') s.fail++;
    else if (status === 'manual') s.manual++;
    else if (status === 'na') s.na++;
    else s.pending++;
  }
  return Array.from(map.values()).sort((a, b) => a.section - b.section);
}

export function computeOverallStats(
  benchmark: ParsedBenchmark | null,
  statuses: Record<string, CheckStatusEntry>,
) {
  if (!benchmark) {
    return { pass: 0, fail: 0, manual: 0, pending: 0, na: 0, total: 0, complianceScore: 0 };
  }
  let pass = 0, fail = 0, manual = 0, pending = 0, na = 0;
  const total = benchmark.recommendations.length;
  for (const rec of benchmark.recommendations) {
    const status = statuses[rec.id]?.status ?? 'pending';
    if (status === 'pass') pass++;
    else if (status === 'fail') fail++;
    else if (status === 'manual') manual++;
    else if (status === 'na') na++;
    else pending++;
  }
  const denom = pass + fail;
  const complianceScore = denom === 0 ? 0 : Math.round((pass / denom) * 100);
  return { pass, fail, manual, pending, na, total, complianceScore };
}

export function filterChecks(
  benchmark: ParsedBenchmark | null,
  statuses: Record<string, CheckStatusEntry>,
  sectionFilter: number,
  statusFilter: CheckStatus | 'all',
  searchQuery: string,
) {
  if (!benchmark) return [];
  const q = searchQuery.trim().toLowerCase();
  return benchmark.recommendations.filter((c) => {
    if (sectionFilter !== 0 && c.section !== sectionFilter) return false;
    const status = statuses[c.id]?.status ?? 'pending';
    if (statusFilter !== 'all' && status !== statusFilter) return false;
    if (q) {
      const haystack = `${c.id} ${c.title} ${c.description} ${c.audit} ${c.remediation}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}
