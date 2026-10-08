import { listJobs } from "./db";
import { refreshRunningJobs } from "./job-monitor";
import type { SyncJob } from "./types";

type Listener = (jobs: SyncJob[]) => void;

const ACTIVE_REFRESH_INTERVAL_MS = 500;
const IDLE_REFRESH_INTERVAL_MS = 15_000;

type Subscriber = {
  listener: Listener;
  canAcceptUpdate: () => boolean;
};

const subscribers = new Set<Subscriber>();
let timer: ReturnType<typeof setTimeout> | undefined;
let refreshing = false;
let lastSnapshot = "";

function hasRunningJobs() {
  return listJobs().some((job) => job.status === "running" || job.status === "deleting_source");
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
      for (const subscriber of subscribers) {
        // Skip stale updates for slow SSE clients instead of retaining them in
        // the stream queue until the Node heap is exhausted.
        if (subscriber.canAcceptUpdate()) subscriber.listener(jobs);
      }
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

export function subscribeToTaskUpdates(listener: Listener, canAcceptUpdate = () => true) {
  const subscriber = {listener, canAcceptUpdate};
  subscribers.add(subscriber);
  if (canAcceptUpdate()) listener(listJobs());
  startTaskMonitor();
  return () => subscribers.delete(subscriber);
}
