import { test, expect, mock, beforeEach } from "bun:test";
import type { UploadedPart } from "@/lib/storage/objectStore";

mock.module("server-only", () => ({}));

const listParts = mock(async (): Promise<UploadedPart[]> => []);
const completeMultipart = mock(async (_k: string, _u: string, _p: UploadedPart[]) => {});
const abortMultipart = mock(async (_k: string, _u: string) => {});
const deleteObject = mock(async (_k: string) => {});

mock.module("@/lib/storage/objectStore", () => ({
  listParts,
  completeMultipart,
  abortMultipart,
  deleteObject,
}));

interface VideoRow {
  id: string;
  key: string;
  uploadId: string | null;
}

const listUnfinishedVideos = mock(async (): Promise<VideoRow[]> => [
  { id: "vid_1", key: "video/sess_1/vid_1.webm", uploadId: "upload_1" },
]);
const completeSessionVideo = mock(async (_id: string) => {});
const deleteSessionVideo = mock(async (_id: string) => {});
const listExpiredVideos = mock(async (): Promise<VideoRow[]> => []);

mock.module("@/lib/db/repo", () => ({
  listUnfinishedVideos,
  completeSessionVideo,
  deleteSessionVideo,
  listExpiredVideos,
}));

const { settleUnfinishedVideos } = await import("@/lib/services/videoService");

const GRACE = 120_000;

function part(partNumber: number, ageMs: number | null): UploadedPart {
  return {
    partNumber,
    etag: `"etag-${partNumber}"`,
    lastModified: ageMs === null ? null : Date.now() - ageMs,
  };
}

function stored(...parts: UploadedPart[]) {
  listParts.mockResolvedValue(parts);
}

beforeEach(() => {
  for (const m of [
    listParts,
    completeMultipart,
    abortMultipart,
    deleteObject,
    listUnfinishedVideos,
    completeSessionVideo,
    deleteSessionVideo,
  ]) {
    m.mockClear();
  }
  listParts.mockResolvedValue([]);
  listUnfinishedVideos.mockResolvedValue([
    { id: "vid_1", key: "video/sess_1/vid_1.webm", uploadId: "upload_1" },
  ]);
});

test("leaves an upload alone when a part landed inside the grace window", async () => {
  stored(part(1, 90_000), part(2, 1_000));

  await settleUnfinishedVideos("sess_1", { graceMs: GRACE });

  expect(completeMultipart).not.toHaveBeenCalled();
  expect(abortMultipart).not.toHaveBeenCalled();
  expect(completeSessionVideo).not.toHaveBeenCalled();
  expect(deleteSessionVideo).not.toHaveBeenCalled();
});

test("keeps an upload with no parts yet when the caller admits a live client", async () => {
  stored();

  await settleUnfinishedVideos("sess_1", { graceMs: GRACE });

  expect(abortMultipart).not.toHaveBeenCalled();
  expect(deleteSessionVideo).not.toHaveBeenCalled();
  expect(completeMultipart).not.toHaveBeenCalled();
});

test("settles an upload whose last part is older than the grace window", async () => {
  stored(part(1, GRACE + 60_000), part(2, GRACE + 30_000));

  await settleUnfinishedVideos("sess_1", { graceMs: GRACE });

  expect(completeMultipart).toHaveBeenCalledTimes(1);
  expect(completeSessionVideo).toHaveBeenCalledWith("vid_1");
});

test("salvages an abandoned upload at once when the caller knows the writer is gone", async () => {
  stored(part(1, 500), part(2, 200));

  await settleUnfinishedVideos("sess_1");

  expect(completeMultipart).toHaveBeenCalledTimes(1);
  expect(completeMultipart.mock.calls[0]![2].map((p) => p.partNumber)).toEqual([1, 2]);
  expect(completeSessionVideo).toHaveBeenCalledWith("vid_1");
  expect(abortMultipart).not.toHaveBeenCalled();
});

test("throws away an upload that is truly empty when no grace is given", async () => {
  stored();

  await settleUnfinishedVideos("sess_1");

  expect(abortMultipart).toHaveBeenCalledWith("video/sess_1/vid_1.webm", "upload_1");
  expect(deleteSessionVideo).toHaveBeenCalledWith("vid_1");
  expect(completeMultipart).not.toHaveBeenCalled();
});

test("completes only the contiguous prefix when a part exhausted its retries", async () => {
  stored(part(1, GRACE * 2), part(2, GRACE * 2), part(4, GRACE * 2), part(5, GRACE * 2));

  await settleUnfinishedVideos("sess_1");

  expect(completeMultipart).toHaveBeenCalledTimes(1);
  expect(completeMultipart.mock.calls[0]![2].map((p) => p.partNumber)).toEqual([1, 2]);
  expect(completeSessionVideo).toHaveBeenCalledWith("vid_1");
});

test("keeps every part of a gapless upload", async () => {
  stored(part(1, GRACE * 2), part(2, GRACE * 2), part(3, GRACE * 2));

  await settleUnfinishedVideos("sess_1");

  expect(completeMultipart.mock.calls[0]![2].map((p) => p.partNumber)).toEqual([1, 2, 3]);
  expect(deleteSessionVideo).not.toHaveBeenCalled();
});

test("aborts rather than completes when the first part is the one missing", async () => {
  stored(part(2, GRACE * 2), part(3, GRACE * 2));

  await settleUnfinishedVideos("sess_1");

  expect(completeMultipart).not.toHaveBeenCalled();
  expect(abortMultipart).toHaveBeenCalledWith("video/sess_1/vid_1.webm", "upload_1");
  expect(deleteSessionVideo).toHaveBeenCalledWith("vid_1");
});
