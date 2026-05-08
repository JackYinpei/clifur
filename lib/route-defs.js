// Shared definitions used by both client and server. No node-only imports.

export const WALL_SIZE = { width: 800, height: 1000 };

// Hold kinds — analogous to real climbing hold families.
//   start  — route entry; hands begin here
//   finish — route exit; gripping with both hands wins
//   jug    — big positive hold; any limb can grip indefinitely
//   crimp  — tiny edge; only hands can grip (feet slip off)
//   sloper — smooth dome; any limb but auto-releases after a few seconds
export const HOLD_KINDS = ["start", "finish", "jug", "crimp", "sloper"];

export const HOLD_KIND_LABEL = {
  start: "起点",
  finish: "终点",
  jug: "大凸点",
  crimp: "小棱点",
  sloper: "圆弧点",
};

export const HOLD_KIND_DESC = {
  start: "路线起点：双手从这里开始",
  finish: "路线终点：双手都抓到即胜利",
  jug: "好抓的大凸点，所有肢体可永久抓握",
  crimp: "细小棱角，只有手能抓，脚踩不上",
  sloper: "光滑圆弧，抓住 4 秒后会自动滑脱",
};

// Gameplay rules per kind — consumed by ClimberGame
export const HOLD_KIND_RULES = {
  start: { feetCan: true, slipMs: 0 },
  finish: { feetCan: true, slipMs: 0 },
  jug: { feetCan: true, slipMs: 0 },
  crimp: { feetCan: false, slipMs: 0 },
  sloper: { feetCan: true, slipMs: 4000 },
};

// Hold colors {base, dark} for renderers
export const HOLD_KIND_FILL = {
  start: ["#7bc97a", "#4a8e4a"],
  finish: ["#e76e6e", "#a83a3a"],
  jug: ["#e8a059", "#a06a3c"],
  crimp: ["#5a4a3a", "#352818"],
  sloper: ["#e0c5a0", "#a89070"],
};

export const DIFFICULTIES = ["easy", "medium", "hard"];
export const DIFFICULTY_LABEL = { easy: "简单", medium: "中等", hard: "困难" };

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function makeId(prefix = "") {
  let s = prefix;
  for (let i = 0; i < 10; i++) {
    s += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  }
  return s;
}

export function slugify(name) {
  const base = (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return base || "route";
}

// Migrate old/short-form data into the canonical shape.
//   "hold" → "jug" (the old default)
export function migrateRoute(r) {
  if (!r || !Array.isArray(r.holds)) return r;
  const migrated = r.holds.map((h) => {
    if (h.kind === "hold") return { ...h, kind: "jug" };
    return h;
  });
  return { ...r, holds: migrated };
}

export function emptyRoute({ name = "未命名路线", author = "匿名", difficulty = "easy" } = {}) {
  return {
    id: "",
    name,
    author,
    difficulty,
    description: "",
    createdAt: new Date().toISOString(),
    wall: { width: WALL_SIZE.width, height: WALL_SIZE.height, color: "#e8d2ac" },
    holds: [
      { id: makeId("h"), x: 400, y: 800, size: 36, kind: "start" },
      { id: makeId("h"), x: 340, y: 900, size: 30, kind: "jug" },
      { id: makeId("h"), x: 460, y: 900, size: 30, kind: "jug" },
      { id: makeId("h"), x: 400, y: 90, size: 38, kind: "finish" },
    ],
  };
}

export function validateRoute(r) {
  if (!r || typeof r !== "object") return "路线数据格式错误";
  if (!r.name || typeof r.name !== "string") return "缺少路线名称";
  if (!Array.isArray(r.holds)) return "holds 必须是数组";
  if (!r.holds.some((h) => h.kind === "start")) return "至少需要一个起点 (start)";
  if (!r.holds.some((h) => h.kind === "finish")) return "至少需要一个终点 (finish)";
  for (const h of r.holds) {
    if (typeof h.x !== "number" || typeof h.y !== "number") return "手点坐标必须为数字";
    if (typeof h.size !== "number" || h.size <= 0) return "手点尺寸非法";
    const kind = h.kind === "hold" ? "jug" : h.kind; // accept legacy
    if (!HOLD_KINDS.includes(kind)) return `未知手点类型: ${h.kind}`;
  }
  if (!DIFFICULTIES.includes(r.difficulty)) return "未知难度";
  return null;
}
