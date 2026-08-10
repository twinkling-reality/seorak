import type { DeveloperModelSnapshot } from '@seorak/types';

import { getToolMeta } from '../../../lib/toolMeta.js';
import type { ModelInsight } from '../modelPresentationTypes.js';
import { boundary, count, otherThings, rateOf, remainderText, runnersUp } from './evidence.js';
import { pct as pctText } from './format.js';
import { bestConcentration, isMajority, listPhrase } from './format.js';
import type { PortraitProducer, PortraitSentence } from './types.js';

/** Below this the work-type mix is one or two branches, not a habit. */
export const WORK_TYPE_MIN_SESSIONS = 3;
/** And the leading type has to actually lead, not tie. */
export const WORK_TYPE_SHARE = 0.4;
/** A tool has to have been reached for repeatedly before it says anything about
 *  how someone works. */
const TOOL_MIN_CALLS = 20;
/** How many tools the sentence will name. Past two it is a list, not a habit. */
const TOOL_NAMED = 2;

/**
 * Every phrase here has to read after "You were mostly ", which is the segment
 * this map feeds — so every value is a gerund phrase. `chore` was the noun
 * "upkeep" ("You were mostly upkeep") and is now "doing upkeep".
 *
 * `other` has no entry at all, deliberately: see `leadingWorkType` below.
 */
export const WORK_TYPE_COPY: Record<string, string> = {
  feature: 'building new things',
  fix: 'fixing what was broken',
  refactor: 'reshaping code that already worked',
  chore: 'doing upkeep',
  other: 'work your branch names did not spell out',
};

/**
 * The leading work type, ONCE, for every sentence that speaks about one.
 *
 * Shared rather than re-derived because the craft sentence and the craft-shift
 * sentence sit next to each other in the read and had different gates: craft
 * required three classified sessions and a 40% lead and even downgraded "mostly"
 * to "leaned toward" for a plurality, while the shift sentence was a bare argmax
 * over anything above zero. So the read hedged the present and overclaimed the
 * past in consecutive sentences — "You were mostly fixing what was broken. The
 * month before, you were mostly building new things." where the second "mostly"
 * was one branch name. Two gates that must agree are one function.
 *
 * `other` is never the spoken lead. The collector returns it for a null branch, a
 * trunk branch (main/master/develop) and any unrecognised prefix, so a developer
 * committing on `main` — the default for this product's own buyer — makes it the
 * dominant type, and "You were mostly work your branch names did not spell out"
 * is not a sentence about a person. It stays on the card as a runner-up, where it
 * is a fact about the branch names rather than a claim about the reader.
 */
export function leadingWorkType(
  mix: Array<{ workType: string; sessions: number }> | undefined,
): { workType: string; sessions: number; total: number; share: number } | null {
  const ranked = [...(mix ?? [])].filter((w) => w.sessions > 0).sort((a, b) => b.sessions - a.sessions);
  const top = ranked[0];
  if (!top) return null;
  const total = ranked.reduce((sum, w) => sum + w.sessions, 0);
  if (total < WORK_TYPE_MIN_SESSIONS || top.sessions < total * WORK_TYPE_SHARE) return null;
  if (top.workType === 'other') return null;
  return { workType: top.workType, sessions: top.sessions, total, share: top.sessions / total };
}

/**
 * What a tool means as an ACTIVITY, because the tool names are an implementation
 * detail of the agent and not a fact about the person reading.
 *
 * "The branches were mostly feature work, run through Read and Edit" is the least
 * human line the portrait ever produced: `branches` and `run through Read and
 * Edit` are both tooling vocabulary, and to anyone outside this codebase the
 * second half is not even parseable. The same measurement said as an activity —
 * "you spent more of it reading and editing than anything else" — needs no
 * glossary. The tool names stay, in the card, where the number is.
 *
 * Partial ON PURPOSE, unlike the end-reason map: tool names are an OPEN set that
 * any agent can extend at any time, so there is no union to be exhaustive against
 * and no compile-time check to earn. An unmapped tool falls back to naming the
 * tools plainly rather than inventing a verb for something it has never seen.
 */
const TOOL_ACTIVITY: Record<string, string> = {
  Read: 'reading',
  Edit: 'editing',
  MultiEdit: 'editing',
  Write: 'writing new files',
  Bash: 'running commands',
  Grep: 'searching the code',
  Glob: 'searching the code',
  NotebookEdit: 'editing notebooks',
  WebFetch: 'reading the web',
  WebSearch: 'searching the web',
  Task: 'handing work to a subagent',
};

function workTypeInsight(
  snapshot: DeveloperModelSnapshot,
): ModelInsight | null {
  const mix = snapshot.identity?.branchWorkTypeMix ?? [];
  const lead = leadingWorkType(mix);
  if (!lead) return null;

  // Unknown work types are named as themselves rather than dropped: the collector
  // classifies on-machine and the union can gain a value this map has not learned.
  const phrase = WORK_TYPE_COPY[lead.workType] ?? `${lead.workType} work`;
  const others = [...mix]
    .filter((w) => w.sessions > 0 && w.workType !== lead.workType)
    .sort((a, b) => b.sessions - a.sessions);

  return {
    id: 'work-type',
    facet: 'shape',
    linkedTerm: phrase,
    label: 'What kind of work',
    hoverLines: [
      `${count(lead.sessions)} of ${count(lead.total)} classified sessions ran on a branch named for ${phrase}.`,
    ],
    squircle: {
      // Was "The kind of work your branches say you were doing" — which is the
      // boundary two lines below, said first and without the caveat that makes it
      // worth saying.
      detail: remainderText({
        numerator: lead.sessions,
        denominator: lead.total,
        unit: 'classified sessions',
        rest: `were named for ${otherThings(others.length, 'kind')} of work`,
        whole: 'No branch name this window pointed at any other kind of work.',
      }),
      citations: [
        {
          text: `${rateOf(lead.share, lead.sessions, lead.total, 'classified sessions')} ran on a branch named for ${phrase}`,
          field: 'identity.branchWorkTypeMix',
        },
        ...runnersUp(
          others,
          (w) => WORK_TYPE_COPY[w.workType] ?? w.workType,
          (w) => w.sessions,
          'identity.branchWorkTypeMix',
          'sessions',
        ),
        boundary(
          'Classified on your machine from each session\u2019s branch NAME, never from what the code does',
          'identity.branchWorkTypeMix',
        ),
        // The denominator is "sessions we could classify", not "sessions", and the
        // rhythm card three sentences earlier prints the larger total under the
        // same word. The tool card below already states its equivalent exclusion;
        // this card was the inconsistent one.
        boundary(
          'Sessions whose branch could not be classified are outside this count, so it is a share of classified sessions',
          'identity.branchWorkTypeMix',
        ),
      ],
    },
  };
}

/**
 * `byTool` carries an `other` bucket that is not a tool.
 *
 * It is the aggregate remainder for calls whose tool name the rollup did not
 * keep, and on a real read it is large — thirty thousand calls, the second
 * biggest "tool" in the window. Ranking it alongside the real ones put it in the
 * hero prose as a name: "you spent more of it Bash and Other than anything else",
 * which tells the reader nothing and reads as a bug. It also made the card's own
 * boundary FALSE: the line promises that calls carrying no tool name are outside
 * the count, while `other` was sitting inside the denominator.
 *
 * Dropping it from both the ranking and the total is what makes the sentence and
 * its evidence agree. The demo fixture has no such bucket, which is why only a
 * real window could surface this.
 */
const UNNAMED_TOOL_BUCKET = 'other';

function toolInsight(snapshot: DeveloperModelSnapshot): ModelInsight | null {
  const ranked = [...snapshot.tools.byTool]
    .filter((t) => t.calls > 0 && t.tool !== UNNAMED_TOOL_BUCKET)
    .sort((a, b) => b.calls - a.calls);
  const total = ranked.reduce((sum, t) => sum + t.calls, 0);
  if (total < TOOL_MIN_CALLS || ranked.length === 0) return null;

  const lead = ranked.slice(0, TOOL_NAMED);
  const rest = ranked.slice(TOOL_NAMED);
  const named = lead.map((t) => getToolMeta(t.tool).label);
  const namedCalls = lead.reduce((sum, t) => sum + t.calls, 0);
  const { errorRate, erroredCalls, callsWithResult } = snapshot.tools.callStats;

  // Say the ACTIVITY when every leading tool has one; otherwise name the tools.
  // Mixing the two ("reading and Grep") would be worse than either, and inventing
  // a verb for a tool this map has never seen would be a guess printed as a fact.
  const activities = lead.map((t) => TOOL_ACTIVITY[t.tool]);
  const term = activities.every(Boolean) ? listPhrase(activities) : listPhrase(named);

  return {
    id: 'tool-mix',
    facet: 'shape',
    linkedTerm: term,
    label: 'Where the calls go',
    hoverLines: [
      `${count(namedCalls)} of ${count(total)} named tool calls went through ${listPhrase(named)}.`,
    ],
    squircle: {
      // Was "Where most of a session actually goes", which claims a share of TIME
      // over a card that counts CALLS — a claim of a different kind from its own
      // evidence — and asserted "most" whatever the share was.
      detail: remainderText({
        numerator: namedCalls,
        denominator: total,
        unit: 'named calls',
        rest: `were spread across ${otherThings(rest.length, 'tool')}`,
        whole: 'No other tool was named in this window.',
      }),
      citations: [
        {
          // "NAMED tool calls", because that is the denominator this divides by.
          // `perToolCountsFromBuckets` drops rows that carried no tool name, so
          // `byTool` does not sum to the window's whole call count and a citation
          // reading "of your tool calls" would quietly overstate the share.
          text: `${rateOf(namedCalls / total, namedCalls, total, 'named tool calls')} went through ${listPhrase(named)}`,
          field: 'tools.byTool',
        },
        // The runners-up, which this card alone did not carry. Naming the two
        // tools a session leans on says nothing about whether the third was close
        // behind or barely used, and that is the difference between a habit and a
        // ranking.
        ...runnersUp(rest, (t) => getToolMeta(t.tool).label, (t) => t.calls, 'tools.byTool', 'calls'),
        boundary(
          'Calls that carried no tool name are outside this count, so it is a share of NAMED calls',
          'tools.byTool',
        ),
        // The error rate rides the tools card rather than earning a term of its
        // own: "your calls mostly land" is not an identity, it is a caveat on the
        // sentence above it. Absent, never zero-filled, when no call has returned
        // an honest pass/fail flag.
        //
        // "across every tool" was FALSE and it was the one bare percentage left in
        // the portrait. The worker divides errored calls by calls that reported a
        // boolean result, and only over tools a capability gate says can report
        // BOTH legs — so the denominator is neither every call nor every tool, and
        // a reader multiplying it by the named-call count one line above got a
        // number corresponding to nothing.
        ...(errorRate !== null
          ? [
              {
                // WITH the counts. This was the last bare percentage in the
                // portrait, and the least inferable one: the denominator is
                // neither every call nor every tool, so a reader could not
                // reconstruct it from the named-call count one line above. Both
                // counts were already summed in the worker to produce the rate and
                // were thrown away before the wire.
                text: Number.isFinite(callsWithResult) && callsWithResult > 0
                  ? `${rateOf(errorRate, erroredCalls, callsWithResult, 'calls that reported whether they succeeded')} came back an error`
                  : `${pctText(errorRate)} of the calls that reported whether they succeeded came back an error`,
                field: 'tools.callStats.errorRate',
              },
              boundary(
                'Calls with no result, and tools that cannot report a failure, are outside that count',
                'tools.callStats.errorRate',
              ),
            ]
          : []),
      ],
    },
  };
}

/**
 * Craft — what kind of work it was, and what it ran through.
 *
 * Both halves were already measured and shipped on every read, and neither had a
 * surface: `identity.branchWorkTypeMix` and `tools.byTool` arrived in the snapshot
 * and were dropped on the floor by the compiler. A capture field with no
 * projection is the exact red flag agent-standards names, and it applies just as
 * well one layer up — a projection with no render is a field nobody can check.
 */
export const craftProducer: PortraitProducer = {
  id: 'craft',
  paragraph: 'identity',
  weight: 0.6,
  produce(snapshot: DeveloperModelSnapshot): PortraitSentence | null {
    const workType = workTypeInsight(snapshot);
    const tools = toolInsight(snapshot);
    if (!workType && !tools) return null;

    // "You were mostly", not "The branches were mostly". A branch is where the
    // classification comes FROM, not what the sentence is about — the card says so
    // and the prose does not need to. It also stops the sentence opening on the
    // same share-shaped construction as the stack sentence right before it, which
    // is what made five sentences in a row scan as a filled-in form.
    //
    // "leaned toward" when the leading type is only a plurality. The gate to speak
    // at all is 40%, which is a clear lead among five work types and is not most
    // of anything.
    const workTypeLead = leadingWorkType(snapshot.identity?.branchWorkTypeMix);
    const majority = isMajority(workTypeLead?.share ?? null);
    const namedTools = snapshot.tools.byTool.filter(
      (t) => t.calls > 0 && t.tool !== UNNAMED_TOOL_BUCKET,
    );
    const toolTotal = namedTools.reduce((sum, t) => sum + t.calls, 0);
    const toolLead = namedTools.reduce((best, t) => Math.max(best, t.calls), 0);
    // `bestConcentration`, not `Math.max(concentration(...))`: a null share comes
    // back as the neutral 0.5, so on the owner's live window — where `other` leads
    // the branch names and the work-type half is therefore silent — the ABSENT
    // half scored higher than the measured one and pushed this sentence past the
    // rhythm lead into the read.
    const notability = bestConcentration([
      { share: workTypeLead?.share ?? null, categories: 5 },
      { share: toolTotal > 0 ? toolLead / toolTotal : null, categories: namedTools.length },
    ]);

    if (workType && tools) {
      return {
        notability,
        insights: [workType, tools],
        segments: [
          { type: 'text', text: majority ? 'You were mostly ' : 'You leaned toward ' },
          { type: 'insight', insightId: workType.id },
          { type: 'text', text: ', and spent more of it ' },
          { type: 'insight', insightId: tools.id },
          { type: 'text', text: ' than anything else. ' },
        ],
      };
    }

    if (workType) {
      return {
        notability,
        insights: [workType],
        segments: [
          { type: 'text', text: majority ? 'You were mostly ' : 'You leaned toward ' },
          { type: 'insight', insightId: workType.id },
          { type: 'text', text: '. ' },
        ],
      };
    }

    return {
      notability,
      insights: [tools!],
      segments: [
        { type: 'text', text: 'You spent more of it ' },
        { type: 'insight', insightId: tools!.id },
        { type: 'text', text: ' than anything else. ' },
      ],
      // "more of IT" leans on a preceding sentence having named the work. When
      // rhythm, focus and stack are all silent this producer OPENS the paragraph
      // and the whole portrait reads "you spent more of it reading and editing
      // than anything else" with nothing for "it" to be.
      leadSegments: [
        { type: 'text', text: 'Lately you have spent more of your time ' },
        { type: 'insight', insightId: tools!.id },
        { type: 'text', text: ' than anything else. ' },
      ],
    };
  },
};
