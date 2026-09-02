import type { InterviewConfig, Report, TranscriptWord } from "@repo/types";
import type { ReplayTurn } from "@/app/(app)/report/[sessionId]/Replay";

type Span = [word: string, duration: number, gapBefore?: number];

function timed(spans: Span[], from = 0.4): TranscriptWord[] {
  let t = from;
  return spans.map(([word, duration, gapBefore = 0.06]) => {
    const start = t + gapBefore;
    const end = start + duration;
    t = end;
    return { word, start: round(start), end: round(end) };
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

const Q4_WORDS = timed([
  ["So", 0.18],
  ["we", 0.14],
  ["underestimated", 0.62],
  ["the", 0.11],
  ["migration,", 0.44, 0.14],
  ["um,", 0.34, 0.31],
  ["and", 0.15, 0.22],
  ["the", 0.1],
  ["review", 0.33],
  ["cycle", 0.31],
  ["took", 0.24],
  ["longer", 0.36],
  ["because", 0.38, 0.19],
  ["like", 0.22, 0.28],
  ["coordination", 0.68, 0.17],
  ["between", 0.33],
  ["the", 0.09],
  ["two", 0.17],
  ["teams", 0.32],
  ["needed", 0.3],
  ["a", 0.07],
  ["full", 0.24],
  ["sprint", 0.35],
  ["we", 0.13],
  ["never", 0.27],
  ["planned", 0.34],
  ["for.", 0.26],
  ["The", 0.13, 0.42],
  ["estimate", 0.46],
  ["assumed", 0.42],
  ["the", 0.1],
  ["schemas", 0.44],
  ["already", 0.37],
  ["matched,", 0.42, 0.12],
  ["and", 0.14, 0.18],
  ["they", 0.16],
  ["didn't.", 0.38],
  ["I", 0.09, 0.55],
  ["mean", 0.21],
  ["we", 0.13],
  ["did", 0.16],
  ["ship", 0.24],
  ["it,", 0.2],
  ["it", 0.1, 0.16],
  ["was", 0.15],
  ["about", 0.26],
  ["three", 0.27],
  ["weeks", 0.31],
  ["late.", 0.34],
]);

const Q6_WORDS = timed([
  ["Right,", 0.32],
  ["so", 0.16, 0.14],
  ["you", 0.12, 0.19],
  ["know", 0.19],
  ["the", 0.09, 0.16],
  ["provider", 0.44],
  ["sends", 0.29],
  ["an", 0.1],
  ["event", 0.34],
  ["id,", 0.28],
  ["so", 0.16, 0.21],
  ["I'd", 0.18],
  ["store", 0.27],
  ["that", 0.19],
  ["in", 0.09],
  ["a", 0.06],
  ["table", 0.31],
  ["with", 0.17],
  ["a", 0.06],
  ["unique", 0.36],
  ["constraint", 0.52],
  ["and", 0.14, 0.13],
  ["just", 0.2],
  ["drop", 0.26],
  ["anything", 0.4],
  ["I've", 0.18],
  ["already", 0.35],
  ["seen.", 0.3],
  ["Um,", 0.36, 0.44],
  ["the", 0.1, 0.26],
  ["insert", 0.36],
  ["and", 0.13],
  ["the", 0.09],
  ["side", 0.22],
  ["effect", 0.31],
  ["would", 0.2],
  ["go", 0.15],
  ["in", 0.09],
  ["one", 0.19],
  ["transaction", 0.58],
  ["so", 0.15, 0.14],
  ["you", 0.12],
  ["can't", 0.24],
  ["get", 0.16],
  ["a", 0.06],
  ["half", 0.24],
  ["write.", 0.32],
  ["I", 0.08, 0.61],
  ["think", 0.24],
  ["that", 0.17],
  ["covers", 0.35],
  ["the", 0.09],
  ["retries.", 0.44],
]);

const CONFIG: InterviewConfig = {
  num_questions: 7,
  difficulty: "hard",
  sources: [],
  mode: "jd",
  job_description:
    "Backend Engineer (SDE-2), Payments. You will own webhook ingestion and the ledger write path: idempotent handlers, exactly-once side effects, and the on-call that comes with them. Postgres, Go, and a p99 budget you are expected to defend in review.",
  allow_repeats: false,
  max_answer_seconds: 150,
};

export const SAMPLE_SESSION = {
  name: "Payments SDE-2 · JD run",
  role: "Backend Engineer (SDE-2), Payments",
  config: CONFIG,
} as const;

export const SAMPLE_REPORT: Report = {
  id: "sample-report",
  session_id: "sample",
  overall_score: 72,
  verdict:
    "Pressed on your own numbers, you gave ground: the shape was right, the specifics never arrived.",
  category_scores: { technical: 74, communication: 69, problem_solving: 71 },
  delivery_metrics: {
    wpm: 176.17,
    avg_pause_ms: 98.2,
    filler_count: 5,
    pitch_variation: 21.6,
    energy: 0.038,
    mean_pitch_hz: 121,
    jitter_local: 0.019,
    shimmer_local: 0.071,
    hnr_db: 16.8,
    uptalk_pct: 26.47,
    uptalk_statements: 34,
    uptalk_rising: 9,
    on_camera_pct: 71.4,
    smile_pct: 12.8,
    head_motion_dps: 8.6,
    camera_turns: 7,
    response_latency_ms: null,
    interruptions: 0,
    articulation_rate_sps: 4.61,
    speech_rate_sps: 3.42,
    phonation_ratio: 0.742,
    trailing_off_pct: 22.22,
    trailing_off_statements: 18,
    trailing_off_fading: 4,
    transcriber_confidence: -0.312,
    slouch_pct: 14.6,
    hands_to_face_pct: 5.2,
    shoulder_tilt_deg: 2.8,
    wrist_motion: 0.14,
    posture_turns: 7,
  },
  strengths: [
    {
      point:
        "You reach for the mechanism before the story. Asked how to make a retried webhook safe, the first thing out of your mouth was the unique constraint, not a paragraph about reliability.",
      example:
        "the provider sends an event id, so I'd store that in a table with a unique constraint and just drop anything I've already seen",
    },
    {
      point:
        "You answer the question that was actually asked. When the follow-up narrowed from 'we' to 'you', you narrowed with it instead of restating the team's work in the first person.",
      example:
        "The consumer and the replay tool were mine. The schema change was Priya's — I reviewed it, I didn't write it.",
    },
    {
      point:
        "You own a miss without decorating it. The deadline answer named the wrong assumption in one sentence and did not reach for a reorg or a dependency to blame.",
      example: "The estimate assumed the schemas already matched, and they didn't.",
    },
  ],
  weaknesses: [
    {
      point:
        "Your own numbers arrive without their measurement. The 40% latency win is on your résumé and you repeated it here, but you could not say what you measured it with or over what window — so an interviewer has to take it on trust, and at SDE-2 they won't.",
      example:
        "It went from about 800 milliseconds down to under 500, I think. I'd have to check the dashboard.",
      fix: "For every number on your résumé, be ready with three things in one breath: the tool it came from, the window it covers, and the load it was under. 'p99 over seven days in Datadog, at peak roughly 900 requests a second' — that sentence is the difference between a claim and a result.",
    },
    {
      point:
        "You stop one layer above the failure. The idempotency answer got to the unique constraint and the transaction and then closed, leaving the two cases the posting actually cares about — a retry arriving while the first is still in flight, and a side effect that lives outside the database — unaddressed.",
      example: "I think that covers the retries.",
      fix: "When you finish a design answer, say out loud where it breaks: 'this holds unless two deliveries race, which is where I'd take a row lock on the event id — and the email send is outside the transaction, so that one needs an outbox.' Naming the hole is what reads as senior; leaving it is what reads as not having looked.",
    },
    {
      point:
        "Under pressure the pace climbs and the sentences run together. 176 words a minute with barely a tenth of a second between them is a candidate talking through the thinking rather than before it, and every filler you used landed in the two answers you were least sure of.",
      example:
        "So we underestimated the migration, um, and the review cycle took longer because like coordination between the two teams needed a full sprint we never planned for",
      fix: "Take the first two seconds of every answer as silence and spend them on the shape: point, evidence, consequence. The pause costs you nothing — the interviewer is still writing — and it buys a sentence that lands instead of one that runs.",
    },
  ],
  best_answer: {
    turn_index: 1,
    quote:
      "The consumer and the replay tool were mine. The schema change was Priya's — I reviewed it, I didn't write it.",
    why: "Asked to separate yourself from the team, you did it in two sentences and gave credit away without hedging. Most candidates fold the whole project back into 'I' at this exact moment.",
  },
  worst_answer: {
    turn_index: 2,
    quote:
      "It went from about 800 milliseconds down to under 500, I think. I'd have to check the dashboard.",
    why: "This is your own headline claim and it arrived softer than the résumé that made it. 'I think' and 'I'd have to check' on your strongest number invites the interviewer to discount every other number you gave.",
  },
  next_steps: [
    "Rehearse the three résumé numbers you are proudest of until each one comes with its instrument, its window and its load in a single sentence. This is the highest-value change on the page: it is the difference between the two answers that scored worst and the two that scored best, and it costs an evening.",
    "Finish every design answer by naming where it breaks. Two sentences — the failure you did not cover and how you would cover it — turns a correct answer into a senior one, and it is the exact gap between your webhook answer and the job posting.",
    "Cut the pace. Read one of your own transcripts out loud at 140 words a minute and notice how much of the filler simply has nowhere to go once the sentence has room.",
    "Bring one number per project that is not about you — throughput, error rate, cost — so the work has a size independent of your part in it.",
  ],
  question_feedback: [
    {
      turn_index: 0,
      possible_answers: [
        "Name the service, its job in one line, then the boundary of what you owned: 'Webhook ingestion for payment events. I owned the consumer and the replay path; the schema and the ledger writer belonged to two other people on the team.' The boundary is what the question is actually asking for.",
        "Lead with the constraint rather than the stack: 'It had to absorb a burst of about 4,000 events a minute without ever double-crediting an account.' A service defined by what it must not do is a service you clearly ran.",
      ],
      improvements: [
        "You spent four sentences on the architecture before saying which parts were yours. Invert that — ownership first, architecture only as far as it explains the ownership.",
        "'Fairly high throughput' is not a size. Give the number you actually watched on the dashboard.",
      ],
    },
    {
      turn_index: 1,
      possible_answers: [
        "You did this one well. The only thing worth adding is what the split cost you: 'reviewing it rather than writing it is why I missed the collation mismatch until staging.'",
      ],
      improvements: [
        "Stop half a beat sooner. The answer was complete after 'I reviewed it, I didn't write it' — the sentence you added after it started re-claiming the schema work.",
      ],
    },
    {
      turn_index: 2,
      possible_answers: [
        "'p99 on the ingest endpoint, measured in Datadog over a seven-day window at roughly 900 requests a second: 840 milliseconds before, 490 after. The bottleneck was an N+1 against the accounts table that only showed up under a warm cache.'",
        "If you genuinely do not remember the figure, say what you do remember and where it lives: 'I'd want to pull the dashboard before quoting it, but the shape was a bit under half, and it came from removing a per-event lookup.' That is honest without being vague.",
      ],
      improvements: [
        "Never soften your own headline number with 'I think'. Either quote it precisely or say plainly that you would check — the middle is the only version that costs you.",
        "You described the fix but never the diagnosis. How you found the bottleneck is the part that shows judgement; anyone can add an index once it is named.",
      ],
    },
    {
      turn_index: 3,
      possible_answers: [
        "'We committed to six weeks on an estimate that assumed both schemas already matched. They didn't, and I found out in week three. It shipped three weeks late. What I'd change is the assumption itself — I'd have spent half a day diffing the two schemas before we gave the date.'",
        "Put the correction where the miss was: 'the estimate was mine, and it was wrong because I priced the migration and not the coordination.'",
      ],
      improvements: [
        "The word 'we' is doing a lot of work in this answer. Say whose estimate it was.",
        "You named what slipped but not what you changed afterwards. A missed deadline with no changed practice reads as bad luck rather than as learning.",
      ],
    },
    {
      turn_index: 4,
      possible_answers: [
        "'A schema diff in week one. It's a half-day job and it would have turned a three-week slip into a scoping conversation before we'd promised anything.'",
      ],
      improvements: [
        "Good instinct, thin on cost. Say how long the check would have taken — a cheap fix for an expensive miss is the whole point of the answer.",
      ],
    },
    {
      turn_index: 5,
      possible_answers: [
        "'Idempotency key from the provider's event id, unique constraint on it, insert and side effect in one transaction. Two things that breaks on: concurrent redelivery, where I'd take a row lock or lean on the unique violation as the loser's signal; and any side effect outside Postgres — the email, the ledger call — which needs an outbox row committed with the same transaction and drained separately.'",
        "'And I'd keep the raw payload, because the first time the constraint fires on an event that isn't actually a duplicate, the payload is the only way to prove it.'",
      ],
      improvements: [
        "You stopped at the happy path. Name the concurrent-delivery case and the non-transactional side effect — that is precisely what this posting is hiring for.",
        "'I think that covers the retries' invites the follow-up you don't want. Close with what is not covered instead.",
      ],
    },
    {
      turn_index: 6,
      possible_answers: [
        "'I disagreed with dropping the replay tool from the cutover plan. I said so once in the review with the reason — no replay means a bad deploy is a data-loss event, not a rollback — and when it stayed dropped I built the smallest version of it anyway, on my own time in the same sprint. It got used in week two.'",
        "Disagreement answers land on what you did after losing, not on how right you were. Say what you committed to once the decision stood.",
      ],
      improvements: [
        "You argued the position again here rather than describing the disagreement. The interviewer already believes you were right; they want to know how you behaved.",
        "Add the aftermath. Whether the decision turned out well is far less interesting than whether you supported it while it stood.",
      ],
    },
  ],
  star_breakdown: [
    {
      turn_index: 3,
      basis: "time",
      segments: [
        {
          label: "S",
          start: 0.46,
          end: 14.6,
          text: "So we underestimated the migration, um, and the review cycle took longer because like coordination between the two teams needed a full sprint we never planned for. The estimate assumed the schemas already matched, and they didn't.",
        },
        {
          label: "R",
          start: 15.15,
          end: 18.37,
          text: "I mean we did ship it, it was about three weeks late.",
        },
      ],
      share: { S: 81.5, T: 0, A: 0, R: 18.5, other: 0 },
      missing: ["T", "A"],
      note: "Four fifths of this answer sets the scene and the outcome is one clause; nothing in between says what you were on the hook for or what you did about it.",
    },
    {
      turn_index: 6,
      basis: "words",
      segments: [
        {
          label: "S",
          start: 0,
          end: 39,
          text: "We decided to drop the replay tool from the cutover plan to save a week, and I thought that was wrong — without replay, a bad deploy during the cutover isn't something you roll back, it's data you've lost.",
        },
        { label: "A", start: 39, end: 45, text: "I said so in the review." },
        { label: "R", start: 45, end: 49, text: "It still got dropped." },
        { label: "other", start: 49, end: 57, text: "I still think it was the wrong call," },
        {
          label: "A",
          start: 57,
          end: 76,
          text: "and I ended up building a cut-down version of it anyway because we needed it in the second week.",
        },
      ],
      share: { S: 51.3, T: 0, A: 32.9, R: 5.3, other: 10.5 },
      missing: ["T"],
      note: "Half the answer is the position you took and four words are the outcome; what the team actually asked of you once the decision stood is never stated.",
    },
  ],
  created_at: "2026-07-28T09:14:00.000Z",
};

const RUBRIC = {
  q0: { relevance: 7, correctness: 7, structure: 6, depth: 6, filler: 6 },
  q1: { relevance: 9, correctness: 8, structure: 8, depth: 7, filler: 8 },
  q2: { relevance: 6, correctness: 5, structure: 5, depth: 4, filler: 5 },
  q3: { relevance: 7, correctness: 7, structure: 6, depth: 5, filler: 4 },
  q4: { relevance: 8, correctness: 7, structure: 7, depth: 5, filler: 7 },
  q5: { relevance: 8, correctness: 8, structure: 7, depth: 5, filler: 5 },
  q6: { relevance: 7, correctness: 6, structure: 6, depth: 6, filler: 7 },
} as const;

const Q4_AWAY = [
  { start_ms: 3_120, end_ms: 4_460 },
  { start_ms: 9_180, end_ms: 12_040 },
  { start_ms: 16_700, end_ms: 17_520 },
];

function turn(
  index: number,
  question: string,
  questionType: ReplayTurn["question_type"],
  transcript: string,
  scores: ReplayTurn["scores"],
  transcriptWords: TranscriptWord[] | null = null,
  awaySegments: ReplayTurn["away_segments"] = null,
  takeMs: ReplayTurn["take_ms"] = null,
): ReplayTurn {
  return {
    turn_id: `sample-turn-${index}`,
    turn_index: index,
    question,
    question_type: questionType,
    transcript,
    transcript_words: transcriptWords,
    has_audio: false,
    video_id: null,
    video_offset_ms: null,
    video_expires_in_days: null,
    question_hash: `sample-${index}`,
    starred: false,
    feedback: SAMPLE_REPORT.question_feedback[index] ?? null,
    scores,
    star: SAMPLE_REPORT.star_breakdown.find((b) => b.turn_index === index) ?? null,
    away_segments: awaySegments,
    take_ms: takeMs,
  };
}

export const SAMPLE_TURNS: ReplayTurn[] = [
  turn(
    0,
    "Walk me through the last service you owned end to end. What did it do, and what was yours about it?",
    "technical",
    "It was the webhook ingestion service for payment events. Provider posts to us, we normalise the payload, write a ledger entry and fan out to whoever cares. Go on top of Postgres, running on ECS, fairly high throughput. We built it over about two quarters — there was a consumer, a normaliser, a replay tool for when a batch came in wrong, and the ledger writer on the other side of a queue. I was on it from the start and I'd say I know all of it well.",
    RUBRIC.q0,
  ),
  turn(
    1,
    "You said “we” for most of that. Which parts were yours?",
    "followup",
    "Fair. The consumer and the replay tool were mine. The schema change was Priya's — I reviewed it, I didn't write it. The ledger writer was mostly Sam, though I did the retry logic on it after we had an incident.",
    RUBRIC.q1,
  ),
  turn(
    2,
    "Your résumé says you cut p99 latency by 40% on that service. What was the bottleneck, and how did you find it?",
    "technical",
    "We were doing a lookup per event against the accounts table, and once volume went up that became the whole cost. I added an index and batched the lookups. It went from about 800 milliseconds down to under 500, I think. I'd have to check the dashboard.",
    RUBRIC.q2,
  ),
  turn(
    3,
    "Tell me about a project where you missed the deadline. What slipped?",
    "cultural",
    "So we underestimated the migration, um, and the review cycle took longer because like coordination between the two teams needed a full sprint we never planned for. The estimate assumed the schemas already matched, and they didn't. I mean we did ship it, it was about three weeks late.",
    RUBRIC.q3,
    Q4_WORDS,
    Q4_AWAY,
    18_370,
  ),
  turn(
    4,
    "What would you have caught a week earlier?",
    "followup",
    "The schema mismatch, definitely. If someone had diffed the two schemas at the start instead of assuming, we'd have known the shape of the work before we gave anyone a date.",
    RUBRIC.q4,
  ),
  turn(
    5,
    "The posting is mostly idempotent webhook handling. How would you make a handler safe to retry?",
    "technical",
    "Right, so you know the provider sends an event id, so I'd store that in a table with a unique constraint and just drop anything I've already seen. Um, the insert and the side effect would go in one transaction so you can't get a half write. I think that covers the retries.",
    RUBRIC.q5,
    Q6_WORDS,
  ),
  turn(
    6,
    "Tell me about a time you disagreed with a decision your team had already made.",
    "cultural",
    "We decided to drop the replay tool from the cutover plan to save a week, and I thought that was wrong — without replay, a bad deploy during the cutover isn't something you roll back, it's data you've lost. I said so in the review. It still got dropped. I still think it was the wrong call, and I ended up building a cut-down version of it anyway because we needed it in the second week.",
    RUBRIC.q6,
  ),
];
