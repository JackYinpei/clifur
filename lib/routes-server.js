// Server-only helpers. Reads/writes route JSON in /public/routes.
import { promises as fs } from "node:fs";
import path from "node:path";
import { migrateRoute, validateRoute } from "./route-defs.js";

const ROUTES_DIR = process.env.ROUTES_DIR || path.join(process.cwd(), "public", "routes");
const INDEX_FILE = path.join(ROUTES_DIR, "index.json");

async function ensureDir() {
  await fs.mkdir(ROUTES_DIR, { recursive: true });
}

async function readJsonSafe(file) {
  try {
    const buf = await fs.readFile(file, "utf8");
    return JSON.parse(buf);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export async function listRoutes() {
  await ensureDir();
  const idx = await readJsonSafe(INDEX_FILE);
  if (idx && Array.isArray(idx.routes)) return idx.routes;

  // No index — derive from directory contents
  const entries = await fs.readdir(ROUTES_DIR);
  const out = [];
  for (const f of entries) {
    if (!f.endsWith(".json") || f === "index.json") continue;
    const r = await readJsonSafe(path.join(ROUTES_DIR, f));
    if (!r) continue;
    out.push(summarize(r));
  }
  await writeIndex(out);
  return out;
}

export async function getRoute(id) {
  await ensureDir();
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  const r = await readJsonSafe(path.join(ROUTES_DIR, `${id}.json`));
  return migrateRoute(r);
}

export async function saveRoute(route) {
  await ensureDir();
  const err = validateRoute(route);
  if (err) throw new Error(err);

  if (!route.id || !/^[a-zA-Z0-9_-]+$/.test(route.id)) {
    throw new Error("非法路线 ID");
  }
  if (!route.createdAt) route.createdAt = new Date().toISOString();
  route.updatedAt = new Date().toISOString();

  const file = path.join(ROUTES_DIR, `${route.id}.json`);
  await fs.writeFile(file, JSON.stringify(route, null, 2), "utf8");

  // Update index
  const list = await listRoutes();
  const filtered = list.filter((r) => r.id !== route.id);
  filtered.unshift(summarize(route));
  await writeIndex(filtered);
  return route;
}

export async function deleteRoute(id) {
  await ensureDir();
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return false;
  const file = path.join(ROUTES_DIR, `${id}.json`);
  try {
    await fs.unlink(file);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    return false;
  }
  const list = await listRoutes();
  await writeIndex(list.filter((r) => r.id !== id));
  return true;
}

function summarize(r) {
  return {
    id: r.id,
    name: r.name,
    author: r.author,
    difficulty: r.difficulty,
    description: r.description ?? "",
    holdCount: Array.isArray(r.holds) ? r.holds.length : 0,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

async function writeIndex(list) {
  const sorted = [...list].sort(
    (a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""),
  );
  await fs.writeFile(INDEX_FILE, JSON.stringify({ routes: sorted }, null, 2), "utf8");
}
