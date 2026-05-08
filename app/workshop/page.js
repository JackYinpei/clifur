import RouteEditor from "@/components/RouteEditor";

export const metadata = { title: "创作工坊 — Klifur" };

export default function WorkshopPage() {
  return (
    <main className="flex flex-1 flex-col">
      <RouteEditor />
    </main>
  );
}
