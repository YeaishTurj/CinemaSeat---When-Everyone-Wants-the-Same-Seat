import { api } from "../lib/api";

export const dynamic = "force-dynamic";

export default async function ConfirmPage({ searchParams }) {
  const query = await searchParams;
  const bookingId = parseInt(query.booking_id, 10);
  if (!Number.isFinite(bookingId)) {
    return <main className="p-8 text-slate-100">booking_id required</main>;
  }
  const state = await api(`/bookings/${bookingId}`);
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="mx-auto max-w-md rounded-lg bg-slate-900 p-6 ring-1 ring-slate-800 text-center">
        <div className="text-5xl mb-2">🎉</div>
        <h1 className="text-2xl font-bold mb-2">Booking confirmed</h1>
        <p className="text-slate-400">Booking #{bookingId}</p>
        <p className="text-sm text-slate-500 mt-4">
          Seats:{" "}
          {state.seats.map((s) => `${s.row_label}${s.seat_number}`).join(", ")}
        </p>
        <p className="text-emerald-400 mt-2">
          Payment: {state.payment?.status}
        </p>
      </div>
    </main>
  );
}
