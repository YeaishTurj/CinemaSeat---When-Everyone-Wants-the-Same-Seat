import Link from "next/link";
import { api } from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function SeatsPage({ params }) {
  const { id } = await params;
  const showtimeId = parseInt(id, 10);
  const { seats } = await api(`/showtimes/${showtimeId}/seats`);

  const grouped = seats.reduce((acc, s) => {
    (acc[s.row_label] ||= []).push(s);
    return acc;
  }, {});
  const rows = Object.keys(grouped).sort();

  return (
    <main className="page-shell">
      <Link href="/" className="mb-6 inline-flex text-sm text-slate-400 hover:text-emerald-300">
        ← Back to movies
      </Link>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-2">Showtime #{showtimeId}</div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Pick your seat
          </h1>
          <p className="mt-2 text-slate-400">Green seats are available now.</p>
        </div>
        <div className="flex gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-2"><i className="h-3 w-3 rounded bg-emerald-500" /> Available</span>
          <span className="flex items-center gap-2"><i className="h-3 w-3 rounded bg-slate-700" /> Unavailable</span>
        </div>
      </div>
      <div className="panel mx-auto max-w-4xl overflow-x-auto p-5 sm:p-8">
        <div className="mx-auto mb-10 h-2 max-w-2xl rounded-full bg-gradient-to-r from-transparent via-sky-300 to-transparent shadow-[0_8px_28px_rgba(125,211,252,0.35)]" />
        <div className="mb-7 text-center text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">
          Screen
        </div>
        <div className="min-w-[34rem] space-y-2.5">
          {rows.map((row) => (
            <div key={row} className="flex items-center gap-2">
              <div className="w-6 text-right text-xs font-semibold text-slate-500">{row}</div>
              <div className="flex flex-1 justify-center gap-2">
                {grouped[row].map((s) => (
                  <SeatButton
                    key={s.seat_id}
                    seat={s}
                    showtimeId={showtimeId}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

function SeatButton({ seat, showtimeId }) {
  const available =
    seat.status === "AVAILABLE" ||
    (seat.status === "HELD" &&
      seat.hold_expires_at &&
      new Date(seat.hold_expires_at) < new Date());
  const base = "h-9 w-9 rounded-lg text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-slate-900";
  const cls = available
    ? `${base} bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-950 hover:-translate-y-0.5 hover:bg-emerald-400 cursor-pointer`
    : `${base} bg-slate-800 text-slate-600 cursor-not-allowed`;
  return (
    <form action={available ? "/holds/new" : "#"} method="get">
      <input type="hidden" name="showtime_id" value={showtimeId} />
      <input type="hidden" name="seat_id" value={seat.seat_id} />
      <button
        type="submit"
        disabled={!available}
        className={cls}
        title={`${seat.row_label}${seat.seat_number} · ${seat.status}`}
      >
        {seat.seat_number}
      </button>
    </form>
  );
}
