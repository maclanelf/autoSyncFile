import { NextResponse } from "next/server";
import { runDueSchedules, startScheduler } from "@/lib/scheduler";
export async function POST() { startScheduler(); return NextResponse.json(await runDueSchedules()); }
