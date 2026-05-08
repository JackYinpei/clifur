import Link from "next/link";
import { listRoutes } from "@/lib/routes-server";
import { DIFFICULTY_LABEL } from "@/lib/route-defs";

export const dynamic = "force-dynamic"; // always read fresh from disk

export default async function PlayIndex() {
  const routes = await listRoutes();
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-stone-900">所有路线</h1>
          <p className="mt-1 text-sm text-stone-500">挑选一条挑战，或在创作工坊设计自己的。</p>
        </div>
        <Link
          href="/workshop"
          className="inline-flex h-9 items-center rounded-full bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-700"
        >
          + 创建路线
        </Link>
      </header>

      {routes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-12 text-center">
          <p className="text-stone-600">还没有任何路线发布。</p>
          <Link
            href="/workshop"
            className="mt-4 inline-flex h-9 items-center rounded-full bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-700"
          >
            前往创作工坊
          </Link>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {routes.map((r) => (
            <li key={r.id}>
              <Link
                href={`/play/${r.id}`}
                className="group flex h-full flex-col gap-2 rounded-2xl border border-stone-300 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs uppercase tracking-wide text-stone-500">
                    {DIFFICULTY_LABEL[r.difficulty] ?? r.difficulty}
                  </span>
                  <span className="text-xs text-stone-400">{r.holdCount} 个手点</span>
                </div>
                <h2 className="text-lg font-bold text-stone-900 group-hover:text-amber-700">
                  {r.name}
                </h2>
                <p className="text-sm text-stone-500">作者 · {r.author}</p>
                {r.description && (
                  <p className="mt-1 text-xs leading-5 text-stone-500 line-clamp-3">
                    {r.description}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
