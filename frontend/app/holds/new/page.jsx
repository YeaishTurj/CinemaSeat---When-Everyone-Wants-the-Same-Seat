import HoldForm from "./HoldForm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function HoldNewPage({ searchParams }) {
  const query = await searchParams;
  const showtimeId = parseInt(query.showtime_id, 10);
  const seatId = parseInt(query.seat_id, 10);
  if (!Number.isFinite(showtimeId) || !Number.isFinite(seatId)) {
    return (
      <main className="p-8 text-slate-100">
        showtime_id and seat_id are required
      </main>
    );
  }
  return (
    <main className="page-shell">
      <div className="mx-auto max-w-lg">
        <Link
          href={`/showtimes/${showtimeId}/seats`}
          className="mb-6 inline-flex text-sm text-slate-400 hover:text-emerald-300"
        >
          ← Change seat
        </Link>
        <div className="eyebrow mb-2">Secure your seat</div>
        <h1 className="text-3xl font-bold tracking-tight">One last step</h1>
        <p className="mt-2 text-slate-400">
          Add your details to create a time-limited hold.
        </p>

        <div className="panel mt-7 overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-6 py-4">
            <div>
              <div className="text-xs text-slate-500">Showtime</div>
              <div className="font-semibold">#{showtimeId}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">Selected seat</div>
              <div className="text-xl font-bold text-emerald-400">#{seatId}</div>
            </div>
          </div>
          <div className="p-6">
            <HoldForm showtimeId={showtimeId} seatId={seatId} />
          </div>
        </div>
      </div>
    </main>
  );
}
