import { LIVE_CLOSING } from "@/lib/prompts/live";

export interface LiveLog {
  question: string;
  answer: string;
}

export interface LiveInlineData {
  data?: string;
  mimeType?: string;
}

export interface LiveMessage {
  serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    modelTurn?: { parts?: { inlineData?: LiveInlineData }[] };
  };
  goAway?: { timeLeft?: string };
}

export interface LivePairingState {
  pendingQuestion: string;
  liveQuestion: string;
  liveAnswer: string;
  log: LiveLog[];
}

export interface LiveReduction {
  state: LivePairingState;
  audio: string[];
  interrupted: boolean;
  heardUser: boolean;
  closing: boolean;
  goAway: boolean;
}

export const EMPTY_LIVE_STATE: LivePairingState = {
  pendingQuestion: "",
  liveQuestion: "",
  liveAnswer: "",
  log: [],
};

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const CLOSING_NORMALISED = normalise(LIVE_CLOSING);

export function saysClosing(text: string): boolean {
  return normalise(text).includes(CLOSING_NORMALISED);
}

export function reduceLiveMessage(state: LivePairingState, msg: LiveMessage): LiveReduction {
  const content = msg.serverContent;
  const next: LivePairingState = { ...state, log: state.log };
  const audio: string[] = [];
  const interrupted = Boolean(content?.interrupted);
  let heardUser = false;

  if (!interrupted) {
    for (const part of content?.modelTurn?.parts ?? []) {
      const data = part.inlineData?.data;
      if (data) audio.push(data);
    }
  }

  const spoken = content?.outputTranscription?.text ?? "";
  if (spoken) next.liveQuestion += spoken;

  const heard = content?.inputTranscription?.text ?? "";
  if (heard) {
    next.liveAnswer += heard;
    heardUser = true;
  }

  if (content?.turnComplete) {
    if (next.liveAnswer.trim() && next.pendingQuestion.trim()) {
      next.log = [
        ...next.log,
        { question: next.pendingQuestion.trim(), answer: next.liveAnswer.trim() },
      ];
    }
    next.pendingQuestion = next.liveQuestion;
    next.liveQuestion = "";
    next.liveAnswer = "";
  }

  return {
    state: next,
    audio,
    interrupted,
    heardUser,
    closing: saysClosing(next.pendingQuestion) || saysClosing(next.liveQuestion),
    goAway: Boolean(msg.goAway),
  };
}

export function finaliseLive(state: LivePairingState): LiveLog[] {
  const question = state.pendingQuestion.trim();
  const answer = state.liveAnswer.trim();
  if (!question || !answer) return state.log;
  return [...state.log, { question, answer }];
}
