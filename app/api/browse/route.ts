import { NextResponse } from "next/server";
import { rc } from "@/lib/rclone";

export async function POST(req: Request) {
  try {
    const {path = ""} = await req.json();
    if (typeof path !== "string" || !/^[^:/\\]+:/.test(path)) throw new Error("无效的 rclone 数据源路径");
    const separator = path.indexOf(":");
    const fs = path.slice(0, separator + 1);
    const remote = path.slice(separator + 1).replace(/^\/+/, "");

    // Keep SMB's share/root in fs and send child directories as the separate remote path.
    return NextResponse.json(await rc("operations/list", {fs, remote, opt: {recurse: false}}));
  } catch (e: any) {
    return NextResponse.json({error: e instanceof Error ? e.message : String(e)}, {status: 400});
  }
}
