import { notFound } from "next/navigation";
import ClimberGame from "@/components/ClimberGame";
import { getRoute } from "@/lib/routes-server";

export const dynamic = "force-dynamic";

export default async function PlayRoute({ params }) {
  const { id } = await params;
  const route = await getRoute(id);
  if (!route) notFound();
  return (
    <main className="klifur-play-main flex min-h-screen flex-1 flex-col bg-[#15110e]">
      <ClimberGame route={route} />
    </main>
  );
}
