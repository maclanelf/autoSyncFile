import { listJobs } from "./db";
import { refreshRunningJobs } from "./job-monitor";
import type { SyncJob } from "./types";

type Listener = (jobs: SyncJob[]) => void;

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
  // Check less often while idle so newly created jobs are still discovered.
  timer = setTimeout(() => {
    timer = undefined;
    void tick();
  }, hasRunningJobs() ? 2000 : 15000);
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
