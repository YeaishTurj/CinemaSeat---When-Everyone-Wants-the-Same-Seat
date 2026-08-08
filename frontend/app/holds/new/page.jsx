import { api } from "../../lib/api";
import HoldForm from "./HoldForm";

export const dynamic = "force-dynamic";

export default async function HoldNewPage({ searchParams }) {
  const showtimeId = parseInt(searchParams.showtime_id, 10);
  const seatId = parseInt(searchParams.seat_id, 10);
  if (!Number.isFinite(showtimeId) || !Number.isFinite(seatId)) {
    return (
      <main className="p-8 text-slate-100">
        showtime_id and seat_id are required
      </main>
    );
  }
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <h1 className="text-2xl font-bold mb-1">One last step</h1>
      <p className="text-slate-400 mb-6">
        Showtime #{showtimeId} · Seat #{seatId}
      </p>
      <div className="mx-auto max-w-md rounded-lg bg-slate-900 p-6 ring-1 ring-slate-800">
        <HoldForm showtimeId={showtimeId} seatId={seatId} />
      </div>
    </main>
  );
}
