import { NextResponse } from "next/server";
import { listSchedules, createJob } from "@/lib/db";
import { startTransfer } from "@/lib/rclone";
export async function POST(){const results=[];for(const schedule of listSchedules() as any[]){try{const statsGroup=`sync-${crypto.randomUUID()}`;const result=await startTransfer(schedule.operation,schedule.source,schedule.destination,statsGroup);const job=createJob({name:`定时同步 #${schedule.id}`,remoteId:schedule.remote_id,operation:schedule.operation,source:schedule.source,destination:schedule.destination,statsGroup,rcloneJobId:result.jobid});results.push({scheduleId:schedule.id,jobId:job.id});}catch(error){results.push({scheduleId:schedule.id,error:String(error)})}}return NextResponse.json(results);}
