import { NextResponse } from "next/server";
import { createConfig, deleteConfig, rc } from "@/lib/rclone";
import { z } from "zod";

const schema = z.object({
  type: z.enum(["webdav", "smb", "ftp", "sftp", "local"]),
  config: z.record(z.string(), z.string()),
});

export async function POST(req: Request) {
  let testName = "";
  try {
    const data = schema.parse(await req.json());
    const config = Object.fromEntries(
      Object.entries(data.config).filter(([, value]) => value.trim() !== ""),
    );
    testName = `__autosync_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await createConfig(testName, data.type, config);
    await rc("operations/list", {
      fs: `${testName}:`,
      remote: "",
      opt: { recurse: false },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  } finally {
    if (testName) await deleteConfig(testName).catch(() => undefined);
  }
}
