import type { DeveloperModelSnapshot } from '@seorak/types';

import { boundary, count, otherThings, rateOf, remainderText, runnersUp } from './evidence.js';
import { bestConcentration, isMajority } from './format.js';
import type { PortraitContext, PortraitProducer, PortraitSentence } from './types.js';

/** How far the leading project must sit above the runner-up, as a share of the
 *  window's sessions, before the read will call it the place your time went.
 *  Below it the read names both rather than crowning one by a session. */
const FOCUS_MARGIN = 0.05;

/**
 * Focus — where attention went. The top project by session share.
 *
 * The citation carries the ship rate beside the share deliberately: the share is
 * how much of you went there, the ship rate is whether it landed, and a focus
 * card that showed only the first would be a volume claim (introspection.md hard
 * rule 3 — effectiveness is outcome given a dimension, never volume given one).
 */
export const focusProducer: PortraitProducer = {
  id: 'focus',
  paragraph: 'identity',
  // Where the time went across a portfolio is worth more than any single-repo
  // fact: with eleven active projects a reader genuinely cannot rank them.
  weight: 0.8,
  produce(snapshot: DeveloperModelSnapshot, ctx: PortraitContext): PortraitSentence | null {
    // A scoped read has ONE project in its focus rollup, so "most of your time
    // went to seorak" would be 100% by construction — a sentence the reader just
    // caused by choosing the scope, dressed up as something the data found. Where
    // attention went is a question about the merged portrait.
    if (snapshot.scope.repoId !== null) return null;

    // Ranked HERE, not trusted from the wire. `projectFocusFromRollups` sorts
    // descending today, and every line below — which repo is named, which is the
    // runner-up, what "the rest" means — reads positionally off that promise. The
    // portrait already refuses to let payload order decide a claim anywhere else
    // (the daypart tie, the steadiest-weekday pair); this was the one place it
    // still did. Ties break by repoId so the same window always reads the same.
    const ranked = [...snapshot.focus.projectFocus].sort(
      (a, b) => b.sessions - a.sessions || a.repoId.localeCompare(b.repoId),
    );
    const top = ranked[0];
    if (!top || top.sessions < 1) return null;
    const second = ranked[1];
    const totalSessions = ranked.reduce((sum, p) => sum + p.sessions, 0);

    // Two projects this close is not a leader, it is a two-horse window.
    //
    // Found on a real read: a quarter split 188 sessions to one repo and 187 to
    // another, and the sentence crowned the first of them as where the time went.
    // One session decided it, and it would have named the other one next week on
    // the same behaviour. The daypart lead got a runner-up margin for exactly this
    // and focus never did.
    //
    // Naming BOTH is the true sentence, and it is a stronger one: two repos at 26%
    // each are 52% together, so "most" becomes accurate where it was a stretch for
    // either alone. Each keeps its own term and its own card, so the counts behind
    // both are still one click away.
    const tied =
      second !== undefined &&
      totalSessions > 0 &&
      (top.sessions - second.sessions) / totalSessions < FOCUS_MARGIN;
    const named = tied ? [top, second] : [top];
    const rest = ranked.slice(named.length);
    const namedShare = totalSessions > 0
      ? named.reduce((sum, p) => sum + p.sessions, 0) / totalSessions
      : null;

    const projectName = top.project;
    /** Every repo the window saw except the one a given card is about. */
    const activeProjects = ranked.filter((p) => p.sessions > 0).length;

    /**
     * The denominator here is "sessions the log could put in a project", and the
     * rhythm card two sentences earlier prints a LARGER total under the same word.
     *
     * On the owner's live 30-day window they are 446 and 485: thirty-nine sessions
     * started without a repo the log could attribute, so they are counted as starts
     * and not as focus. That is exactly the inconsistency the work-type card was
     * fixed for — it states its own equivalent exclusion — and focus was the one
     * left. Only said when the two actually disagree, so a window where every
     * session was attributed does not carry a caveat about nothing.
     */
    const startTotal = ctx.sessionTotal;
    const attributionBoundary =
      startTotal > totalSessions
        ? [
            boundary(
              `${count(startTotal - totalSessions)} of your ${count(startTotal)} session starts began without a project the log could name, so they are outside this count`,
              'focus.projectFocus',
            ),
          ]
        : [];
    const elsewhere = (project: { sessions: number }) =>
      remainderText({
        numerator: project.sessions,
        denominator: totalSessions,
        unit: 'sessions',
        rest: `were spread across ${otherThings(Math.max(0, activeProjects - 1), 'project')}`,
        whole: 'No other project saw a session in this window.',
      });

    const insight = {
      id: 'top-project',
      facet: 'focus' as const,
      linkedTerm: projectName,
      // The facet, not the project name. The header said "seorak", the line under
      // it said "seorak", and the sentence it hangs off said "seorak" — three
      // times in a card three lines tall. The project identity is already carried
      // by the coloured squircle beside the heading.
      label: 'Where attention went',
      hoverLines: [
        // Says what it BEAT. The prose already said this project led; repeating
        // that with a count attached is a restatement, not evidence.
        second
          ? `${count(top.sessions)} of your ${count(totalSessions)} sessions, ahead of ${second.project} at ${count(second.sessions)}.`
          : `${count(top.sessions)} of your ${count(totalSessions)} sessions.`,
      ],
      squircle: {
        // Was a hardcoded pair of claims and both were reachable-false: "Most of
        // your sessions ran here" printed over a 30% leader, and the tied branch
        // asserted "a little under half" over two repos holding 16% each of a long
        // tail. Neither was derived from anything. The remainder is, and it is
        // also the thing a reader needs to read a 30% leader — whether the other
        // 70% is one rival or ten.
        detail: elsewhere(top),
        projectKey: projectName,
        share: totalSessions > 0 ? top.sessions / totalSessions : undefined,
        citations: [
          {
            text:
              top.share !== null
                ? `${rateOf(top.share, top.sessions, totalSessions, 'sessions')}`
                : `${count(top.sessions)} sessions, the most of any repo`,
            field: 'focus.projectFocus.share',
          },
          ...(tied
            ? [
                {
                  text: `${second!.project} is within a session of it at ${count(second!.sessions)}, so neither led this window`,
                  field: 'focus.projectFocus',
                },
              ]
            : []),
          // The runners-up WITH their counts. Naming a leader without saying what
          // it led is the difference between a real concentration and a coin flip.
          ...runnersUp(
            rest,
            (p) => p.project,
            (p) => p.sessions,
            'focus.projectFocus',
            'sessions',
          ),
          // This card used to cite `outcomes.shipRate`, which on a merged read is
          // the rate across EVERY repo — printed under a heading naming one of
          // them. A number that is not about the thing it sits under is worse than
          // no number; shipping is the payoff paragraph's claim, not focus's.
          boundary(
            'Counted by session, not by time spent or lines written',
            'focus.projectFocus',
          ),
          ...attributionBoundary,
        ],
      },
    };

    // One tracked project means the share is 1 by construction, and "MOST of your
    // time went to seorak" quietly implies some of it went elsewhere. Say what is
    // true instead.
    const onlyProject = ranked.length === 1;
    // And a LEADER is not a majority. Four projects at three sessions each printed
    // "Most of your time went to seorak" while the card directly underneath listed
    // three more repos at the identical count — three quarters of the reader's
    // time went somewhere else. Every other leader-naming producer routes through
    // `isMajority` for exactly this; focus, the one sentence that names the
    // reader's own repos, was the one that did not.
    // Gated on what the sentence NAMES, so a tied pair is judged on the pair.
    const most = isMajority(tied ? namedShare : top.share);
    const tail = onlyProject || most ? '. ' : ' than anywhere else. ';

    // Eleven active repos with one at 37% is a real concentration; two repos at
    // 50/50 is not, and neither is one repo at 100% because there was nothing to
    // choose between — which `concentration` did not implement, handing a
    // single-repo window the neutral 0.5 and ranking it above a real 42% leader
    // among twenty-one.
    //
    // Off the COUNTS, not `top.share`, which the contract allows to be null: a
    // null share used to score neutral too, so the one shape where the wire says
    // nothing scored higher than every shape where it says something.
    const countShare = totalSessions > 0 ? top.sessions / totalSessions : null;
    const notability = bestConcentration([
      {
        share: tied ? namedShare : (top.share ?? countShare),
        categories: activeProjects,
      },
    ]);

    if (tied) {
      const secondInsight = {
        id: 'second-project',
        facet: 'focus' as const,
        linkedTerm: second!.project,
        label: 'Where attention went',
        hoverLines: [
          `${count(second!.sessions)} of your ${count(totalSessions)} sessions, within a session of ${top.project} at ${count(top.sessions)}.`,
        ],
        squircle: {
          detail: elsewhere(second!),
          projectKey: second!.project,
          share: totalSessions > 0 ? second!.sessions / totalSessions : undefined,
          citations: [
            {
              text:
                second!.share !== null
                  ? `${rateOf(second!.share, second!.sessions, totalSessions, 'sessions')}`
                  : `${count(second!.sessions)} sessions`,
              field: 'focus.projectFocus.share',
            },
            {
              text: `${top.project} is within a session of it at ${count(top.sessions)}, so neither led this window`,
              field: 'focus.projectFocus',
            },
            ...runnersUp(rest, (p) => p.project, (p) => p.sessions, 'focus.projectFocus', 'sessions'),
            boundary('Counted by session, not by time spent or lines written', 'focus.projectFocus'),
            ...attributionBoundary,
          ],
        },
      };
      const pair = (lead: string): PortraitSentence['segments'] => [
        { type: 'text', text: lead },
        { type: 'insight', insightId: 'top-project' },
        { type: 'text', text: ' and ' },
        { type: 'insight', insightId: 'second-project' },
        { type: 'text', text: '. ' },
      ];
      return {
        notability,
        insights: [insight, secondInsight],
        segments: pair(most ? 'Most of your time was split between ' : 'Your time was split between '),
        leadSegments: pair(
          most
            ? 'Lately, most of your time has been split between '
            : 'Lately, your time has been split between ',
        ),
      };
    }

    return {
      notability,
      insights: [insight],
      segments: [
        {
          type: 'text',
          text: onlyProject
            ? 'All of it went to '
            : most
              ? 'Most of your time went to '
              : 'More of your time went to ',
        },
        { type: 'insight', insightId: 'top-project' },
        { type: 'text', text: tail },
      ],
      // Opening the paragraph, the sentence has no rhythm clause to lean on, so it
      // has to place itself in time the way the rhythm sentence would have.
      leadSegments: [
        {
          type: 'text',
          text: onlyProject
            ? 'Lately, all of your time has gone to '
            : most
              ? 'Lately, most of your time has gone to '
              : 'Lately, more of your time has gone to ',
        },
        { type: 'insight', insightId: 'top-project' },
        { type: 'text', text: tail },
      ],
    };
  },
};
