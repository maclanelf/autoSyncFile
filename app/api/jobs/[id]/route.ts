import { NextResponse } from "next/server";
import { getJob, listTransferFiles, updateJob, upsertTransferFile } from "@/lib/db";
import { rc } from "@/lib/rclone";

type RcloneTransfer = {name?: string; size?: number; bytes?: number; error?: string; startedAt?: string; completedAt?: string};
function statsFor(result: any) { return {bytes: result.bytes, totalBytes: result.totalBytes, transfers: result.transfers, totalTransfers: result.totalTransfers, speed: result.speed, eta: result.eta, errors: result.errors}; }
async function refresh(jobId: number) {
  const job = getJob(jobId);
  if (!job) throw new Error("未找到任务记录");
  if (job.status !== "running" || !job.rcloneJobId) return job;
  const [status, stats, transferred] = await Promise.all([rc<any>("job/status", {jobid: job.rcloneJobId}), rc<any>("core/stats", {group: job.statsGroup}), rc<any>("core/transferred", {group: job.statsGroup})]);
  const now = new Date().toISOString();
  for (const item of (transferred.transferred || []) as RcloneTransfer[]) {
    if (!item.name) continue;
    upsertTransferFile({jobId, path: item.name, size: item.size || 0, bytes: item.error ? (item.bytes || 0) : (item.size || item.bytes || 0), status: item.error ? "failed" : "completed", error: item.error, startedAt: item.startedAt || now, finishedAt: item.completedAt || now});
  }
  for (const item of (stats.transferring || []) as RcloneTransfer[]) {
    if (!item.name) continue;
    upsertTransferFile({jobId, path: item.name, size: item.size || 0, bytes: item.bytes || 0, status: "transferring", startedAt: item.startedAt || now});
  }
  const nextStatus = status.finished ? (status.success ? "completed" : "failed") : "running";
  return updateJob(jobId, {status: nextStatus, stats: statsFor(stats), error: status.error, finishedAt: status.finished ? now : undefined});
}
export async function GET(request: Request, {params}: {params: Promise<{id: string}>}) { try { const {id} = await params; const job = await refresh(Number(id)); const query = new URL(request.url).searchParams; const state = query.get("state") === "finished" ? "finished" : "transferring"; const page = Math.max(1, Number(query.get("page")) || 1); return NextResponse.json({...job, ...listTransferFiles(Number(id), state, page)}); } catch (error) { return NextResponse.json({error: error instanceof Error ? error.message : String(error)}, {status: 502}); } }
export async function DELETE(_: Request, {params}: {params: Promise<{id: string}>}) { try { const {id} = await params; const job = getJob(Number(id)); if (!job?.rcloneJobId || job.status !== "running") throw new Error("任务不可取消"); await rc("job/stop", {jobid: job.rcloneJobId}); updateJob(job.id, {status: "cancelled", finishedAt: new Date().toISOString()}); return NextResponse.json({ok: true}); } catch (error) { return NextResponse.json({error: error instanceof Error ? error.message : String(error)}, {status: 400}); } }
