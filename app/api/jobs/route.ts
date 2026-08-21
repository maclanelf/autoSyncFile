import { NextResponse } from "next/server";
import { createJob, ensureRemote, listJobs, queueTransferFiles } from "@/lib/db";
import { listSourceFiles, startTransfer } from "@/lib/rclone";
import { z } from "zod";

const remotePath = z.string().trim().regex(/^[^:/\\]+:.+/, "请先选择存储和目录");
const schema = z.object({name: z.string().trim().min(1).max(120), operation: z.enum(["sync", "copy"]), source: remotePath, destination: remotePath});

export async function GET() { return NextResponse.json(listJobs()); }
export async function POST(req: Request) {
  try {
    const input = schema.parse(await req.json());
    const statsGroup = `sync-${crypto.randomUUID()}`;
    const result = await startTransfer(input.operation, input.source, input.destination, statsGroup);
    const remoteId = ensureRemote(input.source.split(":", 1)[0]).id;
    const job = createJob({...input, remoteId, statsGroup, rcloneJobId: result.jobid});
    queueTransferFiles(job.id, await listSourceFiles(input.source));
    return NextResponse.json(job, {status: 201});
  } catch (error) { return NextResponse.json({error: error instanceof Error ? error.message : String(error)}, {status: 400}); }
}
