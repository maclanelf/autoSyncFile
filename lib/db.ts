import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type { FileRecord, Remote, SyncJob, TransferFile, TransferStats, SyncSchedule } from "./types";

const file = process.env.DATABASE_PATH || "./data/rclone.sqlite";
fs.mkdirSync(path.dirname(path.resolve(file)), {recursive: true});
const db = new Database(path.resolve(file));
db.pragma("journal_mode = WAL");
db.exec(`CREATE TABLE IF NOT EXISTS remotes (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, type TEXT NOT NULL, config TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, remote_id INTEGER, schedule_id INTEGER, name TEXT, operation TEXT NOT NULL, source TEXT NOT NULL, destination TEXT NOT NULL, status TEXT NOT NULL, rclone_job_id INTEGER, stats_group TEXT, stats TEXT, error TEXT, created_at TEXT NOT NULL, finished_at TEXT);
CREATE TABLE IF NOT EXISTS transfer_files (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL, path TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, error TEXT, started_at TEXT NOT NULL, finished_at TEXT, UNIQUE(job_id, path));
CREATE TABLE IF NOT EXISTS schedules (id INTEGER PRIMARY KEY AUTOINCREMENT, remote_id INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '', operation TEXT NOT NULL, source TEXT NOT NULL, destination TEXT NOT NULL, delete_source INTEGER NOT NULL DEFAULT 0, cron TEXT NOT NULL, start_at TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, last_run_at TEXT, created_at TEXT NOT NULL DEFAULT '');`);
for (const statement of ["ALTER TABLE jobs ADD COLUMN name TEXT", "ALTER TABLE jobs ADD COLUMN stats_group TEXT", "ALTER TABLE jobs ADD COLUMN schedule_id INTEGER", "ALTER TABLE jobs ADD COLUMN delete_source INTEGER NOT NULL DEFAULT 0", "ALTER TABLE schedules ADD COLUMN name TEXT NOT NULL DEFAULT ''", "ALTER TABLE schedules ADD COLUMN delete_source INTEGER NOT NULL DEFAULT 0", "ALTER TABLE schedules ADD COLUMN start_at TEXT NOT NULL DEFAULT ''", "ALTER TABLE schedules ADD COLUMN last_run_at TEXT", "ALTER TABLE schedules ADD COLUMN created_at TEXT NOT NULL DEFAULT ''"]) { try { db.exec(statement); } catch {} }

function normalizeStoredPath(path: string, source: string, destination: string) {
  const locations = [source, destination].map((location) => {
    const separator = location.indexOf(":");
    return {remote: location.slice(0, separator), root: location.slice(separator + 1).replace(/^\/+|\/+$/g, "")};
  });
  let raw = path.replace(/\\/g, "/").replace(/^real\//, "");
  for (const {remote} of locations) {
    if (raw.startsWith(`${remote}:`)) {
      raw = raw.slice(remote.length + 1);
      break;
    }
  }
  raw = raw.replace(/^\/+/, "");
  const roots = locations.map(({root}) => root).filter(Boolean);
  return roots.reduce(
    (current, root) => current === root ? "" : current.startsWith(`${root}/`) ? current.slice(root.length + 1) : current,
    raw,
  );
}

function mergeLegacyTransferFilePaths() {
  const jobs = db.prepare("SELECT id,source,destination FROM jobs").all() as Array<{id: number; source: string; destination: string}>;
  const files = db.prepare("SELECT id,job_id jobId,path,status,bytes FROM transfer_files ORDER BY id").all() as Array<{id: number; jobId: number; path: string; status: string; bytes: number}>;
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const groups = new Map<string, Array<typeof files[number]>>();
  for (const file of files) {
    const job = jobsById.get(file.jobId);
    if (!job) continue;
    const path = normalizeStoredPath(file.path, job.source, job.destination);
    const key = `${file.jobId}\0${path}`;
    groups.set(key, [...(groups.get(key) || []), file]);
  }
  const statusPriority: Record<string, number> = {completed: 4, failed: 3, transferring: 2, queued: 1};
  const transaction = db.transaction(() => {
    for (const [key, duplicates] of groups) {
      const path = key.slice(key.indexOf("\0") + 1);
      const winner = [...duplicates].sort((a, b) => (statusPriority[b.status] || 0) - (statusPriority[a.status] || 0) || b.bytes - a.bytes || a.id - b.id)[0];
      const aliases = duplicates.filter((file) => file.id !== winner.id).map((file) => file.id);
      if (aliases.length) db.prepare(`DELETE FROM transfer_files WHERE id IN (${aliases.map(() => "?").join(",")})`).run(...aliases);
      if (winner.path !== path) db.prepare("UPDATE transfer_files SET path=? WHERE id=?").run(path, winner.id);
    }
  });
  transaction();
}

mergeLegacyTransferFilePaths();

function mapJob(row: any): SyncJob { return {...row, remoteId: row.remote_id, remoteName: row.remoteName, scheduleId: row.schedule_id || undefined, deleteSource: Boolean(row.delete_source), rcloneJobId: row.rclone_job_id || undefined, statsGroup: row.stats_group || `job-${row.id}`, stats: row.stats ? JSON.parse(row.stats) : undefined, createdAt: row.created_at, finishedAt: row.finished_at}; }
export function listRemotes(): Remote[] { return db.prepare("SELECT id,name,type,config,created_at createdAt FROM remotes ORDER BY id DESC").all().map((r: any) => ({...r, config: JSON.parse(r.config)})) as Remote[]; }
export function createRemote(data: Omit<Remote,"id"|"createdAt">) { const now = new Date().toISOString(); const result = db.prepare("INSERT INTO remotes (name,type,config,created_at) VALUES (?,?,?,?)").run(data.name,data.type,JSON.stringify(data.config),now); return {id:Number(result.lastInsertRowid),...data,createdAt:now}; }
export function ensureRemote(name: string, type = "unknown") { const existing = db.prepare("SELECT id,name,type,config,created_at createdAt FROM remotes WHERE name=?").get(name) as any; return existing ? {...existing,config:JSON.parse(existing.config)} as Remote : createRemote({name,type,config:{}}); }
export function updateRemote(id: number, data: Pick<Remote, "type" | "config">) { db.prepare("UPDATE remotes SET type=?,config=? WHERE id=?").run(data.type, JSON.stringify(data.config), id); return getRemote(id); }
export function getRemote(id:number): Remote | undefined { const r:any=db.prepare("SELECT id,name,type,config,created_at createdAt FROM remotes WHERE id=?").get(id); return r&&({...r,config:JSON.parse(r.config)}); }
export function listJobs(): SyncJob[] { return db.prepare("SELECT j.*, r.name remoteName FROM jobs j LEFT JOIN remotes r ON r.id=j.remote_id ORDER BY j.id DESC").all().map(mapJob); }
export function getJob(id: number): SyncJob | undefined { const row = db.prepare("SELECT j.*, r.name remoteName FROM jobs j LEFT JOIN remotes r ON r.id=j.remote_id WHERE j.id=?").get(id); return row ? mapJob(row) : undefined; }
export function createJob(data: {name:string;remoteId?:number;scheduleId?:number;operation:"sync"|"copy";source:string;destination:string;deleteSource?:boolean;statsGroup:string;rcloneJobId?:number}) { const now=new Date().toISOString(); const result=db.prepare("INSERT INTO jobs (remote_id,schedule_id,name,operation,source,destination,delete_source,status,rclone_job_id,stats_group,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(data.remoteId || null,data.scheduleId || null,data.name,data.operation,data.source,data.destination,Number(Boolean(data.deleteSource)),"running",data.rcloneJobId || null,data.statsGroup,now); return getJob(Number(result.lastInsertRowid))!; }
export function getRunningScheduleJob(scheduleId: number) { const row = db.prepare("SELECT j.*, r.name remoteName FROM jobs j LEFT JOIN remotes r ON r.id=j.remote_id WHERE j.schedule_id=? AND j.status='running' ORDER BY j.id DESC LIMIT 1").get(scheduleId); return row ? mapJob(row) : undefined; }
export function listScheduleJobs(scheduleId: number) { return db.prepare("SELECT j.*, r.name remoteName FROM jobs j LEFT JOIN remotes r ON r.id=j.remote_id WHERE j.schedule_id=? ORDER BY j.id DESC LIMIT 20").all(scheduleId).map(mapJob); }
export function updateJob(id:number, patch:{status?:string;stats?:TransferStats;error?:string;finishedAt?:string}) { db.prepare("UPDATE jobs SET status=COALESCE(?,status),stats=COALESCE(?,stats),error=COALESCE(?,error),finished_at=COALESCE(?,finished_at) WHERE id=?").run(patch.status || null,patch.stats ? JSON.stringify(patch.stats) : null,patch.error || null,patch.finishedAt || null,id); return getJob(id); }
export function removeTransferFileAliases(jobId: number, path: string, aliases: string[]) { const duplicates = [...new Set(aliases.filter((alias) => alias && alias !== path))]; if (!duplicates.length) return; db.prepare(`DELETE FROM transfer_files WHERE job_id=? AND path IN (${duplicates.map(() => "?").join(",")})`).run(jobId, ...duplicates); }
export function upsertTransferFile(data: Omit<TransferFile,"id">) { db.prepare("INSERT INTO transfer_files (job_id,path,size,bytes,status,error,started_at,finished_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(job_id,path) DO UPDATE SET size=excluded.size,bytes=CASE WHEN transfer_files.status IN ('completed','failed') THEN transfer_files.bytes ELSE excluded.bytes END,status=CASE WHEN transfer_files.status IN ('completed','failed') THEN transfer_files.status ELSE excluded.status END,error=CASE WHEN transfer_files.status IN ('completed','failed') THEN transfer_files.error ELSE excluded.error END,finished_at=CASE WHEN transfer_files.status IN ('completed','failed') THEN transfer_files.finished_at ELSE excluded.finished_at END").run(data.jobId,data.path,data.size,data.bytes,data.status,data.error || null,data.startedAt,data.finishedAt || null); }
export function completeFullyTransferredFiles(jobId: number, finishedAt: string) { db.prepare("UPDATE transfer_files SET status='completed',finished_at=? WHERE job_id=? AND status='transferring' AND size>0 AND bytes>=size").run(finishedAt, jobId); }
export function listStaleTransferringFiles(jobId: number, before: string, limit = 20) { return db.prepare("SELECT id,job_id jobId,path,size,bytes,status,error,started_at startedAt,finished_at finishedAt FROM transfer_files WHERE job_id=? AND status='transferring' AND started_at<? ORDER BY started_at ASC LIMIT ?").all(jobId, before, limit) as TransferFile[]; }
export function markTransferFileCompleted(id: number, finishedAt: string) { db.prepare("UPDATE transfer_files SET status='completed',bytes=CASE WHEN bytes<size THEN size ELSE bytes END,finished_at=COALESCE(finished_at,?) WHERE id=? AND status='transferring'").run(finishedAt, id); }
export function finalizeTransferFiles(jobId: number, status: "completed" | "failed", finishedAt: string) { db.prepare("UPDATE transfer_files SET status=?,bytes=CASE WHEN ?='completed' AND bytes<size THEN size ELSE bytes END,finished_at=COALESCE(finished_at,?) WHERE job_id=? AND status IN ('queued','transferring')").run(status, status, finishedAt, jobId); }
export function queueTransferFiles(jobId: number, files: Array<{path: string; size: number}>) { const now = new Date().toISOString(); const insert = db.prepare("INSERT INTO transfer_files (job_id,path,size,bytes,status,started_at) VALUES (?,?,?,?,?,?) ON CONFLICT(job_id,path) DO NOTHING"); const transaction = db.transaction(() => files.forEach((file) => insert.run(jobId, file.path, file.size, 0, "queued", now))); transaction(); }
export function listSourceTransferFiles(jobId: number) { return db.prepare("SELECT path,size FROM transfer_files WHERE job_id=? ORDER BY id ASC").all(jobId) as Array<{path: string; size: number}>; }
export function countTransferFiles(jobId: number) { return (db.prepare("SELECT COUNT(*) count FROM transfer_files WHERE job_id=?").get(jobId) as {count: number}).count; }
export function listTransferFiles(jobId: number, state: "transferring" | "finished" | "failed", page = 1, pageSize = 100, search = "") { const statusWhere = state === "transferring" ? "status IN ('queued','transferring')" : state === "failed" ? "status='failed'" : "status='completed'"; const keyword = `%${search.trim()}%`; const where = `WHERE job_id=? AND ${statusWhere} AND path LIKE ?`; const order = state === "transferring" ? "ORDER BY CASE status WHEN 'transferring' THEN 0 ELSE 1 END, id ASC" : "ORDER BY id ASC"; const total = (db.prepare(`SELECT COUNT(*) count FROM transfer_files ${where}`).get(jobId, keyword) as {count:number}).count; const counts = db.prepare("SELECT SUM(CASE WHEN status='transferring' THEN 1 ELSE 0 END) transferring, SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) queued, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) finished, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed FROM transfer_files WHERE job_id=?").get(jobId) as {transferring:number | null;queued:number | null;finished:number | null;failed:number | null}; const files = db.prepare(`SELECT id,job_id jobId,path,size,CASE WHEN status='completed' AND bytes=0 AND size>0 THEN size ELSE bytes END bytes,status,error,started_at startedAt,finished_at finishedAt FROM transfer_files ${where} ${order} LIMIT ? OFFSET ?`).all(jobId,keyword,pageSize,(page - 1) * pageSize) as TransferFile[]; return {files,total,page,pageSize,counts:{transferring:counts.transferring || 0,queued:counts.queued || 0,finished:counts.finished || 0,failed:counts.failed || 0}}; }
export function listFailedTransferFiles(jobId: number, ids?: number[]) { const selection = ids?.length ? ` AND id IN (${ids.map(() => "?").join(",")})` : ""; return db.prepare(`SELECT id,job_id jobId,path,size,bytes,status,error,started_at startedAt,finished_at finishedAt FROM transfer_files WHERE job_id=? AND status='failed'${selection} ORDER BY id ASC`).all(jobId, ...(ids || [])) as TransferFile[]; }
export function listFileRecords(search = "", page = 1, pageSize = 10) { const keyword = `%${search.trim()}%`; const where = "WHERE f.path LIKE ? OR j.name LIKE ? OR s.name LIKE ? OR j.source LIKE ? OR j.destination LIKE ?"; const total = (db.prepare(`SELECT COUNT(*) count FROM transfer_files f JOIN jobs j ON j.id=f.job_id LEFT JOIN schedules s ON s.id=j.schedule_id ${where}`).get(keyword, keyword, keyword, keyword, keyword) as {count: number}).count; const files = db.prepare(`SELECT f.id,f.job_id jobId,f.path,f.size,CASE WHEN f.status='completed' AND f.bytes=0 AND f.size>0 THEN f.size ELSE f.bytes END bytes,f.status,f.error,f.started_at startedAt,f.finished_at finishedAt,j.name jobName,j.operation,j.source,j.destination,j.schedule_id scheduleId,s.name scheduleName FROM transfer_files f JOIN jobs j ON j.id=f.job_id LEFT JOIN schedules s ON s.id=j.schedule_id ${where} ORDER BY COALESCE(f.finished_at,f.started_at) DESC, f.id DESC LIMIT ? OFFSET ?`).all(keyword, keyword, keyword, keyword, keyword, pageSize, (page - 1) * pageSize) as FileRecord[]; return {files, total, page, pageSize}; }
function mapSchedule(row: any): SyncSchedule { return {...row, name: row.name || `定时同步 #${row.id}`, remoteId: row.remote_id, remoteName: row.remoteName, deleteSource: Boolean(row.delete_source), startAt: row.start_at || row.created_at, enabled: Boolean(row.enabled), lastRunAt: row.last_run_at || undefined, createdAt: row.created_at}; }
export function listSchedules(enabledOnly = false): SyncSchedule[] { return db.prepare(`SELECT s.*, r.name remoteName FROM schedules s LEFT JOIN remotes r ON r.id=s.remote_id ${enabledOnly ? "WHERE s.enabled=1" : ""} ORDER BY s.id DESC`).all().map(mapSchedule); }
export function getSchedule(id: number): SyncSchedule | undefined { const row = db.prepare("SELECT s.*, r.name remoteName FROM schedules s LEFT JOIN remotes r ON r.id=s.remote_id WHERE s.id=?").get(id); return row ? mapSchedule(row) : undefined; }
export function createSchedule(data:{remoteId:number;name:string;operation:"sync"|"copy";source:string;destination:string;deleteSource?:boolean;cron:string;startAt:string}) { const now = new Date().toISOString(); const result = db.prepare("INSERT INTO schedules (remote_id,name,operation,source,destination,delete_source,cron,start_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(data.remoteId,data.name,data.operation,data.source,data.destination,Number(Boolean(data.deleteSource)),data.cron,data.startAt,now); return getSchedule(Number(result.lastInsertRowid))!; }
export function updateSchedule(id: number, patch: {name?: string; operation?: "sync" | "copy"; source?: string; destination?: string; deleteSource?: boolean; cron?: string; startAt?: string; enabled?: boolean; lastRunAt?: string}) { db.prepare("UPDATE schedules SET name=COALESCE(?,name),operation=COALESCE(?,operation),source=COALESCE(?,source),destination=COALESCE(?,destination),delete_source=COALESCE(?,delete_source),cron=COALESCE(?,cron),start_at=COALESCE(?,start_at),enabled=COALESCE(?,enabled),last_run_at=COALESCE(?,last_run_at) WHERE id=?").run(patch.name ?? null, patch.operation ?? null, patch.source ?? null, patch.destination ?? null, patch.deleteSource === undefined ? null : Number(patch.deleteSource), patch.cron ?? null, patch.startAt ?? null, patch.enabled === undefined ? null : Number(patch.enabled), patch.lastRunAt || null, id); return getSchedule(id); }
export function deleteSchedule(id: number) { return db.prepare("DELETE FROM schedules WHERE id=?").run(id).changes > 0; }
