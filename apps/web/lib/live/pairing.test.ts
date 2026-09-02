import { expect, test } from "bun:test";
import { LIVE_CLOSING } from "@/lib/prompts/live";
import {
  EMPTY_LIVE_STATE,
  finaliseLive,
  reduceLiveMessage,
  type LiveMessage,
  type LivePairingState,
} from "./pairing";

const said = (text: string): LiveMessage => ({
  serverContent: { outputTranscription: { text } },
});
const heard = (text: string): LiveMessage => ({
  serverContent: { inputTranscription: { text } },
});
const turnComplete: LiveMessage = { serverContent: { turnComplete: true } };

function run(messages: LiveMessage[], from: LivePairingState = EMPTY_LIVE_STATE) {
  let state = from;
  const reductions = messages.map((m) => {
    const out = reduceLiveMessage(state, m);
    state = out.state;
    return out;
  });
  return { state, reductions, last: reductions[reductions.length - 1]! };
}

test("a question, an answer and the next question make one finished pair", () => {
  const { state } = run([
    said("Why did the "),
    said("ledger drift?"),
    turnComplete,
    heard("Two writers, "),
    heard("no lock."),
    said("What did you change?"),
    turnComplete,
  ]);

  expect(state.log).toEqual([
    { question: "Why did the ledger drift?", answer: "Two writers, no lock." },
  ]);
  expect(state.pendingQuestion).toBe("What did you change?");
  expect(state.liveQuestion).toBe("");
  expect(state.liveAnswer).toBe("");
});

test("the opening turn completes with nothing to pair, and emits no pair", () => {
  const { state } = run([said("Tell me about the migration."), turnComplete]);

  expect(state.log).toEqual([]);
  expect(state.pendingQuestion).toBe("Tell me about the migration.");
});

test("a turn the candidate stayed silent through is not written down as an answer", () => {
  const { state } = run([said("Q1?"), turnComplete, said("Q2?"), turnComplete]);

  expect(state.log).toEqual([]);
  expect(state.pendingQuestion).toBe("Q2?");
});

test("audio parts are handed back for playback, and an interruption drops them", () => {
  const speaking = reduceLiveMessage(EMPTY_LIVE_STATE, {
    serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAB" } }, {}] } },
  });
  expect(speaking.audio).toEqual(["AAAB"]);
  expect(speaking.interrupted).toBe(false);

  const cut = reduceLiveMessage(speaking.state, {
    serverContent: { interrupted: true, modelTurn: { parts: [{ inlineData: { data: "AAAC" } }] } },
  });
  expect(cut.interrupted).toBe(true);
  expect(cut.audio).toEqual([]);
});

test("input transcription is what marks the candidate as speaking", () => {
  expect(reduceLiveMessage(EMPTY_LIVE_STATE, heard("well, ")).heardUser).toBe(true);
  expect(reduceLiveMessage(EMPTY_LIVE_STATE, said("well, ")).heardUser).toBe(false);
});

test("the closing line is recognised through the transcriber's punctuation", () => {
  const { last } = run([said("That's everything from my side — thank you"), turnComplete]);

  expect(last.closing).toBe(true);
  expect(run([said("So, what happened next?")]).last.closing).toBe(false);
  expect(run([said(LIVE_CLOSING)]).last.closing).toBe(true);
});

test("goAway is surfaced without touching the pairing", () => {
  const out = reduceLiveMessage(EMPTY_LIVE_STATE, { goAway: { timeLeft: "10s" } });

  expect(out.goAway).toBe(true);
  expect(out.state.log).toEqual([]);
});

test("ending mid-answer keeps the last pair, and never invents an empty one", () => {
  const withAnswer = run([said("Q1?"), turnComplete, heard("A1.")]).state;
  expect(finaliseLive(withAnswer)).toEqual([{ question: "Q1?", answer: "A1." }]);

  const withoutAnswer = run([said("Q1?"), turnComplete]).state;
  expect(finaliseLive(withoutAnswer)).toEqual([]);
});

test("the reducer never mutates the state it was handed", () => {
  const before = run([said("Q1?"), turnComplete, heard("A1.")]).state;
  const snapshot = { ...before, log: [...before.log] };

  reduceLiveMessage(before, turnComplete);

  expect(before).toEqual(snapshot);
});
