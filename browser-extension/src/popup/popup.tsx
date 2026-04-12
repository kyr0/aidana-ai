import "./popup-styles.css";

import { $, render, createRef, createStore } from "defuss";
import type { FC } from "defuss";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Input,
  Label,
  Badge,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Switch,
  Alert,
  AlertTitle,
  AlertDescription,
  Separator,
  Progress,
  DropArea,
} from "defuss-shadcn";
import { createWorkerRpcClient } from "../lib/rpc";
import { registerRpc } from "../lib/rpc";
import type { WorkerRpcApi } from "../worker-rpc";
import { PopupRpc } from "./popup-rpc";

// -- Register popup RPC so the worker can forward captured events to us --
registerRpc("PopupRpc", PopupRpc);

// -- RPC client for the service worker --
type WorkerRpc = { WorkerRpc: WorkerRpcApi };
const rpc = await createWorkerRpcClient<WorkerRpc>();
const { WorkerRpc } = rpc;

const MCP_CONFIG_URL = "http://localhost:31337/mcp/config";

type AidanaMcpConfig = {
  transport: string;
  host: string;
  port: number;
  path: string;
  healthPath: string;
  workspacePath: string;
  autoStart: boolean;
  workQueuePort: number;
};

function buildMcpEndpointLabel(config: AidanaMcpConfig): string {
  return `${config.transport}://${config.host}:${config.port}${config.path}`;
}

async function loadAidanaMcpConfig(): Promise<AidanaMcpConfig | null> {
  try {
    const response = await fetch(MCP_CONFIG_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Aidana MCP config request failed with status ${response.status}.`);
    }

    const data = (await response.json()) as Partial<AidanaMcpConfig>;
    const port = typeof data.port === "number" && data.port > 0 ? data.port : 3211;
    const transport = typeof data.transport === "string" && data.transport.length > 0
      ? data.transport
      : "http";
    const host = typeof data.host === "string" && data.host.length > 0
      ? data.host
      : "127.0.0.1";

    return {
      transport,
      host,
      port,
      path: typeof data.path === "string" && data.path.length > 0 ? data.path : "/mcp",
      healthPath:
        typeof data.healthPath === "string" && data.healthPath.length > 0
          ? data.healthPath
          : "/healthz",
      workspacePath:
        typeof data.workspacePath === "string" && data.workspacePath.length > 0
          ? data.workspacePath
          : "/",
      autoStart: typeof data.autoStart === "boolean" ? data.autoStart : true,
      workQueuePort:
        typeof data.workQueuePort === "number" && data.workQueuePort > 0
          ? data.workQueuePort
          : 3210,
    };
  } catch {
    return null;
  }
}

type VoiceAgentWindowInfo = Awaited<
  ReturnType<WorkerRpcApi["getVoiceAgentWindowInfo"]>
>;

const voiceAgentCardRef = createRef<HTMLDivElement>();
const voiceAgentState: {
  busy: boolean;
  error: string | null;
  info: VoiceAgentWindowInfo | null;
} = {
  busy: false,
  error: null,
  info: null,
};

async function refreshVoiceAgentWindowInfo() {
  try {
    voiceAgentState.info = await WorkerRpc.getVoiceAgentWindowInfo();
    voiceAgentState.error = null;
  } catch (err) {
    voiceAgentState.error = err instanceof Error ? err.message : String(err);
  }
  renderVoiceAgentCard();
}

async function handleVoiceAgentActivate() {
  try {
    voiceAgentState.busy = true;
    voiceAgentState.error = null;
    renderVoiceAgentCard();

    voiceAgentState.info = await WorkerRpc.openVoiceAgentWindow();
  } catch (err) {
    voiceAgentState.error = err instanceof Error ? err.message : String(err);
  } finally {
    voiceAgentState.busy = false;
    renderVoiceAgentCard();
  }
}

await refreshVoiceAgentWindowInfo();

// -- Theme toggle (persisted via chrome.storage prefs) --

// Set up the defuss:theme listener (same pattern as kitchensink)
document.addEventListener("defuss:theme", ((event: CustomEvent) => {
  const mode = event.detail?.mode;
  const isDark =
    mode === "dark"
      ? true
      : mode === "light"
        ? false
        : !document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", isDark);
  themeStore.set({ dark: isDark });
}) as EventListener);

const themeStore = createStore<{ dark: boolean }>({
  dark: window.matchMedia("(prefers-color-scheme: dark)").matches,
});

// Apply initial theme synchronously
document.documentElement.classList.toggle("dark", themeStore.value.dark);

// Restore saved theme from prefs on load
const savedTheme = await rpc.WorkerRpc.getPrefValue(
  "__defuss_ext_darkMode",
  true,
);
if (typeof savedTheme === "boolean") {
  document.documentElement.classList.toggle("dark", savedTheme);
  themeStore.set({ dark: savedTheme });
}

themeStore.subscribe((val) => {
  // Sync the Switch toggle
  if (switchRef.current) {
    switchRef.current.checked = val.dark;
  }
  // Persist theme preference to chrome.storage via worker RPC
  WorkerRpc.setPrefValue("__defuss_ext_darkMode", val.dark, true).catch((err) =>
    console.warn("Failed to persist theme:", err),
  );
});

// -- Counter demo (persisted via defuss-db through the worker) --
const counterStore = createStore({ count: 0 });
const counterRef = createRef<HTMLSpanElement>();

// Restore saved count from defuss-db on load
const savedCount = await WorkerRpc.dbGet("popup_counter");
if (savedCount != null) {
  const parsed = Number(savedCount);
  if (!Number.isNaN(parsed)) {
    counterStore.set({ count: parsed });
  }
}

function updateCount(count: number) {
  counterStore.set({ count });
  // Persist to defuss-db via worker RPC
  WorkerRpc.dbSet("popup_counter", String(count)).catch((err) =>
    console.warn("Failed to persist count:", err),
  );
}

counterStore.subscribe(() => {
  $(counterRef).text(String(counterStore.value.count));
});

// -- Progress demo --
const progressStore = createStore({ value: 33 });
const progressRef = createRef<HTMLDivElement>();

// -- Components --

const switchRef = createRef<HTMLInputElement>();

const ThemeToggle: FC = () => (
  <div class="flex items-center gap-2">
    <Label htmlFor="dark-mode">Dark mode</Label>
    <Switch
      ref={switchRef}
      id="dark-mode"
      checked={themeStore.value.dark}
      onCheckedChange={(checked: boolean) => {
        document.dispatchEvent(
          new CustomEvent("defuss:theme", {
            detail: { mode: checked ? "dark" : "light" },
          }),
        );
      }}
    />
  </div>
);

const CounterCard: FC = () => (
  <Card>
    <CardHeader>
      <CardTitle>Counter</CardTitle>
      <CardDescription>
        Store-driven reactivity demo (persisted in defuss-db)
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div class="flex items-center gap-4">
        <Button
          variant="outline"
          onClick={() => updateCount(counterStore.value.count - 1)}
        >
          -
        </Button>
        <span
          ref={counterRef}
          class="text-2xl font-bold tabular-nums w-12 text-center"
        >
          {String(counterStore.value.count)}
        </span>
        <Button
          variant="outline"
          onClick={() => updateCount(counterStore.value.count + 1)}
        >
          +
        </Button>
      </div>
    </CardContent>
  </Card>
);

const ButtonShowcase: FC = () => (
  <Card>
    <CardHeader>
      <CardTitle>Buttons</CardTitle>
      <CardDescription>All button variants</CardDescription>
    </CardHeader>
    <CardContent class="space-y-3">
      <div class="flex flex-wrap gap-2">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Link</Button>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button size="sm">Small</Button>
        <Button>Default</Button>
        <Button size="lg">Large</Button>
      </div>
    </CardContent>
  </Card>
);

const BadgeShowcase: FC = () => (
  <Card>
    <CardHeader>
      <CardTitle>Badges</CardTitle>
      <CardDescription>Status indicators</CardDescription>
    </CardHeader>
    <CardContent>
      <div class="flex flex-wrap gap-2">
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="destructive">Destructive</Badge>
        <Badge variant="outline">Outline</Badge>
      </div>
    </CardContent>
  </Card>
);

const VoiceAgentCardContent: FC = () => {
  const info = voiceAgentState.info;
  const windowOpen = info?.open ?? false;

  return (
    <Card>
      <CardHeader>
        <div class="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Voice Agent</CardTitle>
            <CardDescription>
              Launch the dedicated Aidana voice session window. The live
              microphone, avatar, and ASR stream run there, not inside this
              toolbar popup.
            </CardDescription>
          </div>
          <Badge variant={windowOpen ? "secondary" : "outline"}>
            {windowOpen ? "Window Open" : "Idle"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <Alert>
          <AlertTitle>Dedicated Session Window</AlertTitle>
          <AlertDescription>
            Use Activate to open or focus the full Voice Agent window. That
            keeps the 3D scene and mic session alive when this popup closes.
          </AlertDescription>
        </Alert>

        <div class="rounded-lg border border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
          {windowOpen
            ? "A Voice Agent window is already open. Activate will focus it."
            : "No Voice Agent window is open yet."}
        </div>

        {voiceAgentState.error && (
          <Alert variant="destructive">
            <AlertTitle>Launch Failed</AlertTitle>
            <AlertDescription>{voiceAgentState.error}</AlertDescription>
          </Alert>
        )}

        <div class="flex gap-2">
          <Button
            class="flex-1"
            disabled={voiceAgentState.busy}
            onClick={() => {
              void handleVoiceAgentActivate();
            }}
          >
            {voiceAgentState.busy
              ? "Opening..."
              : windowOpen
                ? "Focus Window"
                : "Activate"}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              void refreshVoiceAgentWindowInfo();
            }}
          >
            Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

function renderVoiceAgentCard() {
  if (voiceAgentCardRef.current) {
    $(voiceAgentCardRef).jsx(<VoiceAgentCardContent />);
  }
}

const ActiveTabCard: FC = () => (
  <Card>
    <CardHeader>
      <CardTitle>Active Tab</CardTitle>
      <CardDescription>
        Run functions in the active tab's content script via RPC
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div class="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            rpc.WorkerRpc.tabRpcCall(
              "TabRpc",
              "showAlert",
              "Hello from defuss!",
            ).catch((err) => console.warn("tabRpcCall failed:", err));
          }}
        >
          Show Notification
        </Button>
      </div>
    </CardContent>
  </Card>
);

const FormCard: FC = () => (
  <Card>
    <CardHeader>
      <CardTitle>Form</CardTitle>
      <CardDescription>Input components</CardDescription>
    </CardHeader>
    <CardContent class="space-y-3">
      <div class="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" placeholder="Enter your name" />
      </div>
      <div class="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" placeholder="you@example.com" />
      </div>
    </CardContent>
    <CardFooter>
      <Button class="w-full">Submit</Button>
    </CardFooter>
  </Card>
);

const ProgressCard: FC = () => (
  <Card>
    <CardHeader>
      <CardTitle>Progress</CardTitle>
      <CardDescription>Animated progress bar</CardDescription>
    </CardHeader>
    <CardContent class="space-y-3">
      <Progress ref={progressRef} value={progressStore.value.value} />
      <div class="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const next = Math.max(0, progressStore.value.value - 10);
            progressStore.set({ value: next });
            if (progressRef.current) {
              const bar = progressRef.current.querySelector(
                "[role=progressbar]",
              ) as HTMLElement;
              if (bar) bar.style.width = `${next}%`;
            }
          }}
        >
          -10%
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const next = Math.min(100, progressStore.value.value + 10);
            progressStore.set({ value: next });
            if (progressRef.current) {
              const bar = progressRef.current.querySelector(
                "[role=progressbar]",
              ) as HTMLElement;
              if (bar) bar.style.width = `${next}%`;
            }
          }}
        >
          +10%
        </Button>
      </div>
    </CardContent>
  </Card>
);

const AlertShowcase: FC = () => (
  <div class="space-y-3">
    <Alert>
      <AlertTitle>Info</AlertTitle>
      <AlertDescription>This is a default alert message.</AlertDescription>
    </Alert>
    <Alert variant="destructive">
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>Something went wrong.</AlertDescription>
    </Alert>
  </div>
);

// -- Image Drop demo (persisted via blob storage through worker RPC) --
const IMAGE_STORAGE_KEY = "demo_image";
const imageRef = createRef<HTMLImageElement>();
const dropStatusRef = createRef<HTMLParagraphElement>();

// Pre-fetch saved image (applied after render)
const savedImage = await WorkerRpc.readFile(IMAGE_STORAGE_KEY);

const handleImageDrop = async (event: DragEvent) => {
  const file = event.dataTransfer?.files?.[0];
  if (!file || !file.type.startsWith("image/")) {
    if (dropStatusRef.current) {
      dropStatusRef.current.textContent = "Please drop an image file";
    }
    return;
  }

  // Show preview immediately
  const url = URL.createObjectURL(file);
  if (imageRef.current) {
    imageRef.current.src = url;
    imageRef.current.style.display = "block";
  }
  if (dropStatusRef.current) {
    dropStatusRef.current.textContent = `Saving ${file.name}...`;
  }

  // Save via worker RPC
  const buffer = await file.arrayBuffer();
  await rpc.WorkerRpc.saveFile(IMAGE_STORAGE_KEY, buffer);

  if (dropStatusRef.current) {
    dropStatusRef.current.textContent = `Saved: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  }
};

const ImageDropCard: FC = () => (
  <Card>
    <CardHeader>
      <CardTitle>Image Storage</CardTitle>
      <CardDescription>
        Drop an image to save it via blob storage (persists across sessions)
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-3">
      <DropArea size="sm" onDrop={handleImageDrop}>
        <p class="text-sm font-medium">Drop an image here</p>
        <p class="text-xs text-muted-foreground">PNG, JPG, GIF, WebP</p>
      </DropArea>
      <img
        ref={imageRef}
        alt="Stored img"
        class="w-full rounded-lg object-contain max-h-48"
        style={{ display: "none" }}
      />
      <p ref={dropStatusRef} class="text-xs text-muted-foreground" />
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          await rpc.WorkerRpc.deleteFile(IMAGE_STORAGE_KEY);
          if (imageRef.current) {
            imageRef.current.src = "";
            imageRef.current.style.display = "none";
          }
          if (dropStatusRef.current) {
            dropStatusRef.current.textContent = "Image deleted";
          }
        }}
      >
        Clear image
      </Button>
    </CardContent>
  </Card>
);

// -- Workspace path setting (persisted via worker → chrome.storage → server) --
const WORKSPACE_PREF_KEY = "__defuss_agent_workspacePath";
const workspaceStatusRef = createRef<HTMLParagraphElement>();
const dirBrowserRef = createRef<HTMLDivElement>();
const currentPathRef = createRef<HTMLSpanElement>();

const savedWorkspacePath = await WorkerRpc.getPrefValue(WORKSPACE_PREF_KEY, true);
const aidanaMcpConfig = await loadAidanaMcpConfig();
const aidanaWorkspacePath =
  typeof aidanaMcpConfig?.workspacePath === "string" && aidanaMcpConfig.workspacePath.length > 0
    ? aidanaMcpConfig.workspacePath
    : null;
const initialWorkspacePath = aidanaWorkspacePath ||
  (typeof savedWorkspacePath === "string" ? savedWorkspacePath : "/");
const mcpEndpointLabel = aidanaMcpConfig ? buildMcpEndpointLabel(aidanaMcpConfig) : null;

if (
  aidanaWorkspacePath &&
  (typeof savedWorkspacePath !== "string" || savedWorkspacePath !== aidanaWorkspacePath)
) {
  await WorkerRpc.setPrefValue(WORKSPACE_PREF_KEY, aidanaWorkspacePath, true);
}

// Directory browser state
const dirStore = createStore<{
  open: boolean;
  currentPath: string;
  entries: Array<{ name: string; isDirectory: boolean }>;
  loading: boolean;
  error: string | null;
}>({
  open: false,
  currentPath: initialWorkspacePath,
  entries: [],
  loading: false,
  error: null,
});

/** Navigate the directory browser to an absolute path */
async function browseTo(targetPath: string) {
  dirStore.set({
    ...dirStore.value,
    loading: true,
    error: null,
  });
  renderDirBrowser();

  try {
    const entries = await WorkerRpc.listDirectory(targetPath);
    dirStore.set({
      open: true,
      currentPath: targetPath,
      entries,
      loading: false,
      error: null,
    });
  } catch (err: unknown) {
    dirStore.set({
      ...dirStore.value,
      loading: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  renderDirBrowser();
}

/** Get parent directory (simple string split, works for unix paths) */
function parentDir(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  parts.pop();
  return parts.length <= 1 ? "/" : parts.join("/");
}

/** Join path segments */
function joinPath(base: string, name: string): string {
  return base === "/" ? `/${name}` : `${base}/${name}`;
}

/** Select the current directory as workspace path */
async function selectCurrentDir() {
  const path = dirStore.value.currentPath;
  try {
    await WorkerRpc.syncWorkspacePath(path);
    dirStore.set({ ...dirStore.value, open: false });
    if (currentPathRef.current)
      currentPathRef.current.textContent = path;
    if (workspaceStatusRef.current)
      workspaceStatusRef.current.textContent = `Saved: ${path}`;
  } catch (err) {
    if (workspaceStatusRef.current)
      workspaceStatusRef.current.textContent = `Error: ${err}`;
  }
  renderDirBrowser();
}

const DirBrowserContent: FC = () => {
  const { open, currentPath, entries, loading, error } = dirStore.value;
  if (!open) return <></>;

  const dirs = entries.filter((e) => e.isDirectory);

  return (
    <div class="border rounded-md mt-2 overflow-hidden">
      <div class="bg-muted px-3 py-2 text-xs font-mono truncate border-b">
        {currentPath}
      </div>

      <div class="max-h-48 overflow-y-auto">
        {loading && (
          <div class="px-3 py-2 text-sm text-muted-foreground">Loading…</div>
        )}

        {error && (
          <div class="px-3 py-2 text-sm text-destructive">{error}</div>
        )}

        {!loading && !error && (
          <>
            {currentPath !== "/" && (
              <button
                class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center gap-2 border-b"
                onClick={() => browseTo(parentDir(currentPath))}
              >
                <span class="opacity-60">📁</span> ..
              </button>
            )}
            {dirs.map((entry) => (
              <button
                key={entry.name}
                class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center gap-2 border-b last:border-b-0"
                onClick={() => browseTo(joinPath(currentPath, entry.name))}
              >
                <span class="opacity-60">📁</span> {entry.name}
              </button>
            ))}
            {!loading && dirs.length === 0 && currentPath === "/" && (
              <div class="px-3 py-2 text-sm text-muted-foreground">
                No subdirectories
              </div>
            )}
          </>
        )}
      </div>

      <div class="flex gap-2 p-2 border-t">
        <Button
          size="sm"
          class="flex-1"
          onClick={selectCurrentDir}
        >
          Select this directory
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            dirStore.set({ ...dirStore.value, open: false });
            renderDirBrowser();
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
};

function renderDirBrowser() {
  if (dirBrowserRef.current) {
    $(dirBrowserRef).jsx(<DirBrowserContent />);
  }
}

const SettingsCard: FC = () => (
  <Card>
    <CardHeader>
      <CardTitle>Workspace</CardTitle>
      <CardDescription>
        Directory used by file tools (file_read, file_write, delete_file). The
        popup initializes from Aidana&apos;s MCP config when available, and changes
        are pushed to the MCP server immediately.
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-3">
      <div class="grid gap-2">
        <Label>Workspace path</Label>
        <div class="flex items-center gap-2">
          <div class="flex-1 min-w-0 rounded-md border px-3 py-2 text-sm font-mono truncate bg-muted">
            <span ref={currentPathRef}>
              {initialWorkspacePath || "(not set)"}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (dirStore.value.open) {
                dirStore.set({ ...dirStore.value, open: false });
                renderDirBrowser();
              } else {
                browseTo(dirStore.value.currentPath);
              }
            }}
          >
            Browse
          </Button>
        </div>
      </div>
      <div ref={dirBrowserRef}>
        <DirBrowserContent />
      </div>
      <p class="text-xs text-muted-foreground">
        {mcpEndpointLabel
          ? `Aidana MCP endpoint: ${mcpEndpointLabel}`
          : "Aidana MCP config is unavailable; using the last stored workspace path."}
      </p>
      <p ref={workspaceStatusRef} class="text-xs text-muted-foreground" />
    </CardContent>
  </Card>
);

const App: FC = () => (
  <div class="p-4 space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold tracking-tight">Aidana Agent</h1>
      <ThemeToggle />
    </div>
    <Separator />
    <Tabs defaultValue="voice-agent">
      <TabsList class="grid h-auto w-full grid-cols-3 gap-2">
        <TabsTrigger value="voice-agent">Voice Agent</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
        <TabsTrigger value="components">Components</TabsTrigger>
        <TabsTrigger value="forms">Forms</TabsTrigger>
        <TabsTrigger value="feedback">Feedback</TabsTrigger>
      </TabsList>
      <TabsContent value="voice-agent" class="space-y-4 mt-4">
        <div ref={voiceAgentCardRef}>
          <VoiceAgentCardContent />
        </div>
      </TabsContent>
      <TabsContent value="settings" class="space-y-4 mt-4">
        <SettingsCard />
      </TabsContent>
      <TabsContent value="components" class="space-y-4 mt-4">
        <ActiveTabCard />
        <ImageDropCard />
        <ButtonShowcase />
        <BadgeShowcase />
        <CounterCard />
      </TabsContent>
      <TabsContent value="forms" class="space-y-4 mt-4">
        <FormCard />
        <ProgressCard />
      </TabsContent>
      <TabsContent value="feedback" class="space-y-4 mt-4">
        <AlertShowcase />
      </TabsContent>
    </Tabs>
  </div>
);

render(<App />, document.getElementById("app")!);

// Apply pre-fetched data now that refs are populated
if (typeof savedTheme === "boolean" && switchRef.current) {
  switchRef.current.checked = savedTheme;
}

if (savedImage) {
  const blob = new Blob([savedImage]);
  const imageUrl = URL.createObjectURL(blob);
  if (imageRef.current) {
    imageRef.current.src = imageUrl;
    imageRef.current.style.display = "block";
  }
  if (dropStatusRef.current) {
    dropStatusRef.current.textContent = "Image restored from storage";
  }
}
