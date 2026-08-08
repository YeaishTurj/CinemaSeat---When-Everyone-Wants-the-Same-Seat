import { api } from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function SeatsPage({ params }) {
  const showtimeId = parseInt(params.id, 10);
  const { seats } = await api(`/showtimes/${showtimeId}/seats`);

  const grouped = seats.reduce((acc, s) => {
    (acc[s.row_label] ||= []).push(s);
    return acc;
  }, {});
  const rows = Object.keys(grouped).sort();

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <h1 className="text-2xl font-bold mb-1">Pick a seat</h1>
      <p className="text-slate-400 mb-6">Showtime #{showtimeId}</p>
      <div className="mx-auto max-w-3xl rounded-lg bg-slate-900 p-6 ring-1 ring-slate-800">
        <div className="mb-6 text-center text-xs uppercase tracking-widest text-slate-500">
          — Screen —
        </div>
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row} className="flex items-center gap-2">
              <div className="w-6 text-right text-slate-500">{row}</div>
              <div className="flex flex-wrap gap-2">
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
  const base = "h-9 w-9 rounded text-xs font-semibold";
  const cls = available
    ? `${base} bg-emerald-600 hover:bg-emerald-500 cursor-pointer`
    : `${base} bg-slate-700 text-slate-500 cursor-not-allowed`;
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
