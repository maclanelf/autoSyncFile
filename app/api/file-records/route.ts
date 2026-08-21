import { NextResponse } from "next/server";
import { listFileRecords } from "@/lib/db";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const page = Math.max(1, Number(query.get("page")) || 1);
  return NextResponse.json(listFileRecords(query.get("search") || "", page));
}
