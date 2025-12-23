import { useEffect, useMemo, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
    AppBar,
    Toolbar,
    Button,
    Box,
    Container,
    Paper,
    Stack,
    TextField,
    Typography,
    Divider,
    Snackbar,
    Alert,
    Tooltip,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    CircularProgress,
    FormControl,
    Select,
    MenuItem,
} from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import SaveIcon from "@mui/icons-material/Save";
import SaveAsIcon from "@mui/icons-material/SaveAs";
import AddIcon from "@mui/icons-material/Add";
import SortByAlphaIcon from "@mui/icons-material/SortByAlpha";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import LanguageIcon from "@mui/icons-material/Language";
import { invoke } from "@tauri-apps/api/core";

/** ===== 与后端通信的数据结构（保持稳定！） ===== */
type BackendEntry = { key: string; value: string };

type BackendDocument = {
    file_path: string | null; // 当前文件路径；新建/未打开时可为 null
    entries: BackendEntry[];
};

type SaveResult = {
    file_path: string | null; // 保存后返回路径（另存为/首次保存时会变）
};
/** ========================================= */

type UiEntry = {
    id: string;
    key: string; // 可见 ASCII，长度 1..8 字节（前端强约束）
    value: string; // 多行
};

type Lang = "zh" | "en";

function makeId() {
    const c = (globalThis as any).crypto;
    return typeof c?.randomUUID === "function"
        ? c.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** 允许 ASCII 可见字符：0x20(' ')..0x7E('~')，最多 8 字节 */
function normalizeKey(input: string) {
    // 去掉非可见 ASCII（包括中文/emoji/控制字符等）
    const asciiPrintable = input.replace(/[^\x20-\x7E]/g, "");
    // 截断到 8 字节（对 ASCII 来说 = 8 个字符）
    return asciiPrintable.slice(0, 8);
}



function toBackendDoc(filePath: string | null, entries: UiEntry[]): BackendDocument {
    return {
        file_path: filePath,
        entries: entries.map((e) => ({ key: e.key, value: e.value })),
    };
}

function fromBackendDoc(doc: BackendDocument): { filePath: string | null; entries: UiEntry[] } {
    return {
        filePath: doc.file_path,
        entries: doc.entries.map((e) => ({ id: makeId(), key: e.key, value: e.value })),
    };
}

async function invokeCmd<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    return await invoke<T>(cmd, args);
}

async function pickOpenGxtPath(): Promise<string | null> {
    const picked = await open({
        multiple: false,
        filters: [{ name: "GXT", extensions: ["gxt"] }],
    });
    if (!picked) return null;
    return Array.isArray(picked) ? picked[0] ?? null : picked;
}

async function pickSaveGxtPath(defaultPath?: string | null): Promise<string | null> {
    const picked = await save({
        defaultPath: defaultPath ?? undefined,
        filters: [{ name: "GXT", extensions: ["gxt"] }],
    });
    return picked ?? null;
}


/** ======= i18n ======= */
const LANG_STORAGE_KEY = "gxt_editor_lang";

function detectLangFromSystem(): Lang {
    const langs = (navigator.languages && navigator.languages.length > 0
            ? navigator.languages
            : [navigator.language]
    ).filter(Boolean);

    for (const l of langs) {
        if (typeof l === "string" && l.toLowerCase().startsWith("zh")) return "zh";
    }
    return "en";
}

const I18N = {
    zh: {
        appTitle: "GXT 编辑器",
        new: "新建",
        open: "打开",
        add: "新增",
        sort: "排序",
        save: "保存",
        saveAs: "另存为",
        entriesList: "条目列表",
        entriesHint: "KEY 允许可见 ASCII 字符（0x20-0x7E），长度 1..8 字节；VALUE 支持多行。",
        emptyHint: "暂无内容。点击上方“新增”开始编辑。",
        addAtEnd: "在末尾新增",
        statusNoFile: "未选择文件",
        statusEntries: (n: number) => `${n} 条`,
        statusDirty: "未保存",
        tooltipNew: "新建（Ctrl+N）",
        tooltipOpen: "打开 .gxt（Ctrl+O）",
        tooltipAdd: "在末尾新增一个键值对",
        tooltipSort: "按 KEY（A-Z）排序",
        tooltipSaveInvalid: "存在 KEY 错误/空值/重复",
        tooltipSaveNew: "保存（Ctrl+S），将弹出“另存为”",
        tooltipSave: "保存（Ctrl+S）",
        tooltipSaveAs: "另存为",
        dialogUnsavedTitle: "有未保存更改",
        dialogUnsavedBody: "当前内容尚未保存。继续操作会丢失修改。",
        dialogCancel: "取消",
        dialogDiscard: "丢弃并继续",
        snackNew: "已新建空文档",
        snackLoaded: "已加载",
        snackLoadedAssoc: "已从关联文件加载",
        snackLoadFail: "加载失败",
        snackSaved: "已保存",
        snackSaveFail: "保存失败",
        snackSaveAsDone: "已另存为",
        snackSaveAsFail: "另存为失败",
        keyLabel: (idx: number) => `KEY #${idx + 1}`,
        valueLabel: "VALUE",
        keyHelpEmpty: "必填",
        keyHelpDup: "KEY 重复",
        // keyHelpOk: "最多 8 位，仅 A-Z / 0-9",
        keyHelpOk: "",
        valuePlaceholder: "两三句话都行…",
        fixValidationFirst: "存在 KEY 校验错误或重复，请先修正",
        langLabel: "语言",
        langZh: "中文",
        langEn: "English",
        keyHelpInvalid: "KEY 必须是可见 ASCII（0x20-0x7E），长度 1..8 字节",
    },
    en: {
        appTitle: "GXT Editor",
        new: "New",
        open: "Open",
        add: "Add",
        sort: "Sort",
        save: "Save",
        saveAs: "Save As",
        entriesList: "Entries",
        entriesHint: "KEY: printable ASCII (0x20-0x7E), length 1..8 bytes. VALUE supports multi-line.",
        emptyHint: "No entries yet. Click “Add” to start editing.",
        addAtEnd: "Add at end",
        statusNoFile: "No file",
        statusEntries: (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`,
        statusDirty: "Unsaved",
        tooltipNew: "New (Ctrl+N)",
        tooltipOpen: "Open .gxt (Ctrl+O)",
        tooltipAdd: "Append a new key/value entry",
        tooltipSort: "Sort by KEY (A-Z)",
        tooltipSaveInvalid: "Fix invalid/empty/duplicate keys first",
        tooltipSaveNew: "Save (Ctrl+S) — will prompt Save As",
        tooltipSave: "Save (Ctrl+S)",
        tooltipSaveAs: "Save As",
        dialogUnsavedTitle: "Unsaved changes",
        dialogUnsavedBody: "Your changes are not saved. Continuing will discard them.",
        dialogCancel: "Cancel",
        dialogDiscard: "Discard & Continue",
        snackNew: "New document created",
        snackLoaded: "Loaded",
        snackLoadedAssoc: "Loaded from associated file",
        snackLoadFail: "Load failed",
        snackSaved: "Saved",
        snackSaveFail: "Save failed",
        snackSaveAsDone: "Saved as",
        snackSaveAsFail: "Save As failed",
        keyLabel: (idx: number) => `KEY #${idx + 1}`,
        valueLabel: "VALUE",
        keyHelpEmpty: "Required",
        keyHelpDup: "Duplicate KEY",
        // keyHelpOk: "Up to 8 chars, A-Z / 0-9 only",
        keyHelpOk: "",
        valuePlaceholder: "A couple of sentences is fine…",
        fixValidationFirst: "Fix key validation errors or duplicates first",
        langLabel: "Language",
        langZh: "中文",
        langEn: "English",
        keyHelpInvalid: "KEY must be printable ASCII (0x20-0x7E), length 1..8 bytes",
    },
} as const;

function useI18n() {
    const [lang, setLang] = useState<Lang>(() => {
        const saved = localStorage.getItem(LANG_STORAGE_KEY) as Lang | null;
        if (saved === "zh" || saved === "en") return saved;
        return detectLangFromSystem();
    });

    useEffect(() => {
        localStorage.setItem(LANG_STORAGE_KEY, lang);
        // 如果你不想持久化，把上一行删掉即可
    }, [lang]);

    const t = I18N[lang];
    return { lang, setLang, t };
}
/** ==================== */

type PendingAction =
    | { kind: "open" }
    | { kind: "new" }
    | { kind: "loadPath"; path: string };

export default function App() {
    const { lang, setLang, t } = useI18n();

    const [filePath, setFilePath] = useState<string | null>(null);
    const [entries, setEntries] = useState<UiEntry[]>([]);
    const [dirty, setDirty] = useState(false);

    const [busy, setBusy] = useState<null | "loading" | "saving">(null);

    const [snack, setSnack] = useState<{
        open: boolean;
        msg: string;
        severity: "success" | "error" | "info";
    }>({ open: false, msg: "", severity: "info" });

    const [confirmUnsavedOpen, setConfirmUnsavedOpen] = useState(false);
    const pendingActionRef = useRef<PendingAction | null>(null);

    const endAnchorRef = useRef<HTMLDivElement | null>(null);

    const keyDupSet = useMemo(() => {
        const mp = new Map<string, number>();
        for (const e of entries) {
            if (!e.key) continue;
            mp.set(e.key, (mp.get(e.key) ?? 0) + 1);
        }
        const dup = new Set<string>();
        for (const [k, cnt] of mp.entries()) if (cnt > 1) dup.add(k);
        return dup;
    }, [entries]);

    const hasValidationError = useMemo(() => {
        for (const e of entries) {
            if (!e.key) return true;
            if (e.key !== normalizeKey(e.key)) return true;
            if (keyDupSet.has(e.key)) return true;
        }
        return false;
    }, [entries, keyDupSet]);

    const statusText = useMemo(() => {
        const fp = filePath ?? t.statusNoFile;
        const base = `${fp} · ${t.statusEntries(entries.length)}`;
        return dirty ? `${base} · ${t.statusDirty}` : base;
    }, [filePath, entries.length, dirty, t]);

    function setDoc(doc: BackendDocument) {
        const parsed = fromBackendDoc(doc);
        setFilePath(parsed.filePath);
        setEntries(parsed.entries);
        setDirty(false);
    }

    function updateEntry(id: string, patch: Partial<UiEntry>) {
        setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
        setDirty(true);
    }

    function addEntryAtEnd() {
        setEntries((prev) => [...prev, { id: makeId(), key: "", value: "" }]);
        setDirty(true);
        requestAnimationFrame(() => {
            endAnchorRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
        });
    }

    // function charRank(ch: string): number {
    //     const code = ch.charCodeAt(0);
    //     // A-Z => 0..25
    //     if (code >= 65 && code <= 90) return code - 65;
    //     // 0-9 => 26..35
    //     if (code >= 48 && code <= 57) return 26 + (code - 48);
    //     // 其他字符理论上不会出现（normalize 过滤了），放最后兜底
    //     return 1000 + code;
    // }

    function compareKey(a: string, b: string): number {
        const A = a ?? "";
        const B = b ?? "";
        const n = Math.min(A.length, B.length);

        for (let i = 0; i < n; i++) {
            const ra = A.charCodeAt(i);
            const rb = B.charCodeAt(i);
            if (ra !== rb) return ra - rb;
        }
        return A.length - B.length;
    }

    function sortByKey() {
        setEntries((prev) => [...prev].sort((x, y) => compareKey(x.key, y.key)));
        setDirty(true);
    }

    async function doNew() {
        setFilePath(null);
        setEntries([]);
        setDirty(false);
        setSnack({ open: true, msg: t.snackNew, severity: "info" });
    }

    async function doOpen() {
        const path = await pickOpenGxtPath();
        if (!path) return; // 用户取消

        try {
            setBusy("loading");
            const doc = await invokeCmd<BackendDocument>("gxt_load", { path });
            setDoc(doc);
            setSnack({ open: true, msg: t.snackLoaded, severity: "success" });
        } catch (e: any) {
            setSnack({ open: true, msg: e?.toString?.() ?? t.snackLoadFail, severity: "error" });
        } finally {
            setBusy(null);
        }
    }


    async function doLoadFromPath(path: string) {
        try {
            setBusy("loading");
            const doc = await invokeCmd<BackendDocument>("gxt_load", { path });
            setDoc(doc);
            setSnack({ open: true, msg: t.snackLoadedAssoc, severity: "success" });
        } catch (e: any) {
            setSnack({ open: true, msg: e?.toString?.() ?? t.snackLoadFail, severity: "error" });
        } finally {
            setBusy(null);
        }
    }

    async function doSaveExistingPath() {
        if (filePath === null) return await doSaveAs();
        if (hasValidationError) {
            setSnack({ open: true, msg: t.fixValidationFirst, severity: "error" });
            return;
        }
        try {
            setBusy("saving");
            const doc = toBackendDoc(filePath, entries);
            const res = await invokeCmd<SaveResult>("gxt_save", { doc });
            if (res?.file_path !== undefined) setFilePath(res.file_path);
            setDirty(false);
            setSnack({ open: true, msg: t.snackSaved, severity: "success" });
        } catch (e: any) {
            setSnack({ open: true, msg: e?.toString?.() ?? t.snackSaveFail, severity: "error" });
        } finally {
            setBusy(null);
        }
    }

    async function doSaveAs() {
        if (hasValidationError) {
            setSnack({ open: true, msg: t.fixValidationFirst, severity: "error" });
            return;
        }

        const pickedPath = await pickSaveGxtPath(filePath);
        if (!pickedPath) return; // 用户取消

        try {
            setBusy("saving");

            // 关键点：SaveAs 时由前端决定路径，然后写进 doc.file_path
            const doc = toBackendDoc(pickedPath, entries);

            const res = await invokeCmd<SaveResult>("gxt_save", { doc });
            if (res?.file_path !== undefined) setFilePath(res.file_path);

            setDirty(false);
            setSnack({ open: true, msg: t.snackSaveAsDone, severity: "success" });
        } catch (e: any) {
            setSnack({ open: true, msg: e?.toString?.() ?? t.snackSaveAsFail, severity: "error" });
        } finally {
            setBusy(null);
        }
    }


    async function onSaveRequested() {
        if (filePath === null) await doSaveAs();
        else await doSaveExistingPath();
    }

    function requestAction(action: PendingAction) {
        if (!dirty) {
            if (action.kind === "open") void doOpen();
            if (action.kind === "new") void doNew();
            if (action.kind === "loadPath") void doLoadFromPath(action.path);
            return;
        }
        pendingActionRef.current = action;
        setConfirmUnsavedOpen(true);
    }

    // Ctrl+S 保存；Ctrl+O 打开；Ctrl+N 新建
    useEffect(() => {
        const onKeyDown = (ev: KeyboardEvent) => {
            const isMac = navigator.platform.toLowerCase().includes("mac");
            const mod = isMac ? ev.metaKey : ev.ctrlKey;

            if (mod && (ev.key === "s" || ev.key === "S")) {
                ev.preventDefault();
                void onSaveRequested();
            }
            if (mod && (ev.key === "o" || ev.key === "O")) {
                ev.preventDefault();
                requestAction({ kind: "open" });
            }
            if (mod && (ev.key === "n" || ev.key === "N")) {
                ev.preventDefault();
                requestAction({ kind: "new" });
            }
        };
        window.addEventListener("keydown", onKeyDown, { capture: true });
        return () => window.removeEventListener("keydown", onKeyDown, { capture: true } as any);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dirty, filePath, entries, hasValidationError, lang]);

    // 若通过文件关联启动，后端返回启动路径，前端自动加载
    useEffect(() => {
        (async () => {
            try {
                const path = await invokeCmd<string | null>("gxt_startup_path");
                if (!path) return;
                requestAction({ kind: "loadPath", path });
            } catch {
                // 没实现就忽略
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const saveDisabled = busy !== null || hasValidationError;

    return (
        <Box sx={{ height: "100vh", display: "flex", flexDirection: "column" }}>
            {/* 顶部固定工具栏 */}
            <AppBar
                position="sticky"
                color="default"
                elevation={0}
                sx={{ borderBottom: 1, borderColor: "divider" }}
            >
                <Toolbar sx={{ gap: 1 }}>
                    <Typography variant="h6" sx={{ mr: 1, userSelect: "none" }}>
                        {t.appTitle}
                    </Typography>

                    <Tooltip title={t.tooltipNew}>
            <span>
              <Button
                  variant="outlined"
                  startIcon={<NoteAddIcon />}
                  onClick={() => requestAction({ kind: "new" })}
                  disabled={busy !== null}
                  sx={{ textTransform: "none" }}
              >
                {t.new}
              </Button>
            </span>
                    </Tooltip>

                    <Tooltip title={t.tooltipOpen}>
            <span>
              <Button
                  variant="contained"
                  startIcon={<UploadFileIcon />}
                  onClick={() => requestAction({ kind: "open" })}
                  disabled={busy !== null}
                  sx={{ textTransform: "none" }}
              >
                {t.open}
              </Button>
            </span>
                    </Tooltip>

                    <Tooltip title={t.tooltipAdd}>
            <span>
              <Button
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={addEntryAtEnd}
                  disabled={busy !== null}
                  sx={{ textTransform: "none" }}
              >
                {t.add}
              </Button>
            </span>
                    </Tooltip>

                    <Tooltip title={t.tooltipSort}>
            <span>
              <Button
                  variant="outlined"
                  startIcon={<SortByAlphaIcon />}
                  onClick={sortByKey}
                  disabled={busy !== null || entries.length < 2}
                  sx={{ textTransform: "none" }}
              >
                {t.sort}
              </Button>
            </span>
                    </Tooltip>

                    <Box sx={{ flex: 1 }} />

                    {/* 语言切换：系统自动 + 手动覆盖 */}
                    <Stack direction="row" spacing={1} alignItems="center">
                        <FormControl size="small" sx={{ minWidth: 140 }}>
                            <Select
                                value={lang}
                                onChange={(e) => setLang(e.target.value as Lang)}
                                displayEmpty
                                renderValue={(v) => (
                                    <Stack direction="row" spacing={1} alignItems="center">
                                        <LanguageIcon fontSize="small" />
                                        <span>{v === "zh" ? t.langZh : t.langEn}</span>
                                    </Stack>
                                )}
                            >
                                <MenuItem value="zh">{t.langZh}</MenuItem>
                                <MenuItem value="en">{t.langEn}</MenuItem>
                            </Select>
                        </FormControl>

                        <Typography variant="body2" sx={{ opacity: 0.9, maxWidth: 520 }} noWrap>
                            {statusText}
                        </Typography>

                        <Tooltip
                            title={
                                hasValidationError
                                    ? t.tooltipSaveInvalid
                                    : filePath === null
                                        ? t.tooltipSaveNew
                                        : t.tooltipSave
                            }
                        >
              <span>
                <Button
                    variant="contained"
                    startIcon={<SaveIcon />}
                    onClick={() => void onSaveRequested()}
                    disabled={saveDisabled}
                    sx={{ textTransform: "none" }}
                >
                  {t.save}
                </Button>
              </span>
                        </Tooltip>

                        <Tooltip title={t.tooltipSaveAs}>
              <span>
                <Button
                    variant="outlined"
                    startIcon={<SaveAsIcon />}
                    onClick={() => void doSaveAs()}
                    disabled={busy !== null || hasValidationError || entries.length === 0}
                    sx={{ textTransform: "none" }}
                >
                  {t.saveAs}
                </Button>
              </span>
                        </Tooltip>

                        {busy && (
                            <Box sx={{ display: "flex", alignItems: "center", ml: 1 }}>
                                <CircularProgress size={18} />
                            </Box>
                        )}
                    </Stack>
                </Toolbar>
            </AppBar>

            {/* 内容区独立滚动 */}
            <Box
                sx={{
                    flex: 1,
                    overflow: "auto",
                    bgcolor: (tTheme) => (tTheme.palette.mode === "light" ? "#f6f7f9" : "background.default"),
                    py: 2,
                }}
            >
                <Container maxWidth="md">
                    <Paper variant="outlined" sx={{ p: 2 }}>
                        <Typography variant="subtitle1" sx={{ mb: 1 }}>
                            {t.entriesList}
                        </Typography>
                        <Typography variant="body2" sx={{ mb: 2, opacity: 0.75 }}>
                            {t.entriesHint}
                        </Typography>
                        <Divider sx={{ mb: 2 }} />

                        <Stack spacing={2}>
                            {entries.length === 0 ? (
                                <Box sx={{ py: 4, textAlign: "center", opacity: 0.7 }}>
                                    <Typography>{t.emptyHint}</Typography>
                                </Box>
                            ) : (
                                entries.map((e, idx) => {
                                    const keyEmpty = !e.key;
                                    const keyDup = e.key && keyDupSet.has(e.key);
                                    const keyInvalid = !!(e.key && e.key !== normalizeKey(e.key));
                                    return (
                                        <Paper key={e.id} variant="outlined" sx={{ p: 2 }}>
                                            <Stack direction="row" spacing={2} alignItems="flex-start">
                                                <TextField
                                                    label={t.keyLabel(idx)}
                                                    value={e.key}
                                                    onChange={(ev) => updateEntry(e.id, { key: normalizeKey(ev.target.value) })}
                                                    inputProps={{ maxLength: 8 }}
                                                    sx={{ width: 180 }}
                                                    error={keyEmpty || keyDup || keyInvalid}
                                                    helperText={
                                                        keyEmpty ? t.keyHelpEmpty :
                                                            keyDup ? t.keyHelpDup :
                                                                keyInvalid ? t.keyHelpInvalid :
                                                                    t.keyHelpOk
                                                    }
                                                />

                                                <TextField
                                                    label={t.valueLabel}
                                                    value={e.value}
                                                    onChange={(ev) => updateEntry(e.id, { value: ev.target.value })}
                                                    multiline
                                                    minRows={3}
                                                    maxRows={10}
                                                    fullWidth
                                                    placeholder={t.valuePlaceholder}
                                                />
                                            </Stack>
                                        </Paper>
                                    );
                                })
                            )}

                            <div ref={endAnchorRef} />
                        </Stack>

                        <Box sx={{ mt: 2, display: "flex", justifyContent: "flex-end" }}>
                            <Button startIcon={<AddIcon />} onClick={addEntryAtEnd} sx={{ textTransform: "none" }}>
                                {t.addAtEnd}
                            </Button>
                        </Box>
                    </Paper>
                </Container>
            </Box>

            {/* 未保存确认对话框 */}
            <Dialog open={confirmUnsavedOpen} onClose={() => setConfirmUnsavedOpen(false)}>
                <DialogTitle>{t.dialogUnsavedTitle}</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" sx={{ mt: 1 }}>
                        {t.dialogUnsavedBody}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmUnsavedOpen(false)}>{t.dialogCancel}</Button>
                    <Button
                        variant="contained"
                        color="error"
                        onClick={() => {
                            setConfirmUnsavedOpen(false);
                            const action = pendingActionRef.current;
                            pendingActionRef.current = null;
                            if (!action) return;
                            if (action.kind === "open") void doOpen();
                            if (action.kind === "new") void doNew();
                            if (action.kind === "loadPath") void doLoadFromPath(action.path);
                        }}
                    >
                        {t.dialogDiscard}
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar
                open={snack.open}
                autoHideDuration={2600}
                onClose={() => setSnack((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            >
                <Alert
                    onClose={() => setSnack((s) => ({ ...s, open: false }))}
                    severity={snack.severity}
                    variant="filled"
                    sx={{ width: "100%" }}
                >
                    {snack.msg}
                </Alert>
            </Snackbar>
        </Box>
    );
}
