
import express from "express";
import session from "express-session";
import multer from "multer";
import archiver from "archiver";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { DriveCloud } from "./drive-cloud.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const CEREBRO_VERSION = "5.0.0";
const PROD = process.env.NODE_ENV === "production";

const PUBLIC = path.join(__dirname, "public");
const STORAGE = path.join(__dirname, "storage");
const TRASH = path.join(__dirname, "trash");
const DATA = path.join(__dirname, "data");
const UPLOAD_TMP = path.join(DATA, "_uploads");
const PROFILE_FILE = path.join(DATA, "profile.json");
const MEMORY_FILE = path.join(DATA, "memory.json");
const SETTINGS_FILE = path.join(DATA, "settings.json");
const TRASH_FILE = path.join(DATA, "trash.json");
const JOURNAL_FILE = path.join(DATA, "journal.json");

const DRIVE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "";
const driveCloud = new DriveCloud({
  dataDir: DATA,
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: DRIVE_REDIRECT_URI,
  encryptionKey: process.env.CEREBRO_TOKENS_KEY
});

for (const p of [STORAGE, TRASH, DATA, UPLOAD_TMP]) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

if (PROD && !process.env.CEREBRO_SESSION_SECRET) {
  console.error("FATAL: define CEREBRO_SESSION_SECRET en producción.");
  process.exit(1);
}

app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "blob:", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"]
    }
  },
  crossOriginResourcePolicy: { policy: "same-origin" }
}));
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  secret: process.env.CEREBRO_SESSION_SECRET || crypto.createHash("sha256").update("CEREBRO-DEV-ONLY").digest("hex"),
  name: "cerebro.sid",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: PROD,
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

app.use(express.static(PUBLIC, {
  etag: true,
  maxAge: PROD ? "1h" : 0
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Prueba de nuevo más tarde." }
});

const upload = multer({
  dest: UPLOAD_TMP,
  limits: { fileSize: 1024 * 1024 * 1024, files: 100 }
});

const readJson = async (file, fallback) => {
  try { return JSON.parse(await fsp.readFile(file, "utf8")); }
  catch { return fallback; }
};
const writeJson = async (file, value) => {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fsp.rename(tmp, file);
};
const uid = () => crypto.randomUUID();

const INITIAL_PASSWORD_SALT = "38934defca6ba93ec46276fcfcd472d7";
const INITIAL_PASSWORD_HASH = "1bfe202a11c40781966cc0cb7e8371aa1c3d43386fb951c02e4ef69d059645c259d7c53c1f9128e7c767e8d46f75d111a5bfcae2a792ab22c43801141852f99c";

function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, "hex");
  return crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
}
function verifyPassword(password, saltHex, expectedHex) {
  const actual = Buffer.from(hashPassword(password, saltHex), "hex");
  const expected = Buffer.from(String(expectedHex || ""), "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

const normalizeRel = (input = "") => {
  const cleaned = String(input).replaceAll("\\", "/").replace(/^\/+/, "");
  const norm = path.posix.normalize(cleaned);
  if (norm === "." || norm === "") return "";
  if (norm.startsWith("../") || norm === ".." || path.posix.isAbsolute(norm)) throw new Error("Ruta no permitida");
  return norm;
};
const within = (base, rel) => {
  const n = normalizeRel(rel);
  const target = path.resolve(base, ...n.split("/").filter(Boolean));
  const root = path.resolve(base);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error("Ruta fuera del almacén");
  return target;
};
const absStorage = rel => within(STORAGE, rel);
const absTrash = rel => within(TRASH, rel);
const safeName = (name) => String(name || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/ñ/gi, "n")
  .replace(/[\/\\:*?"<>|\u0000-\u001F]/g, "-")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 180);
const exists = async p => !!(await fsp.lstat(p).catch(() => null));
const statSafe = p => fsp.lstat(p).catch(() => null);
const ensureParent = p => fsp.mkdir(path.dirname(p), { recursive: true });

async function journal(action, detail = {}) {
  const arr = await readJson(JOURNAL_FILE, []);
  arr.unshift({ id: uid(), action, detail, at: new Date().toISOString() });
  if (arr.length > 500) arr.length = 500;
  await writeJson(JOURNAL_FILE, arr);
}
async function ensureDefaults() {
  let settings = await readJson(SETTINGS_FILE, null);
  if (!settings) {
    settings = { passwordSalt: INITIAL_PASSWORD_SALT, passwordHash: INITIAL_PASSWORD_HASH, passwordNeedsReview: true, createdAt: new Date().toISOString() };
    await writeJson(SETTINGS_FILE, settings);
  }
  for (const [file, fallback] of [[MEMORY_FILE, []], [TRASH_FILE, []], [JOURNAL_FILE, []]]) {
    if (!(await exists(file))) await writeJson(file, fallback);
  }
}
await ensureDefaults();

function requireAuth(req, res, next) {
  if (req.session?.auth) return next();
  res.status(401).json({ error: "No autorizado" });
}
function ensureCsrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString("hex");
  next();
}
function checkCsrf(req, res, next) {
  const token = req.get("X-CSRF-Token");
  if (!token || token !== req.session.csrf) return res.status(403).json({ error: "Sesión de seguridad no válida. Recarga la app." });
  next();
}
app.use("/api", ensureCsrf);

app.post("/api/login", loginLimiter, async (req, res) => {
  const settings = await readJson(SETTINGS_FILE, {});
  const ok = verifyPassword(String(req.body.password || ""), settings.passwordSalt || "", settings.passwordHash || "");
  if (!ok) {
    await journal("login_failed", { ip: req.ip });
    return res.status(401).json({ ok: false, error: "Contraseña incorrecta" });
  }
  req.session.auth = true;
  req.session.csrf = crypto.randomBytes(24).toString("hex");
  await journal("login_ok");
  res.json({ ok: true, csrf: req.session.csrf });
});
app.post("/api/logout", requireAuth, checkCsrf, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/session", async (req, res) => {
  const profile = await readJson(PROFILE_FILE, null);
  const settings = await readJson(SETTINGS_FILE, {});
  res.json({ authenticated: !!req.session?.auth, onboarding: !profile, profile, passwordNeedsReview: !!settings.passwordNeedsReview, csrf: req.session?.auth ? req.session.csrf : null });
});

app.get("/api/profile", requireAuth, async (req, res) => res.json(await readJson(PROFILE_FILE, null)));
app.post("/api/profile", requireAuth, checkCsrf, async (req, res) => {
  const current = await readJson(PROFILE_FILE, {});
  const next = {
    ...current,
    name: String(req.body.name || current.name || "").slice(0, 80),
    callName: String(req.body.callName || current.callName || "").slice(0, 80),
    brainName: String(req.body.brainName || current.brainName || "Cerebro").slice(0, 80),
    personality: String(req.body.personality || current.personality || "creativo").slice(0, 40),
    style: String(req.body.style || current.style || "").slice(0, 1200),
    voiceEnabled: req.body.voiceEnabled !== undefined ? !!req.body.voiceEnabled : (current.voiceEnabled ?? true),
    reduceMotion: req.body.reduceMotion !== undefined ? !!req.body.reduceMotion : (current.reduceMotion ?? false),
    updatedAt: new Date().toISOString()
  };
  if (!next.createdAt) next.createdAt = next.updatedAt;
  await writeJson(PROFILE_FILE, next);
  await journal("profile_updated");
  res.json(next);
});
app.post("/api/password", requireAuth, checkCsrf, async (req, res) => {
  const next = String(req.body.password || "");
  if (next.length < 10) return res.status(400).json({ error: "Usa al menos 10 caracteres" });
  const settings = await readJson(SETTINGS_FILE, {});
  settings.passwordSalt = crypto.randomBytes(16).toString("hex");
  settings.passwordHash = hashPassword(next, settings.passwordSalt);
  settings.updatedAt = new Date().toISOString();
  settings.passwordNeedsReview = false;
  await writeJson(SETTINGS_FILE, settings);
  await journal("password_changed");
  res.json({ ok: true });
});

async function listFolder(rel = "") {
  const abs = absStorage(rel);
  const entries = await fsp.readdir(abs, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const e of entries) {
    const p = path.join(abs, e.name);
    const s = await statSafe(p);
    if (!s || s.isSymbolicLink()) continue;
    out.push({
      name: e.name,
      path: path.posix.join(rel, e.name),
      kind: s.isDirectory() ? "folder" : "file",
      size: s.isDirectory() ? 0 : s.size,
      modifiedAt: s.mtime.toISOString(),
      ext: s.isDirectory() ? "" : path.extname(e.name).slice(1).toLowerCase()
    });
  }
  return out.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name, "es", { numeric: true }) : (a.kind === "folder" ? -1 : 1));
}
async function listRecursive(base, rel = "", acc = []) {
  const abs = within(base, rel);
  const entries = await fsp.readdir(abs, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const r = path.posix.join(rel, e.name);
    const a = within(base, r);
    const s = await statSafe(a);
    if (!s || s.isSymbolicLink()) continue;
    acc.push({ name: e.name, path: r, kind: s.isDirectory() ? "folder" : "file", size: s.isDirectory() ? 0 : s.size, modifiedAt: s.mtime.toISOString() });
    if (s.isDirectory()) await listRecursive(base, r, acc);
  }
  return acc;
}

app.get("/api/files", requireAuth, async (req, res) => {
  const rel = normalizeRel(req.query.path || "");
  res.json({ path: rel, items: await listFolder(rel) });
});

app.post("/api/folders", requireAuth, checkCsrf, async (req, res) => {
  const parent = normalizeRel(req.body.path || "");
  const name = safeName(req.body.name || "");
  if (!name) return res.status(400).json({ error: "Nombre inválido" });
  const targetRel = path.posix.join(parent, name);
  const target = absStorage(targetRel);
  if (await exists(target)) return res.status(409).json({ error: "Ya existe una carpeta con ese nombre" });
  await fsp.mkdir(target);
  await journal("folder_created", { path: targetRel });
  res.json({ ok: true, path: targetRel });
});

app.post("/api/projects", requireAuth, checkCsrf, async (req, res) => {
  const name = safeName(req.body.name || "");
  if (!name) return res.status(400).json({ error: "Escribe un nombre para el proyecto" });
  const parent = normalizeRel(req.body.path || "");
  const code = safeName(req.body.code || "PRJ").replace(/\s+/g, "-").toUpperCase().slice(0, 20);
  const rootName = `${code}-${name}`;
  const rootRel = path.posix.join(parent, rootName);
  const rootAbs = absStorage(rootRel);
  if (await exists(rootAbs)) return res.status(409).json({ error: "Ese proyecto ya existe" });
  const folders = ["00_ADMIN", "01_REFERENCIAS", "02_BOCETOS", "03_ORIGINALES", "04_RECURSOS", "05_VERSIONES", "06_EXPORTACIONES", "07_ENTREGA", "08_ARCHIVO"];
  await fsp.mkdir(rootAbs, { recursive: true });
  for (const f of folders) await fsp.mkdir(path.join(rootAbs, f));
  const manifest = {
    schema: "cerebro.project.v1",
    name, code,
    type: String(req.body.type || "Ilustracion"),
    client: String(req.body.client || "Personal"),
    createdAt: new Date().toISOString(),
    status: "ACTIVO",
    naming: "CODIGO-TIPO-DESCRIPCION-v###-AAAAMMDD.ext"
  };
  await writeJson(path.join(rootAbs, "PROJECT_MANIFEST.json"), manifest);
  await journal("project_created", { path: rootRel, code, type: manifest.type });
  res.json({ ok: true, path: rootRel, folders, manifest });
});

app.post("/api/upload", requireAuth, checkCsrf, upload.array("files", 100), async (req, res) => {
  const destRel = normalizeRel(req.body.path || "");
  const dest = absStorage(destRel);
  await fsp.mkdir(dest, { recursive: true });
  const saved = [];
  try {
    for (const f of req.files || []) {
      let name = safeName(f.originalname) || `archivo-${Date.now()}`;
      let target = path.join(dest, name);
      if (await exists(target)) {
        const ext = path.extname(name), base = path.basename(name, ext);
        let i = 2;
        while (await exists(target)) {
          name = `${base} ${i}${ext}`;
          target = path.join(dest, name);
          i++;
        }
      }
      await fsp.rename(f.path, target);
      saved.push(path.posix.join(destRel, name));
    }
  } finally {
    for (const f of req.files || []) {
      if (await exists(f.path)) await fsp.rm(f.path, { force: true });
    }
  }
  await journal("files_uploaded", { destination: destRel, count: saved.length });
  res.json({ ok: true, saved });
});

app.post("/api/rename", requireAuth, checkCsrf, async (req, res) => {
  const rel = normalizeRel(req.body.path || "");
  const newName = safeName(req.body.newName || "");
  if (!newName) return res.status(400).json({ error: "Nombre inválido" });
  const src = absStorage(rel);
  const srcStat = await statSafe(src);
  if (!srcStat || srcStat.isSymbolicLink()) return res.status(404).json({ error: "No encontrado" });
  const dst = path.join(path.dirname(src), newName);
  if (await exists(dst)) return res.status(409).json({ error: "Ya existe un elemento con ese nombre" });
  await fsp.rename(src, dst);
  const parent = path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel);
  const newRel = path.posix.join(parent, newName);
  await journal("renamed", { from: rel, to: newRel });
  res.json({ ok: true, path: newRel });
});

app.post("/api/move", requireAuth, checkCsrf, async (req, res) => {
  const srcRel = normalizeRel(req.body.path || "");
  const destRel = normalizeRel(req.body.destination || "");
  const src = absStorage(srcRel), destDir = absStorage(destRel);
  const srcStat = await statSafe(src);
  if (!srcStat || srcStat.isSymbolicLink()) return res.status(404).json({ error: "No encontrado" });
  if (srcStat.isDirectory() && (destRel === srcRel || destRel.startsWith(srcRel + "/"))) {
    return res.status(400).json({ error: "No puedes mover una carpeta dentro de sí misma" });
  }
  await fsp.mkdir(destDir, { recursive: true });
  const dst = path.join(destDir, path.basename(src));
  if (await exists(dst)) return res.status(409).json({ error: "Ya existe un elemento con ese nombre en destino" });
  await fsp.rename(src, dst);
  const newRel = path.posix.join(destRel, path.basename(src));
  await journal("moved", { from: srcRel, to: newRel });
  res.json({ ok: true, path: newRel });
});

app.post("/api/trash", requireAuth, checkCsrf, async (req, res) => {
  const rel = normalizeRel(req.body.path || "");
  const src = absStorage(rel);
  const srcStat = await statSafe(src);
  if (!srcStat || srcStat.isSymbolicLink()) return res.status(404).json({ error: "No existe" });
  const token = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const trashName = `${token}-${path.basename(src)}`;
  const dest = absTrash(trashName);
  await fsp.rename(src, dest);
  const meta = await readJson(TRASH_FILE, []);
  meta.unshift({ id: token, originalPath: rel, trashName, kind: srcStat.isDirectory() ? "folder" : "file", trashedAt: new Date().toISOString() });
  await writeJson(TRASH_FILE, meta);
  await journal("trashed", { path: rel });
  res.json({ ok: true });
});
app.get("/api/trash", requireAuth, async (req, res) => res.json(await readJson(TRASH_FILE, [])));
app.post("/api/trash/restore", requireAuth, checkCsrf, async (req, res) => {
  const meta = await readJson(TRASH_FILE, []);
  const i = meta.findIndex(x => x.id === req.body.id);
  if (i < 0) return res.status(404).json({ error: "No encontrado" });
  const item = meta[i], src = absTrash(item.trashName), dst = absStorage(item.originalPath);
  await ensureParent(dst);
  if (await exists(dst)) return res.status(409).json({ error: "La ruta original ya está ocupada" });
  await fsp.rename(src, dst);
  meta.splice(i, 1); await writeJson(TRASH_FILE, meta);
  await journal("restored", { path: item.originalPath });
  res.json({ ok: true });
});
app.post("/api/trash/delete", requireAuth, checkCsrf, async (req, res) => {
  const meta = await readJson(TRASH_FILE, []);
  const i = meta.findIndex(x => x.id === req.body.id);
  if (i < 0) return res.status(404).json({ error: "No encontrado" });
  const item = meta[i], p = absTrash(item.trashName), s = await statSafe(p);
  if (s?.isDirectory()) await fsp.rm(p, { recursive: true, force: true });
  else await fsp.rm(p, { force: true });
  meta.splice(i, 1); await writeJson(TRASH_FILE, meta);
  await journal("deleted_forever", { originalPath: item.originalPath });
  res.json({ ok: true });
});

app.get("/api/search", requireAuth, async (req, res) => {
  const q = String(req.query.q || "").trim().toLocaleLowerCase("es");
  if (!q) return res.json({ files: [], memory: [] });
  const terms = q.split(/\s+/).filter(Boolean);
  const all = await listRecursive(STORAGE);
  const memory = await readJson(MEMORY_FILE, []);
  const score = (text) => terms.reduce((n, t) => n + (text.includes(t) ? 1 : 0), 0);
  const fileHits = all.map(x => ({ ...x, _s: score((x.name + " " + x.path).toLocaleLowerCase("es")) })).filter(x => x._s > 0).sort((a, b) => b._s - a._s).slice(0, 100);
  const memHits = memory.map(x => ({ ...x, _s: score(JSON.stringify(x).toLocaleLowerCase("es")) })).filter(x => x._s > 0).sort((a, b) => b._s - a._s).slice(0, 50);
  res.json({ files: fileHits, memory: memHits });
});

app.get("/api/memory", requireAuth, async (req, res) => res.json(await readJson(MEMORY_FILE, [])));
app.post("/api/memory", requireAuth, checkCsrf, async (req, res) => {
  const arr = await readJson(MEMORY_FILE, []);
  const item = {
    id: uid(),
    type: String(req.body.type || "nota").slice(0, 30),
    text: String(req.body.text || "").trim().slice(0, 10000),
    tags: Array.isArray(req.body.tags) ? req.body.tags.map(x => String(x).slice(0, 60)).slice(0, 20) : [],
    createdAt: new Date().toISOString()
  };
  if (!item.text) return res.status(400).json({ error: "Texto vacío" });
  arr.unshift(item); await writeJson(MEMORY_FILE, arr);
  await journal("memory_added", { id: item.id, type: item.type });
  res.json(item);
});
app.delete("/api/memory/:id", requireAuth, checkCsrf, async (req, res) => {
  const arr = await readJson(MEMORY_FILE, []);
  const next = arr.filter(x => x.id !== req.params.id);
  if (next.length === arr.length) return res.status(404).json({ error: "No encontrado" });
  await writeJson(MEMORY_FILE, next);
  await journal("memory_deleted", { id: req.params.id });
  res.json({ ok: true });
});

function descriptorFrom(name) {
  const ext = path.extname(name);
  let base = path.basename(name, ext)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(final|finalisimo|bueno|nuevo|copia|copy|ultima|ultimo)\b/gi, "")
    .replace(/(?:^|[_\-\s])v\d{1,4}(?:$|[_\-\s])/gi, " ")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 42);
  return base || "archivo";
}
async function renamePlan(rel, code, kind) {
  const dir = absStorage(rel);
  const st = await statSafe(dir);
  if (!st?.isDirectory()) throw new Error("Selecciona una carpeta");
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const plan = [];
  const used = new Set(entries.map(e => e.name.toLowerCase()));
  for (const e of entries) {
    if (!e.isFile() || e.name === "PROJECT_MANIFEST.json" || e.name === "RENAME_MANIFEST.json") continue;
    const ext = path.extname(e.name).toLowerCase();
    const desc = descriptorFrom(e.name);
    let version = 1, candidate;
    do {
      candidate = `${code}-${kind}-${desc}-v${String(version).padStart(3, "0")}-${date}${ext}`;
      version++;
    } while (used.has(candidate.toLowerCase()) && candidate.toLowerCase() !== e.name.toLowerCase());
    if (candidate !== e.name) {
      plan.push({ from: e.name, to: candidate });
      used.add(candidate.toLowerCase());
    }
  }
  return plan;
}
app.post("/api/rename-project/preview", requireAuth, checkCsrf, async (req, res) => {
  const rel = normalizeRel(req.body.path || "");
  const code = safeName(req.body.code || "PRJ").replace(/\s+/g, "").toUpperCase().slice(0, 20);
  const kind = safeName(req.body.type || "ARTE").replace(/\s+/g, "").toUpperCase().slice(0, 20);
  res.json({ path: rel, code, type: kind, plan: await renamePlan(rel, code, kind) });
});
app.post("/api/rename-project/apply", requireAuth, checkCsrf, async (req, res) => {
  const rel = normalizeRel(req.body.path || "");
  const code = safeName(req.body.code || "PRJ").replace(/\s+/g, "").toUpperCase().slice(0, 20);
  const kind = safeName(req.body.type || "ARTE").replace(/\s+/g, "").toUpperCase().slice(0, 20);
  const dir = absStorage(rel);
  const plan = await renamePlan(rel, code, kind);
  const token = uid();
  const stage = [];
  try {
    for (const item of plan) {
      const src = path.join(dir, item.from);
      const temp = path.join(dir, `.__cerebro_${token}_${stage.length}`);
      await fsp.rename(src, temp);
      stage.push({ ...item, temp });
    }
    for (const item of stage) await fsp.rename(item.temp, path.join(dir, item.to));
  } catch (e) {
    for (const item of stage.reverse()) {
      if (await exists(item.temp)) await fsp.rename(item.temp, path.join(dir, item.from)).catch(() => {});
      else if (await exists(path.join(dir, item.to))) await fsp.rename(path.join(dir, item.to), path.join(dir, item.from)).catch(() => {});
    }
    throw e;
  }
  const manifest = { schema: "cerebro.rename.v1", at: new Date().toISOString(), path: rel, code, type: kind, changes: plan };
  await writeJson(path.join(dir, "RENAME_MANIFEST.json"), manifest);
  await journal("batch_renamed", { path: rel, count: plan.length });
  res.json({ ok: true, changed: plan, manifest: "RENAME_MANIFEST.json" });
});

app.get("/api/download", requireAuth, async (req, res) => {
  const rel = normalizeRel(req.query.path || "");
  const abs = absStorage(rel), stat = await statSafe(abs);
  if (!stat || stat.isSymbolicLink()) return res.status(404).end();
  if (stat.isDirectory()) return res.status(400).json({ error: "Usa archivar para carpetas" });
  res.download(abs, path.basename(abs));
});

app.post("/api/archive", requireAuth, checkCsrf, async (req, res) => {
  const rel = normalizeRel(req.body.path || "");
  const abs = absStorage(rel), stat = await statSafe(abs);
  if (!stat?.isDirectory()) return res.status(400).json({ error: "Selecciona una carpeta" });
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const archiveName = `${path.basename(abs)}_ARCHIVE_${date}.zip`;
  const archivePath = path.join(DATA, `${uid()}-${archiveName}`);

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(archivePath);
    const ar = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve); output.on("error", reject); ar.on("error", reject);
    ar.pipe(output); ar.directory(abs, false); ar.finalize();
  });
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(archivePath);
    stream.on("data", d => hash.update(d)); stream.on("end", resolve); stream.on("error", reject);
  });
  const sha256 = hash.digest("hex");
  await journal("archived", { path: rel, archiveName, sha256 });
  res.setHeader("X-Cerebro-SHA256", sha256);
  res.setHeader("X-Cerebro-Archive-Name", encodeURIComponent(archiveName));
  res.download(archivePath, archiveName, async () => { await fsp.rm(archivePath, { force: true }).catch(() => {}); });
});


app.get("/api/diagnostics", requireAuth, async (req, res) => {
  const profile = await readJson(PROFILE_FILE, null);
  const journal = await readJson(JOURNAL_FILE, []);
  const memory = await readJson(MEMORY_FILE, []);
  const trashMeta = await readJson(TRASH_FILE, []);
  const allFiles = await listRecursive(STORAGE);
  res.json({
    product: "CEREBRO",
    version: CEREBRO_VERSION,
    node: process.version,
    platform: process.platform,
    uptimeSeconds: Math.round(process.uptime()),
    profileConfigured: !!profile,
    counts: {
      filesAndFolders: allFiles.length,
      memoryItems: memory.length,
      trashItems: trashMeta.length,
      journalEntries: journal.length
    },
    paths: {
      public: "public/",
      storage: "storage/",
      trash: "trash/",
      data: "data/",
      docs: "docs/"
    },
    modules: [
      "auth","onboarding","face","speech","files","folders","projects","upload",
      "download","rename","move","trash","search","memory","batch-rename","archive","journal","commands"
    ],
    timestamp: new Date().toISOString()
  });
});

app.get("/api/diagnostics/export", requireAuth, async (req, res) => {
  const profile = await readJson(PROFILE_FILE, null);
  const journal = (await readJson(JOURNAL_FILE, [])).slice(0, 100);
  const memory = await readJson(MEMORY_FILE, []);
  const trashMeta = await readJson(TRASH_FILE, []);
  const allFiles = await listRecursive(STORAGE);
  const report = {
    product: "CEREBRO",
    version: CEREBRO_VERSION,
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      uptimeSeconds: Math.round(process.uptime())
    },
    profile: profile ? {
      name: profile.name,
      callName: profile.callName,
      brainName: profile.brainName,
      personality: profile.personality
    } : null,
    counts: {
      filesAndFolders: allFiles.length,
      memoryItems: memory.length,
      trashItems: trashMeta.length,
      journalEntries: journal.length
    },
    recentActivity: journal,
    fileIndex: allFiles.map(x => ({ path: x.path, kind: x.kind, size: x.size, modifiedAt: x.modifiedAt })),
    architectureFile: "docs/ARCHITECTURE.json",
    contextFile: "docs/CONTEXTO_MAESTRO.md",
    changelogFile: "docs/CHANGELOG.md"
  };
  const body = JSON.stringify(report, null, 2);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="CEREBRO-DIAGNOSTICO-${CEREBRO_VERSION}.json"`);
  res.send(body);
});


app.get("/api/cloud/drive/setup", requireAuth, async (req,res)=>{
  res.json({
    configured: driveCloud.configured(),
    redirectUri: DRIVE_REDIRECT_URI || `${req.protocol}://${req.get("host")}/api/cloud/drive/callback`,
    requiredEnv:["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_REDIRECT_URI","CEREBRO_TOKENS_KEY"],
    scope:"https://www.googleapis.com/auth/drive.file",
    note:"Una vez configurado por el propietario de CEREBRO, cada usuario solo pulsa Conectar Drive."
  });
});

app.get("/api/cloud/drive/status", requireAuth, async (req,res)=>{
  res.json(await driveCloud.status());
});

app.post("/api/cloud/drive/connect", requireAuth, checkCsrf, async (req,res)=>{
  if (!driveCloud.configured()) return res.status(503).json({error:"Drive aún no está configurado por el propietario de CEREBRO."});
  const state=crypto.randomBytes(24).toString("hex");
  req.session.driveOAuthState=state;
  res.json({url:driveCloud.authUrl(state)});
});

app.get("/api/cloud/drive/callback", requireAuth, async (req,res)=>{
  try{
    if (!req.query.state || req.query.state!==req.session.driveOAuthState) return res.status(400).send("Estado OAuth no válido.");
    if (!req.query.code) return res.status(400).send("Google no devolvió autorización.");
    await driveCloud.exchange(String(req.query.code));
    delete req.session.driveOAuthState;
    await driveCloud.ensureRoot();
    await journal("drive_connected");
    res.redirect("/?drive=connected");
  }catch(e){
    console.error(e);res.status(500).send("No se pudo conectar Google Drive: "+e.message);
  }
});

app.post("/api/cloud/drive/disconnect", requireAuth, checkCsrf, async (req,res)=>{
  await driveCloud.disconnect();await journal("drive_disconnected");res.json({ok:true});
});

app.get("/api/cloud/drive/list", requireAuth, async (req,res)=>{
  res.json(await driveCloud.list(String(req.query.parentId||"")||null));
});

app.post("/api/cloud/drive/folder", requireAuth, checkCsrf, async (req,res)=>{
  const name=safeName(req.body.name||"");
  if(!name) return res.status(400).json({error:"Nombre inválido"});
  const item=await driveCloud.createFolder(name,req.body.parentId||null);
  await journal("drive_folder_created",{id:item.id,name:item.name});res.json(item);
});

app.post("/api/cloud/drive/upload", requireAuth, checkCsrf, upload.array("files",50), async (req,res)=>{
  const saved=[];
  try{
    for(const f of req.files||[]){
      const item=await driveCloud.upload(f.path,safeName(f.originalname)||f.originalname,req.body.parentId||null,f.mimetype);
      saved.push(item);
    }
  } finally {
    for(const f of req.files||[]) await fsp.rm(f.path,{force:true}).catch(()=>{});
  }
  await journal("drive_uploaded",{count:saved.length});res.json({ok:true,saved});
});

app.post("/api/cloud/drive/rename", requireAuth, checkCsrf, async (req,res)=>{
  const name=safeName(req.body.name||"");if(!name)return res.status(400).json({error:"Nombre inválido"});
  const item=await driveCloud.rename(String(req.body.fileId||""),name);await journal("drive_renamed",{id:item.id,name});res.json(item);
});

app.post("/api/cloud/drive/move", requireAuth, checkCsrf, async (req,res)=>{
  const item=await driveCloud.move(String(req.body.fileId||""),String(req.body.parentId||""));await journal("drive_moved",{id:item.id});res.json(item);
});

app.post("/api/cloud/drive/trash", requireAuth, checkCsrf, async (req,res)=>{
  const item=await driveCloud.trash(String(req.body.fileId||""));await journal("drive_trashed",{id:item.id});res.json(item);
});

app.get("/api/cloud/drive/search", requireAuth, async (req,res)=>{
  res.json({items:await driveCloud.search(String(req.query.q||""))});
});

app.get("/api/cloud/drive/download", requireAuth, async (req,res)=>{
  const {meta,stream}=await driveCloud.download(String(req.query.fileId||""));
  res.setHeader("Content-Type",meta.mimeType||"application/octet-stream");
  res.setHeader("Content-Disposition",`attachment; filename*=UTF-8''${encodeURIComponent(meta.name||"archivo")}`);
  stream.on("error",()=>res.destroy());stream.pipe(res);
});

app.get("/api/journal", requireAuth, async (req, res) => {
  res.json((await readJson(JOURNAL_FILE, [])).slice(0, 100));
});

app.get("*", (req, res) => res.sendFile(path.join(PUBLIC, "index.html")));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 500).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Archivo demasiado grande" : (err.message || "Error interno") });
});
app.listen(PORT, () => console.log(`CEREBRO v2 activo en puerto ${PORT}`));
