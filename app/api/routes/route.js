import { listRoutes, saveRoute } from "@/lib/routes-server";
import { makeId, slugify, validateRoute } from "@/lib/route-defs";

export async function GET() {
  const routes = await listRoutes();
  return Response.json({ routes });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体必须是合法 JSON" }, { status: 400 });
  }

  const draft = { ...body };

  // Always assign a fresh id derived from name + random suffix to avoid collisions / overwrites.
  if (!draft.id || typeof draft.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(draft.id)) {
    draft.id = `${slugify(draft.name)}-${makeId().slice(0, 6)}`;
  }
  if (!draft.createdAt) draft.createdAt = new Date().toISOString();

  const err = validateRoute(draft);
  if (err) return Response.json({ error: err }, { status: 400 });

  try {
    const saved = await saveRoute(draft);
    return Response.json({ route: saved }, { status: 201 });
  } catch (e) {
    return Response.json({ error: e.message || "保存失败" }, { status: 500 });
  }
}
