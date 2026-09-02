import { beforeEach, expect, mock, test } from "bun:test";
import type { AnswerInput } from "@/lib/services/answerService";

mock.module("server-only", () => ({}));

mock.module("@/lib/env", () => ({
  config: {
    auth: { passwordMinLength: 8 },
    interview: { defaultNumQuestions: 8 },
    video: { maxParts: 1_000 },
    audio: { maxBytes: 20 * 1_024 * 1_024 },
    gemini: { keys: [] },
    groq: { keys: [] },
    rotation: { baseBackoffMs: 500 },
    storageConfigured: true,
  },
}));

mock.module("@/lib/auth", () => ({ requireUserId: async () => "user-1" }));
mock.module("@/lib/rateLimit", () => ({ rateLimit: async () => {} }));

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

const session = { id: SESSION_ID, userId: "user-1", status: "in_progress" };

const PROMPT = {
  kind: "design",
  title: "A ledger for the till",
  prompt_markdown:
    "Design the write path for a point-of-sale ledger that every store reads back within a second.",
  requirements: ["every sale is durable", "reads within one second"],
  scale: "2M daily users, 8k writes/s",
  focus: ["partitioning"],
};

mock.module("@/lib/db/repo", () => ({
  getSession: async (id: string, userId: string) =>
    id === SESSION_ID && userId === "user-1" ? session : null,
  getTurn: async (id: string, turnIndex: number) => {
    if (id !== SESSION_ID) return null;
    if (turnIndex === 0) return { turnIndex: 0, transcript: null, questionPayload: PROMPT };
    if (turnIndex === 1) return { turnIndex: 1, transcript: null, questionPayload: null };
    return null;
  },
}));

const putObject = mock(async () => {});
const putAudio = mock(async () => {});
mock.module("@/lib/storage/objectStore", () => ({
  audioKey: (id: string, turnIndex: number, ext: string) => `audio/${id}/${turnIndex}.${ext}`,
  designKey: (id: string, turnIndex: number) => `design/${id}/turn_${turnIndex}.excalidraw`,
  designImageKey: (id: string, turnIndex: number) => `design/${id}/turn_${turnIndex}.png`,
  putAudio,
  putObject,
}));

const transcribe = mock(async () => ({
  text: "I sharded the ledger by store.",
  words: [{ word: "I", start: 0.5, end: 0.8 }],
  confidence: -0.2,
}));
mock.module("@/lib/clients/sttClient", () => ({ transcribe }));

const REVIEW = {
  summary: "A gateway in front of Kafka and one Postgres primary.",
  components: ["api gateway", "kafka", "postgres"],
  missing: ["no read replica"],
  single_points_of_failure: ["the single postgres primary"],
  scale_concerns: ["8k writes/s on one primary"],
  follow_up_question: "What happens when that Postgres primary fails?",
};

const generateJson = mock(async () => ({
  value: {
    ...REVIEW,
    scores: { relevance: 8, correctness: 6, structure: 7, depth: 5, filler: 8 },
  },
  raw: "",
  sources: [],
}));
mock.module("@/lib/clients/llmJson", () => ({ generateJson }));

const processAnswer = mock(async () => ({
  turn_index: 0,
  transcript: "[design] components: api gateway",
  answer_scores: { relevance: 8, correctness: 6, structure: 7, depth: 5, filler: 8 },
  next_question: "What happens when that Postgres primary fails?",
  next_question_type: "followup",
  next_payload: null,
  done: false,
}));
mock.module("@/lib/services/answerService", () => ({ processAnswer }));

const { POST } = await import("./route");

const SCENE = JSON.stringify({ type: "excalidraw", elements: [], appState: {} });

const EDITS = JSON.stringify({
  first_edit_ms: 5_400,
  longest_idle_ms: 42_000,
  final_elements: 11,
});

function png(): File {
  return new File([new Uint8Array([137, 80, 78, 71])], "turn_0.png", { type: "image/png" });
}

function post(
  opts: {
    turnIndex?: string;
    image?: File | null;
    scene?: string | null;
    edits?: string;
    audio?: File;
  } = {},
) {
  const form = new FormData();
  form.append("session_id", SESSION_ID);
  form.append("turn_index", opts.turnIndex ?? "0");
  const image = opts.image === undefined ? png() : opts.image;
  if (image) form.append("image", image);
  const scene = opts.scene === undefined ? SCENE : opts.scene;
  if (scene !== null) form.append("scene", scene);
  if (opts.edits) form.append("edits", opts.edits);
  if (opts.audio) form.append("audio", opts.audio);
  return POST(
    new Request("https://example.test/api/interview/answer-design", { method: "POST", body: form }),
  );
}

const lastInput = () => processAnswer.mock.calls[0]![0] as unknown as AnswerInput;

beforeEach(() => {
  processAnswer.mockClear();
  transcribe.mockClear();
  generateJson.mockClear();
  putObject.mockClear();
  putAudio.mockClear();
});

test("a board goes to R2 twice — the picture and the scene — and then to the reviewer", async () => {
  const res = await post({ edits: EDITS });

  expect(res.status).toBe(200);
  expect(putObject).toHaveBeenCalledTimes(2);
  expect(putObject.mock.calls[0]).toEqual([
    `design/${SESSION_ID}/turn_0.png`,
    new Uint8Array([137, 80, 78, 71]),
    "image/png",
  ] as never);
  expect(putObject.mock.calls[1]![0]).toBe(`design/${SESSION_ID}/turn_0.excalidraw`);

  const input = lastInput();
  expect(input.designKey).toBe(`design/${SESSION_ID}/turn_0.excalidraw`);
  expect(input.designImageKey).toBe(`design/${SESSION_ID}/turn_0.png`);
  expect(input.designReview).toMatchObject({ components: REVIEW.components });
  expect(input.designReview?.activity).toEqual({
    first_edit_ms: 5_400,
    longest_idle_ms: 42_000,
    final_elements: 11,
  });
  expect(input.answerScores).toEqual({
    relevance: 8,
    correctness: 6,
    structure: 7,
    depth: 5,
    filler: 8,
  });
  expect(input.transcript).toContain("[design] components: api gateway, kafka, postgres");
  expect(input.transcript).toContain("Spoken: (nothing)");
  expect(transcribe).not.toHaveBeenCalled();
});

test("a clip drawn over is stored, transcribed and handed to the reviewer", async () => {
  const audio = new File([new Uint8Array([1, 2, 3])], "turn_0.webm", { type: "audio/webm" });

  const res = await post({ audio });

  expect(res.status).toBe(200);
  expect(transcribe).toHaveBeenCalledTimes(1);

  const input = lastInput();
  expect(input.audioKey).toBe(`audio/${SESSION_ID}/0.webm`);
  expect(input.transcriptConfidence).toBe(-0.2);
  expect(input.transcript).toContain("Spoken: I sharded the ledger by store.");
});

test("a submission with no picture is refused before anything is stored", async () => {
  const res = await post({ image: null });

  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "missing_image" } });
  expect(putObject).not.toHaveBeenCalled();
  expect(processAnswer).not.toHaveBeenCalled();
});

test("a spoken turn cannot take a board", async () => {
  const res = await post({ turnIndex: "1" });

  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "not_a_design_turn" } });
  expect(processAnswer).not.toHaveBeenCalled();
});

test("a scene that is not JSON is refused before anything is reviewed", async () => {
  const res = await post({ scene: "{not json" });

  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "bad_scene" } });
  expect(generateJson).not.toHaveBeenCalled();
  expect(processAnswer).not.toHaveBeenCalled();
});
