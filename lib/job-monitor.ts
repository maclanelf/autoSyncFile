import { completeFullyTransferredFiles, countTransferFiles, finalizeTransferFiles, getJob, listJobs, listStaleTransferringFiles, markTransferFileCompleted, queueTransferFiles, updateJob, upsertTransferFile } from "./db";
import { isMissingJobError, listSourceFiles, rc } from "./rclone";

type RcloneTransfer = {name?: string; size?: number; bytes?: number; error?: string; startedAt?: string; completedAt?: string};

function statsFor(result: any) { return {bytes: result.bytes, totalBytes: result.totalBytes, transfers: result.transfers, totalTransfers: result.totalTransfers, speed: result.speed, eta: result.eta, errors: result.errors}; }

export async function refreshJob(jobId: number) {
  const job = getJob(jobId);
  if (!job) throw new Error("未找到任务记录");
  if (job.status !== "running" || !job.rcloneJobId) return job;
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

export async function refreshRunningJobs() {
  await Promise.allSettled(listJobs().filter((job) => job.status === "running").map((job) => refreshJob(job.id)));
}
