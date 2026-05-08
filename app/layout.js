import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "Klifur — 攀岩谜题",
  description: "用物理玩攀岩，并在创作工坊里自由设计路线。",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-stone-100 text-stone-800">
        <header className="sticky top-0 z-40 border-b border-stone-300/70 bg-stone-50/90 backdrop-blur">
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <span className="inline-block h-3 w-3 rounded-full bg-amber-500" />
              <span>Klifur</span>
            </Link>
            <div className="flex items-center gap-1 text-sm">
              <Link
                href="/play"
                className="rounded-full px-3 py-1.5 text-stone-700 hover:bg-stone-200"
              >
                路线
              </Link>
              <Link
                href="/workshop"
                className="rounded-full px-3 py-1.5 text-stone-700 hover:bg-stone-200"
              >
                创作工坊
              </Link>
            </div>
          </nav>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
        <footer className="border-t border-stone-300/70 px-6 py-4 text-center text-xs text-stone-500">
          Klifur · 物理攀岩谜题 · 灵感来自 Torfi 的同名游戏
        </footer>
      </body>
    </html>
  );
}
