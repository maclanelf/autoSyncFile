import { NextResponse } from "next/server";
import { getSchedule, listScheduleJobs } from "@/lib/db";
import { runScheduleById } from "@/lib/scheduler";

export async function GET(_: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const schedule = getSchedule(Number((await params).id));
    if (!schedule) return NextResponse.json({error: "未找到定时任务"}, {status: 404});
    return NextResponse.json({schedule, jobs: listScheduleJobs(schedule.id)});
  } catch (error) { return NextResponse.json({error: error instanceof Error ? error.message : String(error)}, {status: 400}); }
}

export async function POST(_: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const schedule = getSchedule(Number((await params).id));
    if (!schedule) return NextResponse.json({error: "未找到定时任务"}, {status: 404});
    const job = await runScheduleById(schedule);
    return NextResponse.json(job, {status: 201});
  } catch (error) { return NextResponse.json({error: error instanceof Error ? error.message : String(error)}, {status: 400}); }
}
