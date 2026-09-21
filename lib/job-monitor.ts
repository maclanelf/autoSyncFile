import { completeFullyTransferredFiles, countTransferFiles, finalizeTransferFiles, getJob, listJobs, listSourceTransferFiles, listStaleTransferringFiles, markTransferFileCompleted, queueTransferFiles, removeTransferFileAliases, updateJob, upsertTransferFile } from "./db";
import { deleteSourceFiles, isMissingJobError, listSourceFiles, rc } from "./rclone";

type RcloneTransfer = {name?: string; size?: number; bytes?: number; error?: string; startedAt?: string; completedAt?: string};

function statsFor(result: any) { return {bytes: result.bytes, totalBytes: result.totalBytes, transfers: result.transfers, totalTransfers: result.totalTransfers, speed: result.speed, eta: result.eta, errors: result.errors}; }

function remoteRoot(remotePath: string) {
  const separator = remotePath.indexOf(":");
  return separator < 0 ? "" : remotePath.slice(separator + 1).replace(/^\/+|\/+$/g, "");
}

function normalizeTransferPath(path: string, job: NonNullable<ReturnType<typeof getJob>>) {
  const remotes = [job.source, job.destination]
    .map((location) => location.slice(0, location.indexOf(":")))
    .filter(Boolean);
  let raw = path.replace(/\\/g, "/").replace(/^real\//, "");
  for (const remote of remotes) {
    if (raw.startsWith(`${remote}:`)) {
      raw = raw.slice(remote.length + 1);
      break;
    }
  }
  raw = raw.replace(/^\/+/, "");
  const withoutReal = raw.replace(/^real\//, "");
  const roots = [remoteRoot(job.source), remoteRoot(job.destination)].filter(Boolean);
  const normalized = roots.reduce(
    (current, root) => current === root ? "" : current.startsWith(`${root}/`) ? current.slice(root.length + 1) : current,
    withoutReal,
  );
  const aliases = [path, raw, withoutReal, ...roots.flatMap((root) => [
    `${root}/${normalized}`,
    ...remotes.map((remote) => `${remote}:/${root}/${normalized}`),
  ])];
  return {path: normalized, aliases: [...new Set(aliases)]};
}

function recordTransferFile(job: NonNullable<ReturnType<typeof getJob>>, item: RcloneTransfer, data: Omit<Parameters<typeof upsertTransferFile>[0], "jobId" | "path">) {
  if (!item.name) return;
  const normalized = normalizeTransferPath(item.name, job);
  removeTransferFileAliases(job.id, normalized.path, normalized.aliases);
  upsertTransferFile({jobId: job.id, path: normalized.path, ...data});
}

export async function refreshJob(jobId: number) {
  const job = getJob(jobId);
  if (!job) throw new Error("未找到任务记录");
  if (job.status === "deleting_source") return finishSourceDeletion(job);
  if (job.status !== "running" || !job.rcloneJobId) return job;
  if (countTransferFiles(jobId) <= 4) queueTransferFiles(jobId, await listSourceFiles(job.source));
  let status: any;
  try {
    // The job status is authoritative. Statistics endpoints can briefly fail or
    // reset after completion, but that must not prevent the job from finishing.
    status = await rc<any>("job/status", {jobid: job.rcloneJobId});
  } catch (error) {
    if (!isMissingJobError(error)) throw error;
    return updateJob(jobId, {status: "failed", error: "rclone 重启后未找到任务，该同步已中断", finishedAt: new Date().toISOString()});
  }
  const [statsResult, transferredResult] = await Promise.allSettled([
    rc<any>("core/stats", {group: job.statsGroup}),
    rc<any>("core/transferred", {group: job.statsGroup}),
  ]);
  const stats = statsResult.status === "fulfilled" ? statsResult.value : undefined;
  const transferred = transferredResult.status === "fulfilled" ? transferredResult.value : undefined;
  const now = new Date().toISOString();
  for (const item of (transferred?.transferred || []) as RcloneTransfer[]) {
    if (!item.name) continue;
    recordTransferFile(job, item, {size: item.size || 0, bytes: item.error ? (item.bytes || 0) : (item.size || item.bytes || 0), status: item.error ? "failed" : "completed", error: item.error, startedAt: item.startedAt || now, finishedAt: item.completedAt || now});
  }
  for (const item of (stats?.transferring || []) as RcloneTransfer[]) {
    if (!item.name) continue;
    const size = item.size || 0;
    const bytes = item.bytes || 0;
    const completed = Boolean(item.completedAt) || (size > 0 && bytes >= size);
    recordTransferFile(job, item, {size, bytes, status: completed ? "completed" : "transferring", startedAt: item.startedAt || now, finishedAt: completed ? (item.completedAt || now) : undefined});
  }
  completeFullyTransferredFiles(jobId, now);
  const separator = job.destination.indexOf(":");
  if (separator >= 0) {
    const fs = job.destination.slice(0, separator + 1);
    const root = job.destination.slice(separator + 1).replace(/^\/+/, "").replace(/\/+$/, "");
    const activePaths = new Set((stats?.transferring || []).flatMap((item: RcloneTransfer) => item.name ? [normalizeTransferPath(item.name, job).path, item.name] : []));
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    for (const file of listStaleTransferringFiles(jobId, cutoff)) {
      if (activePaths.has(file.path) || activePaths.has(file.path.replace(/^real\//, ""))) continue;
      const result = await rc<any>("operations/stat", {fs, remote: `${root}/${file.path.replace(/^real\//, "")}`}).catch(() => null);
      if (result && Number(result.Size) === file.size) markTransferFileCompleted(file.id, now);
    }
  }
  const nextStatus = status.finished ? (status.success ? "completed" : "failed") : "running";
  if (status.finished) {
    finalizeTransferFiles(jobId, status.success ? "completed" : "failed", now);
    if (status.success && job.deleteSource) {
      updateJob(jobId, {status: "deleting_source", ...(stats ? {stats: statsFor(stats)} : {}), finishedAt: now});
      return finishSourceDeletion(job);
    }
  }
  return updateJob(jobId, {status: nextStatus, ...(stats ? {stats: statsFor(stats)} : {}), error: status.error, finishedAt: status.finished ? now : undefined});
}

async function finishSourceDeletion(job: ReturnType<typeof getJob> & {}) {
  if (!job) throw new Error("未找到任务记录");
  const now = new Date().toISOString();
  try {
    await deleteSourceFiles(job.source, listSourceTransferFiles(job.id));
    return updateJob(job.id, {status: "completed", finishedAt: now});
  } catch (deleteError) {
    return updateJob(job.id, {status: "failed", error: `同步已完成，但删除源文件失败：${deleteError instanceof Error ? deleteError.message : String(deleteError)}`, finishedAt: now});
  }
}

let monitoring = false;

export async function refreshRunningJobs() {
  if (monitoring) return;
  monitoring = true;
  try {
    await Promise.allSettled(listJobs().filter((job) => job.status === "running" || job.status === "deleting_source").map((job) => refreshJob(job.id)));
  } finally {
    monitoring = false;
  }
}
