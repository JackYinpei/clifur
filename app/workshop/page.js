import RouteEditor from "@/components/RouteEditor";

export const metadata = { title: "创作工坊 — Klifur" };

export default function WorkshopPage() {
  return (
    <main className="klifur-workshop-main flex flex-1 min-h-0">
      <RouteEditor />
    </main>
  );
}
