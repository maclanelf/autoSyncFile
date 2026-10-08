import { listJobs } from "./db";
import { refreshRunningJobs } from "./job-monitor";
const ACTIVE_REFRESH_INTERVAL_MS = 2_000;
const IDLE_REFRESH_INTERVAL_MS = 15_000;

let timer: ReturnType<typeof setTimeout> | undefined;
let refreshing = false;

function hasRunningJobs() {
  return listJobs().some((job) => job.status === "running" || job.status === "deleting_source");
}

async function tick() {
  if (refreshing) return;
  refreshing = true;
  try {
    await refreshRunningJobs();
  } finally {
    refreshing = false;
    schedule();
  }
}

function schedule() {
  if (timer) return;
  // Poll active rclone transfers every two seconds; never schedule another poll
  // until the current one completes, preventing slow RC calls from overlapping.
  timer = setTimeout(() => {
    timer = undefined;
    void tick();
  }, hasRunningJobs() ? ACTIVE_REFRESH_INTERVAL_MS : IDLE_REFRESH_INTERVAL_MS);
}

export function startTaskMonitor() {
  schedule();
}
