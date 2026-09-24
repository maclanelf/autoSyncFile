const base = process.env.RCLONE_RC_URL || "http://127.0.0.1:5572";
const defaultTimeoutMs = 15_000;
const deleteAttempts = 5;
const deleteRetryDelayMs = 500;
const maxDeleteRetryDelayMs = 15_000;

export async function rc<T = any>(
  endpoint: string,
  body: Record<string, unknown> = {},
  timeoutMs = defaultTimeoutMs,
): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.RCLONE_RC_USER) {
    headers.authorization = "Basic " + Buffer.from(
      `${process.env.RCLONE_RC_USER}:${process.env.RCLONE_RC_PASS || ""}`,
    ).toString("base64");
  }

  let res: Response;
  try {
    res = await fetch(`${base}/${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(`rclone 请求在 ${Math.ceil(timeoutMs / 1000)} 秒后超时`);
    }
    throw error;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `rclone RC ${res.status}`);
  return data;
}
export function isMissingJobError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:job|jobid).*?(?:not found|does not exist|unknown|invalid)|(?:not found|does not exist|unknown|invalid).*?(?:job|jobid)/i.test(message);
}
export function isMissingFileError(error: unknown) {
  const seen = new Set<unknown>();
  const collect = (value: unknown): string => {
    if (value === null || value === undefined || seen.has(value)) return "";
    if (typeof value === "string") return value;
    if (typeof value !== "object") return String(value);
    seen.add(value);
    const record = value as Record<string, unknown>;
    return [collect(record.message), collect(record.cause), ...Object.entries(record).map(([key, item]) => `${key} ${collect(item)}`)].join(" ");
  };
  return /(?:object\s+not\s+found|not\s+found|does\s+not\s+exist|404)/i.test(collect(error));
}
function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
export async function startTransfer(operation:"sync" | "copy", source:string, destination:string, statsGroup: string, files?: string[]) {
  return rc<{jobid:number; executeId?: string}>(`sync/${operation}`, {srcFs: source, dstFs: destination, _group: statsGroup, _async: true, ...(files?.length ? {_filter: {filesFromRaw: files}} : {})});
}
export async function getRcloneExecuteId() {
  return (await rc<{executeId?: string}>("job/list")).executeId;
}
export async function listSourceFiles(source: string) {
  const separator = source.indexOf(":");
  const fs = separator < 0 ? source : source.slice(0, separator + 1);
  const remote = separator < 0 ? "" : source.slice(separator + 1).replace(/^\/+/, "");
  const result = await rc<{list?: Array<{Path?: string; Name?: string; Size?: number; IsDir?: boolean}>}>("operations/list", {fs, remote, opt: {recurse: true}});
  return (result.list || []).filter((entry) => !entry.IsDir && (entry.Path || entry.Name)).map((entry) => ({path: entry.Path || entry.Name!, size: entry.Size || 0}));
}
export async function deleteSourceFiles(source: string, files: Array<{path: string}>) {
  const separator = source.indexOf(":");
  if (separator < 0) throw new Error("源路径必须是 rclone 存储路径");
  const fs = source.slice(0, separator + 1);
  const root = source.slice(separator + 1).replace(/^\/+|\/+$/g, "");
  const paths = [...new Set(files.map((file) => file.path.replace(/\\/g, "/").replace(/^\/+/, "")))];
  const failures: string[] = [];
  for (const path of paths) {
    const remote = [root, path].filter(Boolean).join("/");
    let lastError: unknown;
    for (let attempt = 0; attempt < deleteAttempts; attempt += 1) {
      try {
        await rc("operations/deletefile", {fs, remote});
        lastError = undefined;
        break;
      } catch (error) {
        // DELETE is idempotent: a 404 means the source object is already gone.
        if (isMissingFileError(error)) {
          lastError = undefined;
          break;
        }
        lastError = error;
        let deleted = false;
        try {
          deleted = await confirmSourceDeleted(fs, remote);
        } catch (confirmationError) {
          lastError = confirmationError;
        }
        if (deleted) {
          lastError = undefined;
          break;
        }
        if (attempt < deleteAttempts - 1) await wait(Math.min(deleteRetryDelayMs * 2 ** attempt, maxDeleteRetryDelayMs));
      }
    }
    if (lastError) {
      failures.push(`${remote}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    }
  }
  if (failures.length) throw new Error(failures.join("; "));
}

async function confirmSourceDeleted(fs: string, remote: string) {
  try {
    const result = await rc<{item?: unknown}>("operations/stat", {fs, remote});
    return result.item === null;
  } catch (error) {
    if (isMissingFileError(error)) return true;
    throw error;
  }
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
