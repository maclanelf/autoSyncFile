"use client";

import { useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Divider,
  Input,
  Progress,
  Select,
  SelectItem,
  Spinner,
  Tooltip,
} from "@heroui/react";
import {
  CalendarClock,
  ChevronDown,
  Copy,
  FileText,
  Folder,
  HardDrive,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type {
  FileRecord,
  Remote,
  SyncJob,
  SyncSchedule,
  TransferFile,
} from "@/lib/types";

const sourceTypes = [
  { key: "webdav", label: "WebDAV" },
  { key: "smb", label: "SMB / Windows 共享" },
  { key: "ftp", label: "FTP" },
  { key: "sftp", label: "SFTP / SSH" },
  { key: "local", label: "本地文件系统" },
] as const;
const sourceDefaults: Record<string, Record<string, string>> = {
  webdav: { url: "", vendor: "other", user: "", pass: "" },
  smb: { host: "", user: "", pass: "", domain: "" },
  ftp: { host: "", user: "", pass: "", port: "21", explicit_tls: "false" },
  sftp: { host: "", user: "", pass: "", port: "22", key_file: "" },
  local: {},
};
const emptyRemote = { name: "", type: "webdav", config: sourceDefaults.webdav };
const statusColor = {
  running: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "default",
  skipped: "default",
  unknown: "default",
} as const;
type RemoteEntry = {
  Name: string;
  Path?: string;
  IsDir?: boolean;
  Size?: number;
};
type SyncLocation = {
  remoteName: string;
  path: string;
  entries: RemoteEntry[];
  loading: boolean;
};
type DetailTab = "all" | "transferring" | "finished" | "information";
const emptyLocation: SyncLocation = {
  remoteName: "",
  path: "",
  entries: [],
  loading: false,
};

export default function Home() {
  const [remotes, setRemotes] = useState<Remote[]>([]);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [form, setForm] = useState<any>(emptyRemote);
  const [transfer, setTransfer] = useState({
    name: "",
    operation: "sync",
    source: "",
    destination: "",
    scheduled: false,
    cron: "0 */3 * * *",
  });
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [jobSearch, setJobSearch] = useState("");
  const [isJobPickerOpen, setJobPickerOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("transferring");
  const [detailFiles, setDetailFiles] = useState<TransferFile[]>([]);
  const [detailTotal, setDetailTotal] = useState(0);
  const [detailCounts, setDetailCounts] = useState({
    transferring: 0,
    queued: 0,
    finished: 0,
  });
  const [detailPage, setDetailPage] = useState(1);
  const [syncSource, setSyncSource] = useState<SyncLocation>(emptyLocation);
  const [syncDestination, setSyncDestination] =
    useState<SyncLocation>(emptyLocation);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<
    "tasks" | "storage" | "schedules" | "records" | "settings"
  >("tasks");
  const [selectedRemote, setSelectedRemote] = useState<Remote | null>(null);
  const [remotePath, setRemotePath] = useState("");
  const [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [isSourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [isTransferDialogOpen, setTransferDialogOpen] = useState(false);
  const [editingRemote, setEditingRemote] = useState<Remote | null>(null);
  const [remoteToDelete, setRemoteToDelete] = useState<Remote | null>(null);
  const [testingRemote, setTestingRemote] = useState(false);
  const [testedRemoteSignature, setTestedRemoteSignature] = useState("");
  const activeJobs = jobs.filter((job) => job.status === "running");

  async function load() {
    try {
      const [remoteResponse, jobsResponse] = await Promise.all([
        fetch("/api/remotes"),
        fetch("/api/jobs"),
      ]);
      const remoteData = await remoteResponse.json();
      const jobData = await jobsResponse.json();
      const updated = await Promise.all(
        jobData.map(async (job: SyncJob) =>
          job.status === "running" || job.id === selectedJobId
            ? (await fetch(`/api/jobs/${job.id}`)).json().catch(() => job)
            : job,
        ),
      );
      setRemotes(remoteData);
      setJobs(updated);
      setSelectedJobId((current) =>
        current && updated.some((job: SyncJob) => job.id === current)
          ? current
          : (
              updated.find((job: SyncJob) => job.status === "running") ||
              updated[0]
            )?.id || null,
      );
      setSelectedRemote((current) => {
        if (!current) return remoteData[0] || null;
        return remoteData.some((remote: Remote) => remote.name === current.name)
          ? current
          : remoteData[0] || null;
      });
    } catch {
      setMessage("无法读取控制台数据，请检查 rclone RC 服务连接。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (selectedJobId !== null) loadJobDetails(selectedJobId, "transferring", 1);
  }, [selectedJobId]);
  useEffect(() => {
    if (
      selectedJobId === null ||
      detailTab === "information" ||
      !jobs.some((job) => job.id === selectedJobId && job.status === "running")
    )
      return;
    const timer = window.setInterval(
      () => loadJobDetails(selectedJobId, detailTab, detailPage),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [selectedJobId, detailTab, detailPage, jobs]);
  useEffect(() => {
    if (view === "storage" && selectedRemote)
      browse(selectedRemote, remotePath);
  }, [view, selectedRemote, remotePath]);

  async function browse(remote: Remote, path = "") {
    setBrowseLoading(true);
    try {
      const response = await fetch("/api/browse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: `${remote.name}:${path}` }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setEntries(data.list || []);
    } catch (error) {
      setEntries([]);
      setMessage(
        error instanceof Error
          ? `无法读取 ${remote.name}: ${error.message}`
          : "无法读取远端目录",
      );
    } finally {
      setBrowseLoading(false);
    }
  }

  function remoteSignature() {
    return JSON.stringify({ type: form.type, config: form.config });
  }
  async function testRemote() {
    setTestingRemote(true);
    try {
      const response = await fetch("/api/remotes/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: form.type, config: form.config }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setTestedRemoteSignature(remoteSignature());
      setMessage("链接测试成功，可以保存数据源");
      return true;
    } catch (error) {
      setTestedRemoteSignature("");
      setMessage(error instanceof Error ? `链接测试失败：${error.message}` : "链接测试失败");
      return false;
    } finally {
      setTestingRemote(false);
    }
  }
  async function addRemote(event: React.FormEvent) {
    event.preventDefault();
    if (testedRemoteSignature !== remoteSignature() && !(await testRemote())) return;
    const response = await fetch("/api/remotes", {
      method: editingRemote ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        editingRemote ? { ...form, id: editingRemote.id } : form,
      ),
    });
    const data = await response.json();
    setMessage(
      response.ok
        ? editingRemote
          ? "数据源配置已更新"
          : "数据源已注册到 rclone"
        : data.error,
    );
    if (response.ok) {
      setForm({ name: "", type: "webdav", config: sourceDefaults.webdav });
      setEditingRemote(null);
      setTestedRemoteSignature("");
      setSourceDialogOpen(false);
      setView("storage");
      load();
    }
  }
  function openAddSource() {
    setEditingRemote(null);
    setForm({ name: "", type: "webdav", config: sourceDefaults.webdav });
    setTestedRemoteSignature("");
    setSourceDialogOpen(true);
  }
  function openEditSource(remote: Remote) {
    const config = { ...remote.config, pass: "" };
    setEditingRemote(remote);
    setForm({
      name: remote.name,
      type: remote.type,
      config: sourceDefaults[remote.type]
        ? { ...sourceDefaults[remote.type], ...config }
        : config,
    });
    setTestedRemoteSignature("");
    setSourceDialogOpen(true);
  }
  async function deleteSourceNow(remote: Remote) {
    const response = await fetch("/api/remotes", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: remote.name }),
    });
    const data = await response.json();
    setMessage(response.ok ? "数据源已从 rclone 删除" : data.error);
    if (response.ok) {
      setSelectedRemote(null);
      setEntries([]);
      load();
    }
  }
  function deleteSource(remote: Remote) {
    setRemoteToDelete(remote);
  }
  function buildRemotePath(remoteName: string, path: string) {
    return `${remoteName}:${path ? `/${path}` : ""}`;
  }
  async function loadSyncDirectory(
    kind: "source" | "destination",
    remoteName: string,
    path = "",
  ) {
    const update = kind === "source" ? setSyncSource : setSyncDestination;
    update({ remoteName, path, entries: [], loading: true });
    try {
      const response = await fetch("/api/browse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: buildRemotePath(remoteName, path) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      update({ remoteName, path, entries: data.list || [], loading: false });
    } catch (error) {
      update({ remoteName, path, entries: [], loading: false });
      setMessage(error instanceof Error ? error.message : "无法读取目录");
    }
  }
  function openTransfer() {
    setTransfer({
      name: "",
      operation: "sync",
      source: "",
      destination: "",
      scheduled: false,
      cron: "0 */3 * * *",
    });
    setSyncSource(emptyLocation);
    setSyncDestination(emptyLocation);
    setTransferDialogOpen(true);
  }
  function closeTransfer() {
    setTransferDialogOpen(false);
  }
  async function start(event: React.FormEvent) {
    event.preventDefault();
    const { scheduled, cron, ...job } = transfer;
    const response = scheduled
      ? await fetch("/api/schedules", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...job,
            remoteId: remotes.find(
              (remote) => remote.name === job.source.split(":", 1)[0],
            )?.id,
            cron,
          }),
        })
      : await fetch("/api/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(job),
        });
    const data = await response.json();
    setMessage(
      response.ok
        ? scheduled
          ? "定时同步已创建"
          : "同步任务已启动"
        : data.error,
    );
    if (response.ok) closeTransfer();
    load();
  }
  async function stop(id: number) {
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    setMessage("任务已取消");
    load();
  }
  async function selectJob(id: number) {
    setSelectedJobId(id);
    setJobPickerOpen(false);
    setDetailPage(1);
    setDetailFiles([]);
    await loadJobDetails(id, "transferring", 1);
  }
  async function loadJobDetails(
    id: number,
    tab: DetailTab,
    page: number,
    preferFinished = false,
  ) {
    if (tab === "information") {
      setDetailTab(tab);
      return;
    }
    try {
      const response = await fetch(`/api/jobs/${id}?state=${tab}&page=${page}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setJobs((current) => current.map((job) => (job.id === id ? data : job)));
      setDetailTab(tab);
      setDetailPage(data.page);
      setDetailTotal(data.total);
      setDetailCounts(
        data.counts || { transferring: 0, queued: 0, finished: 0 },
      );
      setDetailFiles(data.files || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法读取任务详情");
    }
  }
  function openStorage() {
    setView("storage");
  }
  function selectRemote(remote: Remote) {
    setRemotePath("");
    setSelectedRemote(remote);
  }
  function openDirectory(path: string) {
    setRemotePath(path);
  }

  return (
    <main className="webui-shell">
      <header className="webui-topbar">
        <div className="webui-logo">
          <span>
            <ShieldCheck size={19} />
          </span>
          <strong>Rclone WebUI</strong>
        </div>
        <nav className="webui-primary-nav" aria-label="主导航">
          <button
            type="button"
            className={view === "storage" ? "selected" : ""}
            onClick={openStorage}
          >
            <HardDrive size={17} />
            添加存储
          </button>
          <button
            type="button"
            className={view === "tasks" ? "selected" : ""}
            onClick={() => setView("tasks")}
          >
            <Folder size={17} />
            任务
          </button>
          <button
            type="button"
            className={view === "schedules" ? "selected" : ""}
            onClick={() => setView("schedules")}
          >
            <CalendarClock size={17} />
            定时同步
          </button>
          <button
            type="button"
            className={view === "records" ? "selected" : ""}
            onClick={() => setView("records")}
          >
            <FileText size={17} />
            文件记录
          </button>
          <button
            type="button"
            className={view === "settings" ? "selected" : ""}
            onClick={() => setView("settings")}
          >
            <Settings2 size={17} />
            设置
          </button>
        </nav>
        <div className="webui-profile">
          <Tooltip content="刷新数据">
            <ActionButton iconOnly aria-label="刷新" onClick={load}>
              <RefreshCw size={18} />
            </ActionButton>
          </Tooltip>
        </div>
      </header>
      <section className="webui-main">
        <Card className="file-panel">
          <CardBody>
            <div className="panel-layout">
              <section className="file-content">
                {view === "tasks" ? (
                  <FileManagementView
                    loading={loading}
                    jobs={jobs}
                    activeJobs={activeJobs}
                    selectedJobId={selectedJobId}
                    search={jobSearch}
                    pickerOpen={isJobPickerOpen}
                    detailTab={detailTab}
                    detailFiles={detailFiles}
                    detailPage={detailPage}
                    detailTotal={detailTotal}
                    detailCounts={detailCounts}
                    onSearch={setJobSearch}
                    onPickerOpen={setJobPickerOpen}
                    onSelect={selectJob}
                    onTab={(tab) =>
                      selectedJobId && loadJobDetails(selectedJobId, tab, 1)
                    }
                    onPage={(page) =>
                      selectedJobId &&
                      loadJobDetails(selectedJobId, detailTab, page)
                    }
                    onTransfer={openTransfer}
                    onStop={stop}
                    onRefresh={load}
                  />
                ) : view === "schedules" ? (
                  <SchedulePage remotes={remotes} onMessage={setMessage} />
                ) : view === "records" ? (
                  <FileRecordsPage />
                ) : view === "settings" ? (
                  <SettingsPage />
                ) : (
                  <StorageView
                    remotes={remotes}
                    selectedRemote={selectedRemote}
                    entries={entries}
                    path={remotePath}
                    loading={browseLoading}
                    onAdd={openAddSource}
                    onEdit={openEditSource}
                    onDelete={deleteSource}
                    onSelect={selectRemote}
                    onOpenDirectory={openDirectory}
                    onRefresh={() =>
                      selectedRemote && browse(selectedRemote, remotePath)
                    }
                  />
                )}
              </section>
            </div>
          </CardBody>
        </Card>
      </section>
      {isSourceDialogOpen && (
        <div
          className="source-dialog-backdrop"
          role="presentation"
          onMouseDown={() => setSourceDialogOpen(false)}
        >
          <form
            className="source-dialog"
            onSubmit={addRemote}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="source-dialog-header">
              <h2>{editingRemote ? "编辑数据源" : "添加数据源"}</h2>
              <ActionButton
                iconOnly
                aria-label="关闭"
                onClick={() => setSourceDialogOpen(false)}
              >
                <X size={18} />
              </ActionButton>
            </div>
            <div className="source-dialog-body">
              <label className="source-field">
                <span>数据源类型</span>
                <select
                  value={form.type}
                  disabled={Boolean(editingRemote)}
                   onChange={(event) => {
                    const type = event.target.value;
                    setForm({
                      name: form.name,
                      type,
                     config: sourceDefaults[type] || {},
                    });
                    setTestedRemoteSignature("");
                  }}
                >
                  {sourceTypes.map((type) => (
                    <option key={type.key} value={type.key}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="source-field">
                <span>数据源名称</span>
                <input
                  placeholder="例如：家庭 NAS"
                  value={form.name}
                  readOnly={Boolean(editingRemote)}
                   onChange={(event) => {
                     setForm({ ...form, name: event.target.value });
                     setTestedRemoteSignature("");
                   }}
                  required
                />
                <small>
                  {editingRemote
                    ? "rclone 数据源名称不可直接修改"
                    : "将作为 rclone remote 名称"}
                </small>
              </label>
              <SourceConfigFields
                type={form.type}
                config={form.config}
                 onChange={(key, value) => {
                   setForm({ ...form, config: { ...form.config, [key]: value } });
                   setTestedRemoteSignature("");
                 }}
              />
            </div>
            <div className="source-dialog-footer">
              <ActionButton
                className="dialog-cancel"
                onClick={() => setSourceDialogOpen(false)}
              >
                取消
              </ActionButton>
              <ActionButton
                className="test-action"
                onClick={() => void testRemote()}
                disabled={testingRemote}
              >
                {testingRemote ? "测试中..." : "测试链接"}
              </ActionButton>
              <ActionButton className="primary-action" type="submit">
                {editingRemote ? "保存配置" : "写入 rclone 配置"}
              </ActionButton>
            </div>
          </form>
        </div>
      )}
      {isTransferDialogOpen && (
        <div
          className="source-dialog-backdrop"
          role="presentation"
          onMouseDown={closeTransfer}
        >
          <form
            className="source-dialog sync-dialog"
            onSubmit={start}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="source-dialog-header">
              <h2>{transfer.scheduled ? "新建定时同步" : "新建同步"}</h2>
              <ActionButton iconOnly aria-label="关闭" onClick={closeTransfer}>
                <X size={18} />
              </ActionButton>
            </div>
            <div className="source-dialog-body">
              <label className="source-field">
                <span>任务名称</span>
                <input
                  value={transfer.name}
                  placeholder="例如：NAS 照片备份"
                  onChange={(event) =>
                    setTransfer({ ...transfer, name: event.target.value })
                  }
                  required
                />
              </label>
              <label className="source-field">
                <span>同步方式</span>
                <select
                  value={transfer.operation}
                  onChange={(event) =>
                    setTransfer({ ...transfer, operation: event.target.value })
                  }
                >
                  <option value="sync">SYNC · 镜像同步</option>
                  <option value="copy">COPY · 增量复制</option>
                </select>
              </label>
              <div className="sync-location-grid">
                <SyncLocationPicker
                  label="源"
                  location={syncSource}
                  remotes={remotes}
                  onRemoteChange={(name) => {
                    setTransfer({
                      ...transfer,
                      source: buildRemotePath(name, ""),
                    });
                    loadSyncDirectory("source", name);
                  }}
                  onDirectoryChange={(path) => {
                    setTransfer({
                      ...transfer,
                      source: buildRemotePath(syncSource.remoteName, path),
                    });
                    loadSyncDirectory("source", syncSource.remoteName, path);
                  }}
                />
                <SyncLocationPicker
                  label="目的地"
                  location={syncDestination}
                  remotes={remotes}
                  onRemoteChange={(name) => {
                    setTransfer({
                      ...transfer,
                      destination: buildRemotePath(name, ""),
                    });
                    loadSyncDirectory("destination", name);
                  }}
                  onDirectoryChange={(path) => {
                    setTransfer({
                      ...transfer,
                      destination: buildRemotePath(
                        syncDestination.remoteName,
                        path,
                      ),
                    });
                    loadSyncDirectory(
                      "destination",
                      syncDestination.remoteName,
                      path,
                    );
                  }}
                />
              </div>
              <label className="source-field schedule-toggle">
                <span>执行方式</span>
                <select
                  value={transfer.scheduled ? "scheduled" : "once"}
                  onChange={(event) =>
                    setTransfer({
                      ...transfer,
                      scheduled: event.target.value === "scheduled",
                    })
                  }
                >
                  <option value="once">立即执行一次</option>
                  <option value="scheduled">创建定时任务</option>
                </select>
              </label>
              {transfer.scheduled && (
                <label className="source-field">
                  <span>Cron 表达式</span>
                  <input
                    className="mono"
                    value={transfer.cron}
                    placeholder="例如：0 */3 * * *"
                    onChange={(event) =>
                      setTransfer({ ...transfer, cron: event.target.value })
                    }
                    required
                  />
                  <small>例如 `0 */3 * * *` 表示每 3 小时执行一次。</small>
                </label>
              )}
            </div>
            <div className="source-dialog-footer">
              <ActionButton className="dialog-cancel" onClick={closeTransfer}>
                取消
              </ActionButton>
              <ActionButton
                className="primary-action"
                type="submit"
                disabled={
                  !transfer.name.trim() ||
                  !transfer.source ||
                  !transfer.destination
                }
              >
                {transfer.scheduled ? "创建定时任务" : "启动同步"}
              </ActionButton>
            </div>
          </form>
        </div>
      )}
      {message && (
        <div className="toast">
          <span>{message}</span>
          <Button
            isIconOnly
            size="sm"
            variant="light"
            aria-label="关闭消息"
            onPress={() => setMessage("")}
          >
            <X size={16} />
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(remoteToDelete)}
        title="删除数据源"
        message={
          remoteToDelete
            ? `确定从 rclone 删除数据源“${remoteToDelete.name}”吗？该操作会移除远端配置。`
            : ""
        }
        onCancel={() => setRemoteToDelete(null)}
        onConfirm={() => {
          if (remoteToDelete) void deleteSourceNow(remoteToDelete);
          setRemoteToDelete(null);
        }}
      />
    </main>
  );
}

function TasksView({
  loading,
  jobs,
  activeJobs,
  remotes,
  onAdd,
  onTransfer,
  onRefresh,
  onStop,
}: any) {
  return (
    <>
      <div className="content-heading">
        <div>
          <p className="crumb">文件空间 / 全部文件</p>
          <h1>文件管理</h1>
        </div>
        <ActionButton
          className="primary-action"
          icon={<Plus size={18} />}
          onClick={onTransfer}
        >
          新建同步
        </ActionButton>
      </div>
      <div className="storage-cards">
        <SummaryCard
          label="已连接"
          value={`${remotes.length} 个远端`}
          caption="远端存储"
          action={onAdd}
        />
        <SummaryCard
          label="传输总量"
          value={`${jobs.length} 个任务`}
          caption="历史记录"
        />
        <SummaryCard
          label="运行中"
          value={`${activeJobs.length} 个任务`}
          caption="实时同步"
        />
        <SummaryCard label="RC 服务" value="在线" caption="服务状态" />
      </div>
      <div className="file-toolbar">
        <div>
          <ActionButton className="active-toolbar">任务列表</ActionButton>
        </div>
        <ActionButton icon={<RefreshCw size={15} />} onClick={onRefresh}>
          刷新
        </ActionButton>
      </div>
      <div className="task-table">
        <div className="table-head">
          <span>任务名称</span>
          <span>远端</span>
          <span>类型</span>
          <span>状态</span>
          <span>创建时间</span>
          <span>操作</span>
        </div>
        {loading ? (
          <div className="table-loading">
            <Spinner color="primary" />
            <span>正在读取任务</span>
          </div>
        ) : jobs.length === 0 ? (
          <div className="table-empty">
            <Folder size={30} />
            <strong>尚无同步任务</strong>
            <span>创建第一个同步任务开始管理文件。</span>
          </div>
        ) : (
          jobs.map((job: SyncJob) => (
            <div className="table-row" key={job.id}>
              <div className="task-name">
                <span className="file-badge">
                  <Copy size={17} />
                </span>
                <div>
                  <strong>
                    {job.operation === "sync" ? "镜像同步任务" : "增量复制任务"}
                  </strong>
                  <small>
                    {job.source} → {job.destination}
                  </small>
                </div>
              </div>
              <span>{job.remoteName || "本地"}</span>
              <span className="mono">{job.operation.toUpperCase()}</span>
              <Chip size="sm" color={statusColor[job.status]} variant="flat">
                {job.status}
              </Chip>
              <span className="mono">
                {new Date(job.createdAt).toLocaleString()}
              </span>
              <div className="task-actions">
                {job.status === "running" && (
                  <ActionButton
                    className="danger-action"
                    iconOnly
                    aria-label="取消任务"
                    onClick={() => onStop(job.id)}
                  >
                    <X size={16} />
                  </ActionButton>
                )}
              </div>
              {job.status === "running" && (
                <Progress
                  className="row-progress"
                  size="sm"
                  isIndeterminate
                  color="warning"
                  aria-label="同步中"
                />
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}

function StorageView({
  remotes,
  selectedRemote,
  entries,
  path,
  loading,
  onAdd,
  onEdit,
  onDelete,
  onSelect,
  onOpenDirectory,
  onRefresh,
}: {
  remotes: Remote[];
  selectedRemote: Remote | null;
  entries: RemoteEntry[];
  path: string;
  loading: boolean;
  onAdd: () => void;
  onEdit: (remote: Remote) => void;
  onDelete: (remote: Remote) => void;
  onSelect: (remote: Remote) => void;
  onOpenDirectory: (path: string) => void;
  onRefresh: () => void;
}) {
  const segments = path.split("/").filter(Boolean);
  return (
    <>
      <div className="content-heading">
        <div>
          <p className="crumb">存储空间 / rclone 数据源</p>
          <h1>添加存储</h1>
        </div>
        <ActionButton
          className="primary-action"
          icon={<Plus size={18} />}
          onClick={onAdd}
        >
          添加数据源
        </ActionButton>
      </div>
      <div className="storage-layout">
        <div className="remote-list">
          <div className="remote-list-heading">
            <span>已挂载数据源</span>
            <Chip size="sm" variant="flat">
              {remotes.length}
            </Chip>
          </div>
          {remotes.length === 0 ? (
            <div className="remote-empty">尚未发现 rclone 数据源</div>
          ) : (
            remotes.map((remote) => (
              <div
                key={remote.id}
                className={`remote-item ${selectedRemote?.id === remote.id ? "active" : ""}`}
              >
                <button
                  type="button"
                  className="remote-select"
                  onClick={() => onSelect(remote)}
                >
                  <HardDrive size={18} />
                  <span>
                    <strong>{remote.name}</strong>
                    <small>{remote.type}</small>
                  </span>
                </button>
                <ActionButton
                  className="remote-edit"
                  iconOnly
                  aria-label={`编辑 ${remote.name}`}
                  title="编辑数据源"
                  onClick={() => onEdit(remote)}
                  icon={<Pencil size={15} />}
                />
                <ActionButton
                  className="remote-delete"
                  iconOnly
                  aria-label={`删除 ${remote.name}`}
                  title="删除数据源"
                  onClick={() => onDelete(remote)}
                  icon={<Trash2 size={15} />}
                />
              </div>
            ))
          )}
        </div>
        <div className="remote-browser">
          <div className="browser-heading">
            <div>
              <span className="file-badge">
                <Network size={17} />
              </span>
              <div>
                <strong>
                  {selectedRemote ? `${selectedRemote.name}:` : "选择数据源"}
                </strong>
                <small>
                  {selectedRemote
                    ? `${selectedRemote.type.toUpperCase()} · rclone 已挂载`
                    : "从左侧选择一个数据源"}
                </small>
              </div>
            </div>
            <div className="browser-actions">
              {selectedRemote && (
                <>
                  <ActionButton
                    iconOnly
                    aria-label="编辑数据源"
                    title="编辑数据源"
                    onClick={() => onEdit(selectedRemote)}
                    icon={<Pencil size={17} />}
                  />
                  <ActionButton
                    className="danger-action"
                    iconOnly
                    aria-label="删除数据源"
                    title="删除数据源"
                    onClick={() => onDelete(selectedRemote)}
                    icon={<Trash2 size={17} />}
                  />
                </>
              )}
              <ActionButton
                iconOnly
                aria-label="刷新目录"
                title="刷新目录"
                onClick={onRefresh}
                icon={<RefreshCw size={17} />}
              />
            </div>
          </div>
          <div className="path-bar">
            {selectedRemote && (
              <button type="button" onClick={() => onOpenDirectory("")}>
                {selectedRemote.name}:
              </button>
            )}
            {segments.map((segment, index) => (
              <span key={`${segment}-${index}`}>
                <b>/</b>
                <button
                  type="button"
                  onClick={() =>
                    onOpenDirectory(segments.slice(0, index + 1).join("/"))
                  }
                >
                  {segment}
                </button>
              </span>
            ))}
          </div>
          <Divider />
          {loading ? (
            <div className="table-loading">
              <Spinner color="primary" />
              <span>正在读取远端目录</span>
            </div>
          ) : !selectedRemote ? (
            <div className="table-empty">
              <HardDrive size={30} />
              <strong>没有可浏览的数据源</strong>
            </div>
          ) : entries.length === 0 ? (
            <div className="table-empty">
              <Folder size={30} />
              <strong>远端目录为空</strong>
              <span>该路径中没有可显示的文件。</span>
            </div>
          ) : (
            <div className="entry-list">
              {entries.map((entry) => (
                <button
                  type="button"
                  className={`entry-row ${entry.IsDir ? "directory-row" : ""}`}
                  key={entry.Path || entry.Name}
                  onClick={() =>
                    entry.IsDir &&
                    onOpenDirectory(
                      entry.Path || [...segments, entry.Name].join("/"),
                    )
                  }
                >
                  <span className="file-badge">
                    {entry.IsDir ? <Folder size={17} /> : <Copy size={17} />}
                  </span>
                  <strong>{entry.Name}</strong>
                  <span>
                    {entry.IsDir ? "打开文件夹" : formatSize(entry.Size)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function SummaryCard({
  label,
  value,
  caption,
  action,
}: {
  label: string;
  value: string;
  caption: string;
  action?: () => void;
}) {
  return (
    <button
      type="button"
      className="summary-card"
      onClick={action}
      aria-label={action ? `添加${label}` : label}
    >
      <span className="summary-heading">
        <span className="summary-label">{label}</span>
        {action && (
          <span className="summary-add">
            <Plus size={16} />
          </span>
        )}
      </span>
      <span className="summary-caption">{caption}</span>
      <strong>{value}</strong>
    </button>
  );
}
function SchedulePage({
  remotes,
  onMessage,
}: {
  remotes: Remote[];
  onMessage: (message: string) => void;
}) {
  return <SchedulePanel remotes={remotes} onMessage={onMessage} />;
}
function SchedulePanel({
  remotes,
  onMessage,
}: {
  remotes: Remote[];
  onMessage: (message: string) => void;
}) {
  const [schedules, setSchedules] = useState<SyncSchedule[]>([]);
  const [results, setResults] = useState<Record<number, SyncJob[]>>({});
  const [runningId, setRunningId] = useState<number | null>(null);
  const [scheduleToDelete, setScheduleToDelete] = useState<SyncSchedule | null>(
    null,
  );
  const [editingSchedule, setEditingSchedule] = useState<SyncSchedule | null>(
    null,
  );
  const [scheduleForm, setScheduleForm] = useState({
    name: "",
    operation: "sync" as "sync" | "copy",
    source: "",
    destination: "",
    cron: "",
  });
  const [editSource, setEditSource] = useState<SyncLocation>(emptyLocation);
  const [editDestination, setEditDestination] =
    useState<SyncLocation>(emptyLocation);
  async function loadSchedules() {
    const response = await fetch("/api/schedules");
    if (response.ok) setSchedules(await response.json());
  }
  useEffect(() => {
    void loadSchedules();
  }, []);
  async function setEnabled(schedule: SyncSchedule) {
    const response = await fetch("/api/schedules", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: schedule.id, enabled: !schedule.enabled }),
    });
    const data = await response.json();
    onMessage(response.ok ? "定时任务状态已更新" : data.error);
    if (response.ok) void loadSchedules();
  }
  async function remove(id: number) {
    const response = await fetch("/api/schedules", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await response.json();
    onMessage(response.ok ? "定时任务已删除" : data.error);
    if (response.ok) void loadSchedules();
  }
  async function runNow(schedule: SyncSchedule) {
    setRunningId(schedule.id);
    const response = await fetch(`/api/schedules/${schedule.id}`, {
      method: "POST",
    });
    const data = await response.json();
    setRunningId(null);
    onMessage(
      response.ok
        ? data.status === "skipped"
          ? "本次执行已跳过，上一次同步尚未完成"
          : "定时任务已立即执行"
        : data.error,
    );
    if (response.ok) {
      void loadSchedules();
      setResults((current) => ({
        ...current,
        [schedule.id]: [data, ...(current[schedule.id] || [])].slice(0, 20),
      }));
    }
  }
  async function showResults(schedule: SyncSchedule) {
    const response = await fetch(`/api/schedules/${schedule.id}`);
    const data = await response.json();
    if (!response.ok) {
      onMessage(data.error);
      return;
    }
    setResults((current) => ({ ...current, [schedule.id]: data.jobs }));
  }
  async function saveSchedule(event: React.FormEvent) {
    event.preventDefault();
    if (!editingSchedule) return;
    const response = await fetch("/api/schedules", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: editingSchedule.id, ...scheduleForm }),
    });
    const data = await response.json();
    onMessage(response.ok ? "定时任务已更新" : data.error);
    if (response.ok) {
      setEditingSchedule(null);
      void loadSchedules();
    }
  }
  function splitRemotePath(value: string) {
    const separator = value.indexOf(":");
    return separator < 0
      ? { remoteName: "", path: "" }
      : {
          remoteName: value.slice(0, separator),
          path: value.slice(separator + 1).replace(/^\/+/, ""),
        };
  }
  function openEdit(schedule: SyncSchedule) {
    const source = splitRemotePath(schedule.source);
    const destination = splitRemotePath(schedule.destination);
    setEditingSchedule(schedule);
    setScheduleForm({
      name: schedule.name,
      operation: schedule.operation,
      source: schedule.source,
      destination: schedule.destination,
      cron: schedule.cron,
    });
    setEditSource({ ...emptyLocation, ...source });
    setEditDestination({ ...emptyLocation, ...destination });
    if (source.remoteName)
      void loadEditDirectory("source", source.remoteName, source.path);
    if (destination.remoteName)
      void loadEditDirectory(
        "destination",
        destination.remoteName,
        destination.path,
      );
  }
  async function loadEditDirectory(
    kind: "source" | "destination",
    remoteName: string,
    path = "",
  ) {
    const update = kind === "source" ? setEditSource : setEditDestination;
    update({ remoteName, path, entries: [], loading: true });
    try {
      const response = await fetch("/api/browse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: `${remoteName}:${path ? `/${path}` : ""}`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      update({ remoteName, path, entries: data.list || [], loading: false });
    } catch (error) {
      update({ remoteName, path, entries: [], loading: false });
      onMessage(error instanceof Error ? error.message : "无法读取目录");
    }
  }
  function changeEditLocation(
    kind: "source" | "destination",
    remoteName: string,
    path: string,
  ) {
    const value = `${remoteName}:${path ? `/${path}` : ""}`;
    setScheduleForm((current) => ({ ...current, [kind]: value }));
    void loadEditDirectory(kind, remoteName, path);
  }
  return (
    <>
      <section className="schedule-panel">
        <header>
          <div>
            <span className="schedule-icon">
              <CalendarClock size={18} />
            </span>
            <div>
              <strong>定时同步</strong>
              <small>在新建同步弹窗中创建，当前页面仅用于查看和管理</small>
            </div>
          </div>
        </header>
        <div className="schedule-list">
          {schedules.length === 0 ? (
            <span className="schedule-empty">尚未创建定时任务</span>
          ) : (
            schedules.map((schedule) => (
              <div className="schedule-item" key={schedule.id}>
                <div className="schedule-row">
                  <div>
                    <strong>{schedule.name}</strong>
                    <small className="mono">
                      {schedule.cron} · {schedule.operation.toUpperCase()} ·{" "}
                      {schedule.source} → {schedule.destination}
                    </small>
                    <small>
                      最近执行：
                      {schedule.lastRunAt
                        ? new Date(schedule.lastRunAt).toLocaleString()
                        : "尚未执行"}
                    </small>
                  </div>
                  <Chip
                    size="sm"
                    color={schedule.enabled ? "success" : "default"}
                    variant="flat"
                  >
                    {schedule.enabled ? "已启用" : "已暂停"}
                  </Chip>
                  <ActionButton
                    className="detail-action"
                    onClick={() => openEdit(schedule)}
                  >
                    编辑
                  </ActionButton>
                  <ActionButton
                    className="detail-action"
                    onClick={() => runNow(schedule)}
                  >
                    {runningId === schedule.id ? "执行中" : "立即执行一次"}
                  </ActionButton>
                  <ActionButton
                    className="detail-action"
                    onClick={() => showResults(schedule)}
                  >
                    执行结果
                  </ActionButton>
                  <ActionButton
                    className="detail-action"
                    onClick={() => setEnabled(schedule)}
                  >
                    {schedule.enabled ? "暂停" : "启用"}
                  </ActionButton>
                  <ActionButton
                    className="danger-action"
                    iconOnly
                    aria-label={`删除 ${schedule.name}`}
                    onClick={() => setScheduleToDelete(schedule)}
                  >
                    <Trash2 size={15} />
                  </ActionButton>
                </div>
                {results[schedule.id] && (
                  <div className="schedule-results">
                    {results[schedule.id].length === 0 ? (
                      <span>暂无执行记录</span>
                    ) : (
                      results[schedule.id].map((job) => (
                        <div key={job.id}>
                          <span>
                            {new Date(job.createdAt).toLocaleString()}
                          </span>
                          <Chip
                            size="sm"
                            color={statusColor[job.status]}
                            variant="flat"
                          >
                            {job.status === "skipped"
                              ? "已跳过"
                              : job.status === "completed"
                                ? "已完成"
                              : job.status === "failed"
                                ? "失败"
                                : job.status === "cancelled"
                                  ? "已取消"
                                  : job.status === "running"
                                    ? "运行中"
                                    : "未知状态"}
                          </Chip>
                          {job.error && <small>{job.error}</small>}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>
      <ConfirmDialog
        open={Boolean(scheduleToDelete)}
        title="删除定时任务"
        message={
          scheduleToDelete
            ? `确定删除定时任务“${scheduleToDelete.name}”吗？该操作不可恢复。`
            : ""
        }
        onCancel={() => setScheduleToDelete(null)}
        onConfirm={() => {
          if (scheduleToDelete) void remove(scheduleToDelete.id);
          setScheduleToDelete(null);
        }}
      />
      <ScheduleEditDialog
        schedule={editingSchedule}
        form={scheduleForm}
        remotes={remotes}
        source={editSource}
        destination={editDestination}
        onLocationChange={changeEditLocation}
        onChange={(patch) => setScheduleForm({ ...scheduleForm, ...patch })}
        onCancel={() => setEditingSchedule(null)}
        onSubmit={saveSchedule}
      />
    </>
  );
}
function ScheduleEditDialog({
  schedule,
  form,
  remotes,
  source,
  destination,
  onLocationChange,
  onChange,
  onCancel,
  onSubmit,
}: {
  schedule: SyncSchedule | null;
  form: {
    name: string;
    operation: "sync" | "copy";
    source: string;
    destination: string;
    cron: string;
  };
  remotes: Remote[];
  source: SyncLocation;
  destination: SyncLocation;
  onLocationChange: (
    kind: "source" | "destination",
    remoteName: string,
    path: string,
  ) => void;
  onChange: (patch: Partial<typeof form>) => void;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  if (!schedule) return null;
  return (
    <div
      className="source-dialog-backdrop"
      role="presentation"
      onMouseDown={onCancel}
    >
      <form
        className="source-dialog sync-dialog"
        onSubmit={onSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="source-dialog-header">
          <h2>编辑定时任务</h2>
          <ActionButton iconOnly aria-label="关闭" onClick={onCancel}>
            <X size={18} />
          </ActionButton>
        </div>
        <div className="source-dialog-body">
          <label className="source-field">
            <span>任务名称</span>
            <input
              value={form.name}
              onChange={(event) => onChange({ name: event.target.value })}
              required
              maxLength={120}
            />
          </label>
          <label className="source-field">
            <span>同步方式</span>
            <select
              value={form.operation}
              onChange={(event) =>
                onChange({ operation: event.target.value as "sync" | "copy" })
              }
            >
              <option value="sync">SYNC · 镜像同步</option>
              <option value="copy">COPY · 增量复制</option>
            </select>
          </label>
          <div className="sync-location-grid">
            <SyncLocationPicker
              label="源"
              location={source}
              remotes={remotes}
              onRemoteChange={(name) => onLocationChange("source", name, "")}
              onDirectoryChange={(path) =>
                onLocationChange("source", source.remoteName, path)
              }
            />
            <SyncLocationPicker
              label="目的地"
              location={destination}
              remotes={remotes}
              onRemoteChange={(name) =>
                onLocationChange("destination", name, "")
              }
              onDirectoryChange={(path) =>
                onLocationChange("destination", destination.remoteName, path)
              }
            />
          </div>
          <label className="source-field">
            <span>执行时间（Cron）</span>
            <input
              value={form.cron}
              placeholder="例如：0 */3 * * *"
              onChange={(event) => onChange({ cron: event.target.value })}
              required
            />
            <small>使用 5 段 Cron 表达式，例如每天 02:30：30 2 * * *</small>
          </label>
        </div>
        <div className="source-dialog-footer">
          <ActionButton className="dialog-cancel" onClick={onCancel}>
            取消
          </ActionButton>
          <ActionButton className="primary-action" type="submit">
            保存修改
          </ActionButton>
        </div>
      </form>
    </div>
  );
}
function FileRecordsPage() {
  const [records, setRecords] = useState<FileRecord[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  async function loadRecords(value = search, requestedPage = page) {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/file-records?search=${encodeURIComponent(value)}&page=${requestedPage}`,
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setRecords(data.files);
      setTotal(data.total);
      setPage(data.page);
      setPageSize(data.pageSize);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRecords(search, 1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  function changePage(nextPage: number) {
    if (nextPage < 1 || nextPage > pageCount || nextPage === page) return;
    void loadRecords(search, nextPage);
  }
  return (
    <div className="file-records-view">
      <section className="file-records-panel">
        <div className="records-search">
          <Search size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索文件路径、任务名称或同步位置"
            aria-label="搜索文件记录"
          />
          <span>{total} 条记录</span>
          <ActionButton
            iconOnly
            aria-label="刷新文件记录"
            title="刷新"
            onClick={() => void loadRecords()}
          >
            <RefreshCw size={16} />
          </ActionButton>
        </div>
        <div className="file-records-list">
          {loading ? (
            <div className="table-loading">
              <Spinner color="primary" />
              <span>正在读取文件记录</span>
            </div>
          ) : records.length === 0 ? (
            <div className="table-empty">
              <FileText size={30} />
              <strong>未找到文件记录</strong>
              <span>文件在同步后会显示在这里。</span>
            </div>
          ) : (
            records.map((record) => (
              <article className="file-record-card" key={record.id}>
                <span className="file-badge">
                  <Copy size={16} />
                </span>
                <div className="file-record-main">
                  <strong title={record.path}>{record.path}</strong>
                  <span>
                    {record.source} → {record.destination}
                  </span>
                  <small>
                    同步任务：{record.scheduleName || record.jobName}
                    {record.scheduleId
                      ? ` · 定时任务 #${record.scheduleId}`
                      : " · 手动同步"}
                  </small>
                  {record.error && <em>{record.error}</em>}
                </div>
                <div className="file-record-meta">
                  <Chip
                    size="sm"
                    color={
                      record.status === "failed"
                        ? "danger"
                        : record.status === "transferring"
                          ? "warning"
                          : "success"
                    }
                    variant="flat"
                  >
                    {record.status === "completed"
                      ? "已完成"
                      : record.status === "failed"
                        ? "失败"
                        : "同步中"}
                  </Chip>
                  <span>
                    {formatSize(record.bytes)} / {formatSize(record.size)}
                  </span>
                  <time>
                    {new Date(
                      record.finishedAt || record.startedAt,
                    ).toLocaleString()}
                  </time>
                </div>
              </article>
            ))
          )}
        </div>
        <footer className="records-pagination">
          <span>
            第 {page} / {pageCount} 页
          </span>
          <ActionButton
            disabled={loading || page === 1}
            onClick={() => changePage(page - 1)}
          >
            上一页
          </ActionButton>
          <ActionButton
            disabled={loading || page === pageCount}
            onClick={() => changePage(page + 1)}
          >
            下一页
          </ActionButton>
        </footer>
      </section>
    </div>
  );
}
function SettingsPage() {
  return (
    <div className="settings-page">
      <div className="content-heading">
        <div>
          <p className="crumb">系统管理 / 常用设置</p>
          <h1>设置</h1>
        </div>
      </div>
      <section className="settings-panel settings-pending">
        <Settings2 size={26} />
        <strong>功能开发中</strong>
        <span>更多常用设置将在后续版本提供。</span>
      </section>
    </div>
  );
}
function FileManagementView({
  loading,
  jobs,
  activeJobs,
  selectedJobId,
  search,
  pickerOpen,
  detailTab,
  detailFiles,
  detailPage,
  detailTotal,
  detailCounts,
  onSearch,
  onPickerOpen,
  onSelect,
  onTab,
  onPage,
  onTransfer,
  onStop,
  onRefresh,
}: {
  loading: boolean;
  jobs: SyncJob[];
  activeJobs: SyncJob[];
  selectedJobId: number | null;
  search: string;
  pickerOpen: boolean;
  detailTab: DetailTab;
  detailFiles: TransferFile[];
  detailPage: number;
  detailTotal: number;
  detailCounts: { transferring: number; queued: number; finished: number };
  onSearch: (value: string) => void;
  onPickerOpen: (open: boolean) => void;
  onSelect: (id: number) => void;
  onTab: (tab: DetailTab) => void;
  onPage: (page: number) => void;
  onTransfer: () => void;
  onStop: (id: number) => void;
  onRefresh: () => void;
}) {
  const filtered = jobs.filter((job) =>
    `${job.name} ${job.source} ${job.destination}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const selected = jobs.find((job) => job.id === selectedJobId);
  const pageCount = Math.max(1, Math.ceil(detailTotal / 100));
  return (
    <>
      <div className="task-management-toolbar">
        <div className="task-heading">
          {selected ? (
            <>
              <p>当前任务</p>
              <h1>{selected.name}</h1>
              <span>
                {selected.source} → {selected.destination}
              </span>
            </>
          ) : (
            <>
              <p>同步任务</p>
              <h1>任务</h1>
              <span>选择或搜索一个任务查看详情</span>
            </>
          )}
        </div>
        <div className="task-toolbar-actions">
          <div
            className="job-search-control"
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              )
                setTimeout(() => onPickerOpen(false), 0);
            }}
          >
            <div>
              <Search size={16} />
              <input
                aria-label="搜索同步任务"
                placeholder="搜索任务名称或路径"
                value={search}
                onFocus={() => onPickerOpen(true)}
                onChange={(event) => {
                  onSearch(event.target.value);
                  onPickerOpen(true);
                }}
              />
              <button
                type="button"
                aria-label="显示任务列表"
                onClick={() => onPickerOpen(!pickerOpen)}
              >
                <ChevronDown size={16} />
              </button>
            </div>
            {pickerOpen && (
              <div className="job-search-menu">
                {filtered.length === 0 ? (
                  <span className="job-picker-empty">未找到匹配任务</span>
                ) : (
                  filtered.map((job) => (
                    <button
                      type="button"
                      className={`job-picker-item ${job.id === selectedJobId ? "active" : ""}`}
                      key={job.id}
                      onClick={() => onSelect(job.id)}
                    >
                      <span>
                        <strong>{job.name}</strong>
                        <small>
                          {job.operation.toUpperCase()} · {job.source} →{" "}
                          {job.destination}
                        </small>
                      </span>
                      <Chip
                        size="sm"
                        color={statusColor[job.status]}
                        variant="flat"
                      >
                        {job.status}
                      </Chip>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <Tooltip content="刷新任务">
            <ActionButton iconOnly aria-label="刷新任务" onClick={onRefresh}>
              <RefreshCw size={17} />
            </ActionButton>
          </Tooltip>
          <ActionButton
            className="primary-action"
            icon={<Plus size={18} />}
            onClick={onTransfer}
          >
            新建同步
          </ActionButton>
        </div>
      </div>
      <section className="task-file-view full-task-view">
        {loading ? (
          <div className="table-loading">
            <Spinner color="primary" />
            <span>正在读取任务</span>
          </div>
        ) : !selected ? (
          <div className="table-empty">
            <Folder size={30} />
            <strong>尚未选择任务</strong>
            <span>使用右上角搜索选择任务，或新建一个同步任务。</span>
          </div>
        ) : (
          <>
            <header className="selected-job-heading">
              <div>
                <Chip color={statusColor[selected.status]} variant="flat">
                  {selected.status}
                </Chip>
                <span>
                  {selected.operation === "sync" ? "镜像同步" : "增量复制"} ·
                  创建于 {new Date(selected.createdAt).toLocaleString()}
                </span>
              </div>
              <div>
                {selected.status === "running" && (
                  <ActionButton
                    className="danger-action"
                    iconOnly
                    aria-label="取消任务"
                    onClick={() => onStop(selected.id)}
                  >
                    <X size={16} />
                  </ActionButton>
                )}
              </div>
            </header>
            <nav className="detail-tabs">
              <button
                className={detailTab === "transferring" ? "active" : ""}
                onClick={() => onTab("transferring")}
              >
                进行中 <b>{detailCounts.transferring + detailCounts.queued}</b>
              </button>
              <button
                className={detailTab === "finished" ? "active" : ""}
                onClick={() => onTab("finished")}
              >
                已完成 <b>{detailCounts.finished}</b>
              </button>
              <button
                className={detailTab === "information" ? "active" : ""}
                onClick={() => onTab("information")}
              >
                任务信息
              </button>
            </nav>
            {detailTab === "information" ? (
              <TaskInfo job={selected} />
            ) : (
              <section className="file-section tab-file-section">
                <div className="file-section-heading">
                  <strong>
                    {detailTab === "transferring" ? "进行中" : "已完成"}
                  </strong>
                  <span>
                    {detailTab === "transferring"
                      ? `${formatSize(selected.stats?.speed)}/s`
                      : `${formatSize(selected.stats?.bytes)} / ${formatSize(selected.stats?.totalBytes)}`}
                  </span>
                </div>
                {detailFiles.length ? (
                  <>
                    <FileRows files={detailFiles} />
                    <div className="file-pagination">
                      <span>
                        第 {detailPage} / {pageCount} 页，共 {detailTotal}{" "}
                        个文件
                      </span>
                      <div>
                        <ActionButton
                          disabled={detailPage <= 1}
                          onClick={() => onPage(detailPage - 1)}
                        >
                          上一页
                        </ActionButton>
                        <ActionButton
                          disabled={detailPage >= pageCount}
                          onClick={() => onPage(detailPage + 1)}
                        >
                          下一页
                        </ActionButton>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="file-section-empty">
                    {detailTab === "transferring"
                      ? "当前没有正在传输的文件。"
                      : "尚未记录完成或失败的文件。"}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </section>
    </>
  );
}
function TaskInfo({ job }: { job: SyncJob }) {
  return (
    <section className="task-information">
      <strong>任务信息</strong>
      <dl>
        <div>
          <dt>同步方式</dt>
          <dd>{job.operation === "sync" ? "镜像同步" : "增量复制"}</dd>
        </div>
        <div>
          <dt>任务状态</dt>
          <dd>{job.status}</dd>
        </div>
        <div>
          <dt>文件进度</dt>
          <dd>
            {job.stats?.transfers || 0} / {job.stats?.totalTransfers || 0}
          </dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{new Date(job.createdAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>完成时间</dt>
          <dd>
            {job.finishedAt ? new Date(job.finishedAt).toLocaleString() : "--"}
          </dd>
        </div>
        <div>
          <dt>预计剩余</dt>
          <dd>{job.stats?.eta ? formatDuration(job.stats.eta) : "--"}</dd>
        </div>
      </dl>
      {job.error && <p className="task-error">{job.error}</p>}
    </section>
  );
}
function FileRows({ files }: { files: TransferFile[] }) {
  const samples = useRef(
    new Map<number, { bytes: number; timestamp: number }>(),
  );
  const now = Date.now();
  return (
    <div className="managed-file-list">
      {files.map((file) => {
        const previous = samples.current.get(file.id);
        const speed = previous
          ? Math.max(
              0,
              ((file.bytes - previous.bytes) * 1000) /
                (now - previous.timestamp),
            )
          : 0;
        samples.current.set(file.id, { bytes: file.bytes, timestamp: now });
        const progress = file.size
          ? Math.min(100, Math.round((file.bytes / file.size) * 100))
          : 0;
        return (
          <div className="managed-file-row" key={file.id}>
            <span className="file-badge">
              <Copy size={15} />
            </span>
            <div className="managed-file-main">
              <strong>{file.path}</strong>
              <div className="file-progress-meta">
                <span>
                  {formatSize(file.bytes)} / {formatSize(file.size)}
                </span>
                {file.status === "transferring" && (
                  <>
                    <span>{formatSize(speed)}/s</span>
                    <b>{progress}%</b>
                  </>
                )}
              </div>
              {file.status === "transferring" && (
                <div
                  className="file-progress-track"
                  role="progressbar"
                  aria-label={`${file.path} 上传进度`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                >
                  <span style={{ width: `${progress}%` }} />
                </div>
              )}
              {file.error && <small>{file.error}</small>}
            </div>
            <Chip
              size="sm"
              color={
                file.status === "failed"
                  ? "danger"
                  : file.status === "transferring"
                    ? "warning"
                    : file.status === "queued"
                      ? "default"
                      : "success"
              }
              variant="flat"
            >
              {file.status === "queued"
                ? "等待中"
                : file.status === "transferring"
                  ? "传输中"
                  : file.status === "completed"
                    ? "已完成"
                    : "失败"}
            </Chip>
          </div>
        );
      })}
    </div>
  );
}
function TaskHistoryView({
  loading,
  jobs,
  activeJobs,
  remotes,
  expandedJobId,
  onAdd,
  onTransfer,
  onRefresh,
  onStop,
  onToggle,
}: any) {
  return (
    <>
      <div className="content-heading">
        <div>
          <p className="crumb">文件空间 / 全部文件</p>
          <h1>文件管理</h1>
        </div>
        <ActionButton
          className="primary-action"
          icon={<Plus size={18} />}
          onClick={onTransfer}
        >
          新建同步
        </ActionButton>
      </div>
      <div className="storage-cards">
        <SummaryCard
          label="已连接"
          value={`${remotes.length} 个远端`}
          caption="远端存储"
          action={onAdd}
        />
        <SummaryCard
          label="传输总量"
          value={`${jobs.length} 个任务`}
          caption="SQLite 历史记录"
        />
        <SummaryCard
          label="运行中"
          value={`${activeJobs.length} 个任务`}
          caption="实时同步"
        />
        <SummaryCard label="RC 服务" value="在线" caption="服务状态" />
      </div>
      <div className="file-toolbar">
        <ActionButton className="active-toolbar">任务列表</ActionButton>
        <ActionButton icon={<RefreshCw size={15} />} onClick={onRefresh}>
          刷新
        </ActionButton>
      </div>
      <div className="task-table">
        <div className="table-head">
          <span>任务名称</span>
          <span>源存储</span>
          <span>类型</span>
          <span>状态</span>
          <span>创建时间</span>
          <span>操作</span>
        </div>
        {loading ? (
          <div className="table-loading">
            <Spinner color="primary" />
            <span>正在读取任务</span>
          </div>
        ) : jobs.length === 0 ? (
          <div className="table-empty">
            <Folder size={30} />
            <strong>尚无同步任务</strong>
          </div>
        ) : (
          jobs.map((job: SyncJob) => (
            <div key={job.id}>
              <div
                className="table-row task-row-clickable"
                onClick={() => onToggle(job.id)}
              >
                <div className="task-name">
                  <span className="file-badge">
                    <Copy size={17} />
                  </span>
                  <div>
                    <strong>{job.name}</strong>
                    <small>
                      {job.source} → {job.destination}
                    </small>
                  </div>
                </div>
                <span>{job.source.split(":", 1)[0]}</span>
                <span className="mono">{job.operation.toUpperCase()}</span>
                <Chip size="sm" color={statusColor[job.status]} variant="flat">
                  {job.status}
                </Chip>
                <span className="mono">
                  {new Date(job.createdAt).toLocaleString()}
                </span>
                <div
                  className="task-actions"
                  onClick={(event) => event.stopPropagation()}
                >
                  <ActionButton
                    className="detail-action"
                    onClick={() => onToggle(job.id)}
                  >
                    {expandedJobId === job.id ? "收起" : "详情"}
                  </ActionButton>
                  {job.status === "running" && (
                    <ActionButton
                      className="danger-action"
                      iconOnly
                      aria-label="取消任务"
                      onClick={() => onStop(job.id)}
                    >
                      <X size={16} />
                    </ActionButton>
                  )}
                </div>
              </div>
              {expandedJobId === job.id && <TaskDetails job={job} />}
            </div>
          ))
        )}
      </div>
    </>
  );
}
function TaskDetails({ job }: { job: SyncJob }) {
  return (
    <div className="task-details">
      <div className="task-progress">
        <strong>总体进度</strong>
        <Progress
          size="sm"
          value={progressPercent(job)}
          aria-label="总体进度"
        />
        <small>
          {formatSize(job.stats?.bytes)} / {formatSize(job.stats?.totalBytes)} ·{" "}
          {job.stats?.transfers || 0} / {job.stats?.totalTransfers || 0} 个文件
          · {formatSize(job.stats?.speed)}/s
        </small>
      </div>
      <div className="file-transfer-list">
        <strong>文件传输明细</strong>
        {!job.files?.length ? (
          <span>没有可展示的文件传输记录。</span>
        ) : (
          job.files.map((file) => (
            <div className="file-transfer-row" key={file.id}>
              <span>{file.path}</span>
              <span>
                {formatSize(file.bytes)} / {formatSize(file.size)}
              </span>
              <Chip
                size="sm"
                color={
                  file.status === "failed"
                    ? "danger"
                    : file.status === "transferring"
                      ? "warning"
                      : "success"
                }
                variant="flat"
              >
                {file.status}
              </Chip>
              {file.error && <small>{file.error}</small>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
function SyncLocationPicker({
  label,
  location,
  remotes,
  onRemoteChange,
  onDirectoryChange,
}: {
  label: string;
  location: SyncLocation;
  remotes: Remote[];
  onRemoteChange: (name: string) => void;
  onDirectoryChange: (path: string) => void;
}) {
  const locationPath = `${location.remoteName}:${location.path ? `/${location.path}` : ""}`;
  return (
    <section className="sync-location-picker">
      <div className="sync-location-heading">
        <strong>{label}</strong>
        <span>{location.remoteName ? locationPath : "选择已添加的存储"}</span>
      </div>
      <select
        aria-label={`选择${label}存储`}
        value={location.remoteName}
        onChange={(event) => onRemoteChange(event.target.value)}
      >
        <option value="">选择存储</option>
        {remotes.map((remote) => (
          <option key={remote.id} value={remote.name}>
            {remote.name} · {remote.type}
          </option>
        ))}
      </select>
      {location.remoteName && (
        <div className="sync-directory-browser">
          {location.path && (
            <button
              type="button"
              className="sync-directory-up"
              onClick={() =>
                onDirectoryChange(
                  location.path.split("/").slice(0, -1).join("/"),
                )
              }
            >
              返回上一级
            </button>
          )}
          {location.loading ? (
            <div className="sync-directory-empty">
              <Spinner size="sm" /> 正在读取目录
            </div>
          ) : location.entries.filter((entry) => entry.IsDir).length === 0 ? (
            <div className="sync-directory-empty">当前目录没有子目录</div>
          ) : (
            location.entries
              .filter((entry) => entry.IsDir)
              .map((entry) => (
                <button
                  type="button"
                  className="sync-directory-entry"
                  key={entry.Path || entry.Name}
                  onClick={() =>
                    onDirectoryChange(
                      entry.Path ||
                        (location.path
                          ? `${location.path}/${entry.Name}`
                          : entry.Name),
                    )
                  }
                >
                  <Folder size={15} />
                  <span>{entry.Name}</span>
                  <ChevronDown className="directory-chevron" size={14} />
                </button>
              ))
          )}
        </div>
      )}
    </section>
  );
}
function SourceConfigFields({
  type,
  config,
  onChange,
}: {
  type: string;
  config: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const field = (
    key: string,
    label: string,
    placeholder = "",
    required = false,
    password = false,
  ) => (
    <label className="source-field">
      <span>{label}</span>
      <input
        placeholder={placeholder}
        type={password ? "password" : "text"}
        value={config[key] || ""}
        onChange={(event) => onChange(key, event.target.value)}
        required={required}
      />
    </label>
  );
  if (type === "local")
    return (
      <div className="source-field-note">
        本地文件系统无需额外配置，rclone 将使用运行服务的机器路径。
      </div>
    );
  if (type === "webdav")
    return (
      <>
        {field(
          "url",
          "WebDAV URL",
          "https://dav.example.com/remote.php/dav/files/user",
          true,
        )}
        <label className="source-field">
          <span>服务商</span>
          <select
            value={config.vendor || "other"}
            onChange={(event) => onChange("vendor", event.target.value)}
          >
            {["other", "nextcloud", "owncloud", "sharepoint"].map((vendor) => (
              <option key={vendor} value={vendor}>
                {vendor}
              </option>
            ))}
          </select>
        </label>
        {field("user", "用户名")}
        {field("pass", "密码", "", false, true)}
      </>
    );
  if (type === "smb")
    return (
      <>
        {field("host", "主机地址", "192.168.1.10 或 server/share", true)}
        {field("user", "用户名")}
        {field("pass", "密码", "", false, true)}
        {field("domain", "域名", "可选")}
      </>
    );
  if (type === "ftp")
    return (
      <>
        {field("host", "FTP 主机地址", "ftp.example.com", true)}
        {field("port", "端口", "21")}
        {field("user", "用户名")}
        {field("pass", "密码", "", false, true)}
        <label className="source-field">
          <span>显式 TLS</span>
          <select
            value={config.explicit_tls || "false"}
            onChange={(event) => onChange("explicit_tls", event.target.value)}
          >
            <option value="false">关闭</option>
            <option value="true">开启</option>
          </select>
        </label>
      </>
    );
  return (
    <>
      {field("host", "SFTP 主机地址", "sftp.example.com", true)}
      {field("port", "端口", "22")}
      {field("user", "用户名")}
      {field("pass", "密码", "", false, true)}
      {field(
        "key_file",
        "SSH 私钥文件",
        "可选，例如 C:\\Users\\user\\.ssh\\id_ed25519",
      )}
    </>
  );
}
function ActionButton({
  children,
  className = "",
  icon,
  endIcon,
  iconOnly = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: React.ReactNode;
  endIcon?: React.ReactNode;
  iconOnly?: boolean;
}) {
  return (
    <button
      type="button"
      className={`action-button ${iconOnly ? "icon-only" : ""} ${className}`}
      {...props}
    >
      {icon || (iconOnly ? children : null)}
      {!iconOnly && <span>{children}</span>}
      {endIcon}
    </button>
  );
}
function ConfirmDialog({
  open,
  title,
  message,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="confirm-dialog-backdrop"
      role="presentation"
      onMouseDown={onCancel}
    >
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="confirm-dialog-icon">
          <Trash2 size={20} />
        </div>
        <div className="confirm-dialog-content">
          <h2 id="confirm-dialog-title">{title}</h2>
          <p>{message}</p>
        </div>
        <div className="confirm-dialog-footer">
          <ActionButton className="dialog-cancel" onClick={onCancel}>
            取消
          </ActionButton>
          <ActionButton className="danger-confirm" onClick={onConfirm}>
            确认删除
          </ActionButton>
        </div>
      </section>
    </div>
  );
}
function formatSize(size = 0) {
  if (!size) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(size) / Math.log(1024)),
    units.length - 1,
  );
  return `${(size / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
function progressPercent(job: SyncJob) {
  const total = job.stats?.totalBytes || 0;
  return total
    ? Math.min(100, Math.round(((job.stats?.bytes || 0) / total) * 100))
    : 0;
}
function formatDuration(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  return value >= 3600
    ? `${Math.floor(value / 3600)}小时${Math.floor((value % 3600) / 60)}分`
    : value >= 60
      ? `${Math.floor(value / 60)}分${value % 60}秒`
      : `${value}秒`;
}
