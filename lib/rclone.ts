const base = process.env.RCLONE_RC_URL || "http://127.0.0.1:5572";
export async function rc<T=any>(endpoint:string, body:Record<string,unknown>={}) : Promise<T> { const headers:Record<string,string>={"content-type":"application/json"}; if(process.env.RCLONE_RC_USER) headers.authorization="Basic "+Buffer.from(`${process.env.RCLONE_RC_USER}:${process.env.RCLONE_RC_PASS||""}`).toString("base64"); const res=await fetch(`${base}/${endpoint}`,{method:"POST",headers,body:JSON.stringify(body)}); const data=await res.json().catch(()=>({})); if(!res.ok || data.error) throw new Error(data.error||`rclone RC ${res.status}`); return data; }
export async function startTransfer(operation:"sync" | "copy", source:string, destination:string, statsGroup: string) {
  return rc<{jobid:number}>(`sync/${operation}`, {srcFs: source, dstFs: destination, _group: statsGroup, _async: true});
}
export async function listSourceFiles(source: string) {
  const separator = source.indexOf(":");
  const fs = separator < 0 ? source : source.slice(0, separator + 1);
  const remote = separator < 0 ? "" : source.slice(separator + 1).replace(/^\/+/, "");
  const result = await rc<{list?: Array<{Path?: string; Name?: string; Size?: number; IsDir?: boolean}>}>("operations/list", {fs, remote, opt: {recurse: true}});
  return (result.list || []).filter((entry) => !entry.IsDir && (entry.Path || entry.Name)).map((entry) => ({path: entry.Path || entry.Name!, size: entry.Size || 0}));
}
export async function createConfig(name:string, type:string, config:Record<string,string>) {
  const parameters = {...config};
  delete parameters.name;
  delete parameters.type;
  return rc(`config/create`, {name, type, parameters, obscure: true});
}
export async function updateConfig(name: string, config: Record<string, string>) {
  return rc("config/update", {name, parameters: config, obscure: true});
}
export async function deleteConfig(name: string) {
  return rc("config/delete", {name});
}
