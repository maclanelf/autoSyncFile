export type RemoteType = string;
export type JobStatus = "running" | "completed" | "failed" | "cancelled" | "unknown";
export interface Remote { id: number; name: string; type: RemoteType; config: Record<string, string>; createdAt: string; }
export interface TransferStats { bytes?: number; totalBytes?: number; transfers?: number; totalTransfers?: number; speed?: number; eta?: number; errors?: number; }
export interface SyncJob { id: number; name: string; remoteName?: string; operation: "sync" | "copy"; source: string; destination: string; status: JobStatus; rcloneJobId?: number; statsGroup: string; stats?: TransferStats; files?: TransferFile[]; error?: string; createdAt: string; finishedAt?: string; }
export interface TransferFile { id: number; jobId: number; path: string; size: number; bytes: number; status: "transferring" | "completed" | "failed"; error?: string; startedAt: string; finishedAt?: string; }
