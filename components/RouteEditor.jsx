"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  HOLD_KINDS,
  HOLD_KIND_DESC,
  HOLD_KIND_FILL,
  HOLD_KIND_LABEL,
  emptyRoute,
  makeId,
  validateRoute,
} from "@/lib/route-defs";
import ClimberGame from "./ClimberGame";

// Editor for designing a climbing route. Place holds, edit metadata, then publish.

export default function RouteEditor({ initial }) {
  const router = useRouter();
  const [route, setRoute] = useState(() => initial || emptyRoute());
  const [tool, setTool] = useState("jug"); // jug | crimp | sloper | start | finish | move | erase
  const [selectedId, setSelectedId] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(null);
  const [savedRoute, setSavedRoute] = useState(null);

  const canvasRef = useRef(null);
  const dragStateRef = useRef(null);
  const viewRef = useRef({ scale: 1, w: 0, h: 0 });

  const wallW = route.wall?.width ?? 800;
  const wallH = route.wall?.height ?? 1200;

  // Render whenever route/tool/selectedId changes
  useEffect(() => {
    if (previewing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const scale = cw / wallW;
      viewRef.current = { scale, w: cw, h: ch };
      draw();
    }

    function draw() {
      const ctx = canvas.getContext("2d");
      const { scale, w, h } = viewRef.current;
      ctx.fillStyle = route.wall?.color || "#cdbb9d";
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.scale(scale, scale);

      // grid
      ctx.strokeStyle = "rgba(0,0,0,0.05)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gy = 0; gy <= wallH; gy += 100) { ctx.moveTo(0, gy); ctx.lineTo(wallW, gy); }
      for (let gx = 0; gx <= wallW; gx += 100) { ctx.moveTo(gx, 0); ctx.lineTo(wallW, 0); ctx.lineTo(gx, 0); ctx.lineTo(gx, wallH); }
      ctx.stroke();

      // wall border
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, wallW, wallH);

      // holds — simplified per-kind silhouette with the same color as in-game
      for (const hold of route.holds) {
        const sel = hold.id === selectedId;
        const kind = hold.kind === "hold" ? "jug" : hold.kind;
        const [base, dark] = HOLD_KIND_FILL[kind] || HOLD_KIND_FILL.jug;
        ctx.save();
        // shadow
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.beginPath();
        if (kind === "crimp") {
          ctx.fillRect(hold.x - hold.size * 0.85 + 2, hold.y - hold.size * 0.27 + 3, hold.size * 1.7, hold.size * 0.55);
        } else {
          ctx.ellipse(hold.x + 2, hold.y + 3, hold.size, hold.size * 0.85, 0, 0, Math.PI * 2);
        }
        ctx.fill();
        // body
        ctx.fillStyle = base;
        ctx.beginPath();
        if (kind === "crimp") {
          ctx.fillRect(hold.x - hold.size * 0.85, hold.y - hold.size * 0.27, hold.size * 1.7, hold.size * 0.55);
        } else {
          ctx.ellipse(hold.x, hold.y, hold.size, hold.size * 0.85, 0, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 2;
        ctx.stroke();
        if (kind === "crimp") {
          ctx.fillStyle = dark;
          ctx.fillRect(hold.x - hold.size * 0.85, hold.y - hold.size * 0.05, hold.size * 1.7, hold.size * 0.15);
        }
        if (sel) {
          ctx.strokeStyle = "rgba(245,158,11,1)";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(hold.x, hold.y, hold.size + 8, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText((HOLD_KIND_LABEL[kind] || "")[0] || "·", hold.x, hold.y - hold.size - 12);
        ctx.restore();
      }

      ctx.restore();
    }

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [route, selectedId, previewing, wallW, wallH]);

  function worldFromEvent(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const { scale } = viewRef.current;
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  }

  function findHoldAt(x, y) {
    for (let i = route.holds.length - 1; i >= 0; i--) {
      const h = route.holds[i];
      if (Math.hypot(h.x - x, h.y - y) <= h.size + 4) return h;
    }
    return null;
  }

  function handlePointerDown(e) {
    e.preventDefault();
    const w = worldFromEvent(e);
    const hit = findHoldAt(w.x, w.y);
    if (tool === "erase") {
      if (hit) deleteHold(hit.id);
      return;
    }
    if (tool === "move") {
      if (hit) {
        setSelectedId(hit.id);
        dragStateRef.current = { id: hit.id, dx: hit.x - w.x, dy: hit.y - w.y };
        canvasRef.current.setPointerCapture(e.pointerId);
      } else {
        setSelectedId(null);
      }
      return;
    }
    // place / start / finish — tool acts as kind
    if (hit) {
      setSelectedId(hit.id);
      dragStateRef.current = { id: hit.id, dx: hit.x - w.x, dy: hit.y - w.y };
      canvasRef.current.setPointerCapture(e.pointerId);
      return;
    }
    // tool name is also the kind: "jug" | "crimp" | "sloper" | "start" | "finish"
    const kind = HOLD_KINDS.includes(tool) ? tool : "jug";
    const defaultSize = (
      kind === "finish" ? 38 :
      kind === "start" ? 36 :
      kind === "crimp" ? 16 :
      kind === "sloper" ? 26 :
      28
    );
    const newHold = {
      id: makeId("h"),
      x: clamp(w.x, 8, wallW - 8),
      y: clamp(w.y, 8, wallH - 8),
      size: defaultSize,
      kind,
    };
    setRoute((r) => ({ ...r, holds: [...r.holds, newHold] }));
    setSelectedId(newHold.id);
  }

  function handlePointerMove(e) {
    if (!dragStateRef.current) return;
    const w = worldFromEvent(e);
    const id = dragStateRef.current.id;
    const dx = dragStateRef.current.dx;
    const dy = dragStateRef.current.dy;
    setRoute((r) => ({
      ...r,
      holds: r.holds.map((h) =>
        h.id === id ? { ...h, x: clamp(w.x + dx, 8, wallW - 8), y: clamp(w.y + dy, 8, wallH - 8) } : h,
      ),
    }));
  }

  function handlePointerUp() {
    dragStateRef.current = null;
  }

  function deleteHold(id) {
    setRoute((r) => ({ ...r, holds: r.holds.filter((h) => h.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  }

  function updateHold(id, patch) {
    setRoute((r) => ({
      ...r,
      holds: r.holds.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    }));
  }

  async function publish() {
    setError(null);
    const err = validateRoute(route);
    if (err) {
      setError(err);
      return;
    }
    setPublishing(true);
    try {
      const res = await fetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(route),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      setSavedRoute(data.route);
      setRoute(data.route);
      router.refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setPublishing(false);
    }
  }

  const selected = useMemo(
    () => route.holds.find((h) => h.id === selectedId) || null,
    [route.holds, selectedId],
  );

  const hasStart = route.holds.some((h) => h.kind === "start");
  const hasFinish = route.holds.some((h) => h.kind === "finish");

  // If the active tool just got disabled (e.g. user added the start hold,
  // so the start tool disappears), fall back to the move tool so a click
  // on empty space doesn't try to place another forbidden hold.
  useEffect(() => {
    if (tool === "start" && hasStart) setTool("move");
    if (tool === "finish" && hasFinish) setTool("move");
  }, [tool, hasStart, hasFinish]);

  if (previewing) {
    // Need a route id for ClimberGame's effect; provide a transient one
    const playable = { ...route, id: route.id || "preview" };
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-stone-300/60 bg-amber-50 px-4 py-2 text-sm">
          <span className="font-medium">预览模式 — 当前不会保存修改</span>
          <button
            onClick={() => setPreviewing(false)}
            className="rounded-full bg-stone-800 px-3 py-1 text-xs font-medium text-white hover:bg-stone-700"
          >
            返回编辑
          </button>
        </div>
        <ClimberGame route={playable} />
      </div>
    );
  }

  const TOOLS = [
    ["jug", "大凸点", "好抓的大点", true],
    ["crimp", "小棱点", "脚踩不上", true],
    ["sloper", "圆弧点", "4 秒滑落", true],
    ["start", "起点", "路线起点", !hasStart],
    ["finish", "终点", "双手抓到即胜", !hasFinish],
    ["move", "选择", "拖动 / 编辑", true],
    ["erase", "删除", "点击删除", true],
  ];

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-b border-stone-300/60 bg-stone-50 p-4 text-sm text-stone-800 lg:h-full lg:w-72 lg:border-b-0 lg:border-r">
        <section>
          <h2 className="text-sm font-semibold text-stone-800">路线信息</h2>
          <div className="mt-2 grid gap-2">
            <Field label="名称">
              <input
                value={route.name}
                onChange={(e) => setRoute({ ...route, name: e.target.value })}
                placeholder="未命名路线"
                className="w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none"
                maxLength={40}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="作者">
                <input
                  value={route.author}
                  onChange={(e) => setRoute({ ...route, author: e.target.value })}
                  placeholder="匿名"
                  className="w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none"
                  maxLength={32}
                />
              </Field>
              <Field label="难度">
                <select
                  value={route.difficulty}
                  onChange={(e) => setRoute({ ...route, difficulty: e.target.value })}
                  className="w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:border-amber-500 focus:outline-none"
                >
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="描述">
              <textarea
                value={route.description ?? ""}
                onChange={(e) => setRoute({ ...route, description: e.target.value })}
                rows={2}
                placeholder="一句话介绍这条路线…"
                className="w-full resize-none rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none"
                maxLength={160}
              />
            </Field>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-stone-800">工具</h2>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {TOOLS.filter(([, , , show]) => show).map(([k, label, desc]) => (
              <button
                key={k}
                onClick={() => setTool(k)}
                title={desc}
                className={`rounded-md border px-2 py-1.5 text-xs font-medium ${
                  tool === k
                    ? "border-amber-600 bg-amber-100 text-amber-900"
                    : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-stone-500">
            点击空白处放置手点 · 拖拽移动 · 点中已有手点编辑
          </p>
        </section>

        {selected ? (
          <section className="rounded-lg border border-stone-300 bg-white p-3">
            <div className="flex items-center justify-between text-sm font-semibold text-stone-800">
              <span>已选手点</span>
              <button
                onClick={() => deleteHold(selected.id)}
                className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700"
              >
                删除
              </button>
            </div>
            <div className="mt-2 grid gap-2">
              <Field label="类型">
                <select
                  value={selected.kind}
                  onChange={(e) => updateHold(selected.id, { kind: e.target.value })}
                  className="w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-stone-900"
                >
                  {HOLD_KINDS.map((k) => (
                    <option key={k} value={k}>{HOLD_KIND_LABEL[k]}</option>
                  ))}
                </select>
              </Field>
              <Field label={`大小 (${selected.size})`}>
                <input
                  type="range"
                  min={14}
                  max={56}
                  value={selected.size}
                  onChange={(e) => updateHold(selected.id, { size: Number(e.target.value) })}
                  className="w-full"
                />
              </Field>
              <div className="grid grid-cols-2 gap-2 text-xs text-stone-500">
                <div>x: {Math.round(selected.x)}</div>
                <div>y: {Math.round(selected.y)}</div>
              </div>
            </div>
          </section>
        ) : (
          <section className="rounded-md bg-stone-100 p-2 text-[11px] leading-snug text-stone-600">
            {Object.entries(HOLD_KIND_DESC).map(([k, d]) => (
              <p key={k} className="truncate">
                <span className="font-semibold text-stone-800">{HOLD_KIND_LABEL[k]}</span> · {d}
              </p>
            ))}
          </section>
        )}

        <section className="mt-auto flex flex-col gap-2">
          <button
            onClick={() => setPreviewing(true)}
            className="rounded-md bg-stone-800 px-3 py-2 text-sm font-medium text-white hover:bg-stone-700"
          >
            预览试玩
          </button>
          <button
            onClick={publish}
            disabled={publishing}
            className="rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
          >
            {publishing ? "发布中…" : savedRoute ? "再次发布更新" : "发布到工坊"}
          </button>
          {error && <p className="text-xs text-red-600">{error}</p>}
          {savedRoute && (
            <p className="rounded bg-emerald-50 px-2 py-1 text-[11px] leading-snug text-emerald-700">
              已保存到 <code className="rounded bg-white px-1 py-0.5">/routes/{savedRoute.id}.json</code>
              {" · "}
              <a className="underline" href={`/play/${savedRoute.id}`}>立即试玩 →</a>
            </p>
          )}
        </section>
      </aside>

      <div className="relative min-h-[60vh] flex-1 bg-stone-200 lg:min-h-0">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full touch-none select-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
        <div className="pointer-events-none absolute bottom-3 left-3 max-w-xs rounded-lg bg-white/85 px-3 py-2 text-xs leading-relaxed text-stone-700 shadow">
          <strong>布局技巧：</strong>把<span className="mx-1 rounded bg-emerald-100 px-1">起点</span>放在墙底部，
          <span className="mx-1 rounded bg-red-100 px-1">终点</span>放在顶部，
          中间用<span className="mx-1 rounded bg-stone-200 px-1">普通手点</span>铺一条难度合适的路径。
          手点之间不要太远 —— 角色最大伸展约 220 像素。
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</span>
      {children}
    </label>
  );
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
