import { deleteRoute, getRoute } from "@/lib/routes-server";

export async function GET(_request, { params }) {
  const { id } = await params;
  const route = await getRoute(id);
  if (!route) return Response.json({ error: "未找到该路线" }, { status: 404 });
  return Response.json({ route });
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
  const ok = await deleteRoute(id);
  if (!ok) return Response.json({ error: "未找到该路线" }, { status: 404 });
  return Response.json({ ok: true });
}
