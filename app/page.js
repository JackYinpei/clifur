import Link from "next/link";
import { listRoutes } from "@/lib/routes-server";
import { DIFFICULTY_LABEL } from "@/lib/route-defs";
import HeroWallPreview from "@/components/HeroWallPreview";

export default async function Home() {
  const routes = await listRoutes();
  const featured = routes.slice(0, 3);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-12 px-6 py-12">
      <section className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="flex flex-col gap-5">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-amber-300/70 bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
            物理攀岩谜题
          </span>
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-stone-900 sm:text-5xl">
            像真正的攀岩手一样，思考下一个动作。
          </h1>
          <p className="max-w-xl text-base leading-7 text-stone-600">
            Klifur 是一个柔体物理攀岩谜题游戏：拖动手脚抓住墙上的手点，
            保持至少两个支点，让角色一步步登上墙顶。在创作工坊里，你也可以亲手设计自己的路线并分享出来。
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/play"
              className="inline-flex h-11 items-center rounded-full bg-stone-900 px-5 text-sm font-semibold text-white hover:bg-stone-700"
            >
              开始攀岩
            </Link>
            <Link
              href="/workshop"
              className="inline-flex h-11 items-center rounded-full border border-stone-300 bg-white px-5 text-sm font-semibold text-stone-800 hover:bg-stone-100"
            >
              进入创作工坊
            </Link>
          </div>
        </div>
        <HeroWallPreview />

      </section>

      <section>
        <div className="mb-4 flex items-end justify-between">
          <h2 className="text-2xl font-bold tracking-tight text-stone-900">推荐路线</h2>
          <Link href="/play" className="text-sm font-medium text-amber-700 hover:underline">
            查看全部 →
          </Link>
        </div>
        {featured.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-10 text-center">
            <p className="text-stone-600">还没有任何路线。</p>
            <Link
              href="/workshop"
              className="mt-3 inline-flex h-9 items-center rounded-full bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-700"
            >
              成为第一位作者
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((r) => (
              <Link
                key={r.id}
                href={`/play/${r.id}`}
                className="group flex flex-col gap-2 rounded-2xl border border-stone-300 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wide text-stone-400">
                    {DIFFICULTY_LABEL[r.difficulty] ?? r.difficulty}
                  </span>
                  <span className="text-xs text-stone-400">{r.holdCount} 个手点</span>
                </div>
                <h3 className="text-lg font-bold text-stone-900 group-hover:text-amber-700">
                  {r.name}
                </h3>
                <p className="text-sm text-stone-500">作者 · {r.author}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-8 shadow-sm sm:grid-cols-3">
        <div>
          <h3 className="text-base font-bold text-stone-900">柔体物理</h3>
          <p className="mt-1 text-sm text-stone-500">
            Verlet 骨骼模拟，松开手脚会真实地下垂、摇晃。
          </p>
        </div>
        <div>
          <h3 className="text-base font-bold text-stone-900">手点谜题</h3>
          <p className="mt-1 text-sm text-stone-500">
            起点、终点、普通手点 —— 关键在于规划顺序与重心。
          </p>
        </div>
        <div>
          <h3 className="text-base font-bold text-stone-900">创作工坊</h3>
          <p className="mt-1 text-sm text-stone-500">
            点点鼠标设计自己的路线，发布之后任何人都可以来挑战。
          </p>
        </div>
      </section>
    </main>
  );
}
