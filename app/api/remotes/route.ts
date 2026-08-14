import { NextResponse } from "next/server";
import { createConfig, deleteConfig, rc, updateConfig } from "@/lib/rclone";
import { z } from "zod";
const schema = z.object({
  name: z.string().trim().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "数据源名称仅支持字母、数字、点、下划线和连字符"),
  type: z.enum(["webdav", "smb", "ftp", "sftp", "local"]),
  config: z.record(z.string(), z.string()),
});
type RcloneConfig = Record<string, Record<string, string>>;

function sourceList(configs: RcloneConfig) {
  return Object.entries(configs).map(([name, config], index) => ({
    id: index + 1,
    name,
    type: config.type || "unknown",
    config,
    createdAt: "",
  }));
}
export async function GET(){
  try { return NextResponse.json(sourceList(await rc<RcloneConfig>("config/dump"))); }
  catch (e: any) { return NextResponse.json({error: e instanceof Error ? e.message : String(e)}, {status: 502}); }
}
export async function POST(req:Request){try{const data=schema.parse(await req.json());const config=Object.fromEntries(Object.entries(data.config).filter(([,value])=>value.trim()!==""));await createConfig(data.name,data.type,config);return NextResponse.json({id:0,...data,config,createdAt:""},{status:201});}catch(e:any){return NextResponse.json({error:e instanceof Error?e.message:String(e)},{status:400});}}
export async function PATCH(req: Request) {
  try {
    const { id: _id, ...raw } = await req.json();
    const data = schema.parse(raw);
    const configs = await rc<RcloneConfig>("config/dump");
    if (!configs[data.name]) return NextResponse.json({error: "未在 rclone 中找到该数据源"}, {status: 404});
    const config = Object.fromEntries(Object.entries(data.config).filter(([, value]) => value.trim() !== ""));
    await updateConfig(data.name, config);
    return NextResponse.json({id: 0, ...data, config, createdAt: ""});
  } catch (e: any) { return NextResponse.json({error: e instanceof Error ? e.message : String(e)}, {status: 400}); }
}
export async function DELETE(req: Request) {
  try {
    const {name} = await req.json();
    if (typeof name !== "string" || !name) throw new Error("缺少数据源名称");
    await deleteConfig(name);
    return NextResponse.json({ok: true});
  } catch (e: any) { return NextResponse.json({error: e instanceof Error ? e.message : String(e)}, {status: 400}); }
}
