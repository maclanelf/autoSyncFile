import { listJobs } from "./db";
import { refreshRunningJobs } from "./job-monitor";
import type { SyncJob } from "./types";

type Listener = (jobs: SyncJob[]) => void;

const ACTIVE_REFRESH_INTERVAL_MS = 500;
const IDLE_REFRESH_INTERVAL_MS = 15_000;

const listeners = new Set<Listener>();
let timer: ReturnType<typeof setTimeout> | undefined;
let refreshing = false;
let lastSnapshot = "";

function hasRunningJobs() {
  return listJobs().some((job) => job.status === "running");
}

async function tick() {
  if (refreshing) return;
  refreshing = true;
  try {
    await refreshRunningJobs();
    const jobs = listJobs();
    const snapshot = JSON.stringify(jobs);
    if (snapshot !== lastSnapshot) {
      lastSnapshot = snapshot;
      for (const listener of listeners) listener(jobs);
    }
  } finally {
    refreshing = false;
    schedule();
  }
}

function schedule() {
  if (timer) return;
  // Poll active rclone transfers twice per second; never schedule another poll
  // until the current one completes, preventing slow RC calls from overlapping.
  timer = setTimeout(() => {
    timer = undefined;
    void tick();
  }, hasRunningJobs() ? ACTIVE_REFRESH_INTERVAL_MS : IDLE_REFRESH_INTERVAL_MS);
}

export function startTaskMonitor() {
  if (!lastSnapshot) {
    lastSnapshot = JSON.stringify(listJobs());
  }
  schedule();
}

export function subscribeToTaskUpdates(listener: Listener) {
  listeners.add(listener);
  listener(listJobs());
  startTaskMonitor();
  return () => listeners.delete(listener);
}
