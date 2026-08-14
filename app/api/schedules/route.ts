import { NextResponse } from "next/server";
import { createSchedule, listSchedules } from "@/lib/db";
export async function GET(){return NextResponse.json(listSchedules());}
export async function POST(req:Request){try{return NextResponse.json(createSchedule(await req.json()),{status:201});}catch(e:any){return NextResponse.json({error:e.message},{status:400});}}
