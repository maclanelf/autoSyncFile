import { createJob, getRunningScheduleJob, listSchedules, queueTransferFiles, updateJob, updateSchedule } from "./db";
import { refreshJob, refreshRunningJobs } from "./job-monitor";
import { isMissingJobError, listSourceFiles, rc, startTransfer } from "./rclone";
import { startTaskMonitor } from "./task-monitor";
import type { SyncSchedule } from "./types";
import { cronMatches } from "./cron";

let timer: ReturnType<typeof setInterval> | undefined;
let starting = false;
let running = false;

function matchesPart(expression: string, value: number, min: number, max: number) {
  return expression.split(",").some((part) => {
    const [range, stepText] = part.split("/");
    const step = stepText ? Number(stepText) : 1;
    if (!Number.isInteger(step) || step < 1) return false;
    const [startText, endText] = range === "*" ? [String(min), String(max)] : range.split("-");
    const start = Number(startText);
    const end = endText === undefined ? start : Number(endText);
    return Number.isInteger(start) && Number.isInteger(end) && start >= min && end <= max && value >= start && value <= end && (value - start) % step === 0;
  });
}

export function isValidCron(cron: string) {
  const parts = cron.trim().split(/\s+/);
  return parts.length === 5 && [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]].every(([min, max], index) => isValidPart(parts[index], min, max));
}

function isValidPart(expression: string, min: number, max: number) {
  return expression.split(",").every((part) => {
    const [range, stepText] = part.split("/");
    if (part.split("/").length > 2 || (stepText !== undefined && (!/^\d+$/.test(stepText) || Number(stepText) < 1))) return false;
    if (range === "*") return true;
    const [startText, endText] = range.split("-");
    if (range.split("-").length > 2 || !/^\d+$/.test(startText) || (endText !== undefined && !/^\d+$/.test(endText))) return false;
    const start = Number(startText);
    const end = endText === undefined ? start : Number(endText);
    return start >= min && end <= max && start <= end;
  });
}

export async function runScheduleNow(schedule: SyncSchedule) {
  const now = new Date().toISOString();
  updateSchedule(schedule.id, {lastRunAt: now});
  const previousJob = getRunningScheduleJob(schedule.id);
  if (previousJob) {
    if (previousJob.status === "deleting_source") {
      return {status: "skipped" as const, reason: "上一次同步仍在删除源文件，本次定时执行已跳过"};
    }
    try {
      const status = await rc<{finished?: boolean; success?: boolean; error?: string}>("job/status", {jobid: previousJob.rcloneJobId});
      if (!status.finished) return {status: "skipped" as const, reason: "上一次同步任务尚未完成，本次定时执行已跳过"};
      await refreshJob(previousJob.id);
    } catch (error) {
      if (isMissingJobError(error)) {
        updateJob(previousJob.id, {status: "failed", error: "rclone 任务已不存在，同步状态无法确认，该同步已中断", finishedAt: now});
      } else {
        return {status: "skipped" as const, reason: "无法确认上一次同步任务是否完成，本次定时执行已跳过"};
      }
    }
  }
  const sourceFiles = await listSourceFiles(schedule.source);
  const statsGroup = `schedule-${schedule.id}-${crypto.randomUUID()}`;
  const result = await startTransfer(schedule.operation, schedule.source, schedule.destination, statsGroup);
  const job = createJob({name: `${schedule.name}（定时）`, remoteId: schedule.remoteId, scheduleId: schedule.id, operation: schedule.operation, source: schedule.source, destination: schedule.destination, deleteSource: schedule.deleteSource, statsGroup, rcloneJobId: result.jobid, rcloneExecuteId: result.executeId});
  queueTransferFiles(job.id, sourceFiles);
  return job;
}

export async function runScheduleById(schedule: SyncSchedule) {
  return runScheduleNow(schedule);
}

export async function runDueSchedules(now = new Date()) {
  if (running) return [];
  running = true;
  try {
    const minute = Math.floor(now.getTime() / 60000);
    const due = listSchedules(true).filter((schedule) => new Date(schedule.startAt).getTime() <= now.getTime() && cronMatches(schedule.cron, now, schedule.startAt) && Math.floor(new Date(schedule.lastRunAt || 0).getTime() / 60000) !== minute);
    return await Promise.all(due.map(async (schedule) => {
      try { const result = await runScheduleNow(schedule); return {scheduleId: schedule.id, jobId: "id" in result ? result.id : undefined, skipped: result.status === "skipped"}; }
      catch (error) { return {scheduleId: schedule.id, error: error instanceof Error ? error.message : String(error)}; }
    }));
  } finally { running = false; }
}

export function startScheduler() {
  if (timer || starting) return;
  starting = true;
  void refreshRunningJobs();
  startTaskMonitor();
  void runDueSchedules();
  const delay = 60000 - (Date.now() % 60000) + 50;
  setTimeout(() => { void runDueSchedules(); timer = setInterval(() => void runDueSchedules(), 60000); starting = false; }, delay);
}
