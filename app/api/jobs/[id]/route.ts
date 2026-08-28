import { NextResponse } from "next/server";
import { completeFullyTransferredFiles, countTransferFiles, createJob, ensureRemote, finalizeTransferFiles, getJob, listFailedTransferFiles, listStaleTransferringFiles, listTransferFiles, markTransferFileCompleted, queueTransferFiles, updateJob, upsertTransferFile } from "@/lib/db";
import { isMissingJobError, listSourceFiles, rc, startTransfer } from "@/lib/rclone";
import { z } from "zod";

type RcloneTransfer = {name?: string; size?: number; bytes?: number; error?: string; startedAt?: string; completedAt?: string};
function statsFor(result: any) { return {bytes: result.bytes, totalBytes: result.totalBytes, transfers: result.transfers, totalTransfers: result.totalTransfers, speed: result.speed, eta: result.eta, errors: result.errors}; }
async function refresh(jobId: number) {
  const job = getJob(jobId);
  if (!job) throw new Error("未找到任务记录");
  if (job.status !== "running" || !job.rcloneJobId) return job;
  // Backfill tasks created before recursive queue discovery was fixed.
  if (countTransferFiles(jobId) <= 4) queueTransferFiles(jobId, await listSourceFiles(job.source));
  let status: any;
  let stats: any;
  let transferred: any;
  try {
    [status, stats, transferred] = await Promise.all([rc<any>("job/status", {jobid: job.rcloneJobId}), rc<any>("core/stats", {group: job.statsGroup}), rc<any>("core/transferred", {group: job.statsGroup})]);
  } catch (error) {
    if (!isMissingJobError(error)) throw error;
    return updateJob(jobId, {status: "failed", error: "rclone 重启后未找到任务，该同步已中断", finishedAt: new Date().toISOString()});
  }
  const now = new Date().toISOString();
  for (const item of (transferred.transferred || []) as RcloneTransfer[]) {
    if (!item.name) continue;
    upsertTransferFile({jobId, path: item.name, size: item.size || 0, bytes: item.error ? (item.bytes || 0) : (item.size || item.bytes || 0), status: item.error ? "failed" : "completed", error: item.error, startedAt: item.startedAt || now, finishedAt: item.completedAt || now});
  }
  for (const item of (stats.transferring || []) as RcloneTransfer[]) {
    if (!item.name) continue;
    const size = item.size || 0;
    const bytes = item.bytes || 0;
    const completed = Boolean(item.completedAt) || (size > 0 && bytes >= size);
    upsertTransferFile({jobId, path: item.name, size, bytes, status: completed ? "completed" : "transferring", startedAt: item.startedAt || now, finishedAt: completed ? (item.completedAt || now) : undefined});
  }
  completeFullyTransferredFiles(jobId, now);
  // rclone removes completed files from both snapshots. Verify a bounded number
  // of old database entries against the destination to close that gap safely.
  const separator = job.destination.indexOf(":");
  if (separator >= 0) {
    const fs = job.destination.slice(0, separator + 1);
    const root = job.destination.slice(separator + 1).replace(/^\/+/, "").replace(/\/+$/, "");
    const activePaths = new Set((stats.transferring || []).map((item: RcloneTransfer) => item.name));
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    for (const file of listStaleTransferringFiles(jobId, cutoff)) {
      if (activePaths.has(file.path) || activePaths.has(file.path.replace(/^real\//, ""))) continue;
      const result = await rc<any>("operations/stat", {fs, remote: `${root}/${file.path.replace(/^real\//, "")}`}).catch(() => null);
      if (result && Number(result.Size) === file.size) markTransferFileCompleted(file.id, now);
    }
  }
  const nextStatus = status.finished ? (status.success ? "completed" : "failed") : "running";
  if (status.finished) finalizeTransferFiles(jobId, status.success ? "completed" : "failed", now);
  return updateJob(jobId, {status: nextStatus, stats: statsFor(stats), error: status.error, finishedAt: status.finished ? now : undefined});
}
export async function GET(request: Request, {params}: {params: Promise<{id: string}>}) { try { const {id} = await params; const job = await refresh(Number(id)); const query = new URL(request.url).searchParams; const requestedState = query.get("state"); const state = requestedState === "finished" || requestedState === "failed" ? requestedState : "transferring"; const page = Math.max(1, Number(query.get("page")) || 1); return NextResponse.json({...job, ...listTransferFiles(Number(id), state, page)}); } catch (error) { return NextResponse.json({error: error instanceof Error ? error.message : String(error)}, {status: 502}); } }
export async function POST(request: Request, {params}: {params: Promise<{id: string}>}) { try { const {id} = await params; const job = getJob(Number(id)); if (!job) throw new Error("未找到任务记录"); const {fileIds} = z.object({fileIds: z.array(z.number().int().positive()).min(1).optional()}).parse(await request.json()); const files = listFailedTransferFiles(job.id, fileIds); if (!files.length) throw new Error("没有可重试的失败文件"); const statsGroup = `sync-${crypto.randomUUID()}`; const result = await startTransfer(job.operation, job.source, job.destination, statsGroup, files.map((file) => file.path)); const remoteId = ensureRemote(job.source.split(":", 1)[0]).id; const retry = createJob({name: `${job.name}（重试）`, remoteId, operation: job.operation, source: job.source, destination: job.destination, statsGroup, rcloneJobId: result.jobid}); queueTransferFiles(retry.id, files.map(({path, size}) => ({path, size}))); return NextResponse.json(retry, {status: 201}); } catch (error) { return NextResponse.json({error: error instanceof Error ? error.message : String(error)}, {status: 400}); } }
export async function DELETE(_: Request, {params}: {params: Promise<{id: string}>}) { try { const {id} = await params; const job = getJob(Number(id)); if (!job?.rcloneJobId || job.status !== "running") throw new Error("任务不可取消"); await rc("job/stop", {jobid: job.rcloneJobId}); updateJob(job.id, {status: "cancelled", finishedAt: new Date().toISOString()}); return NextResponse.json({ok: true}); } catch (error) { return NextResponse.json({error: error instanceof Error ? error.message : String(error)}, {status: 400}); } }
