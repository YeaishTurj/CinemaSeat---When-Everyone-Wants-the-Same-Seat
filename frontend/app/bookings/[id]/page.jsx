import { api } from "../../lib/api";
import Link from "next/link";
import BookingFlow from "./BookingFlow";

export const dynamic = "force-dynamic";

export default async function BookingPage({ params }) {
  const { id } = await params;
  const bookingId = parseInt(id, 10);
  if (!Number.isFinite(bookingId)) {
    return <main className="p-8 text-slate-100">invalid booking id</main>;
  }
  let state;
  try {
    state = await api(`/bookings/${bookingId}`);
  } catch (e) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 p-8 space-y-2">
        <h1 className="text-2xl font-bold">Booking #{bookingId}</h1>
        <p className="text-slate-400">
          {e.status === 404 ? "Booking not found." : e.message}
        </p>
        <Link className="text-emerald-400 underline" href="/">
          back to movies
        </Link>
      </main>
    );
  }
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <h1 className="text-2xl font-bold mb-1">Booking #{bookingId}</h1>
      <p className="text-slate-400 mb-6">Status: {state.booking.status}</p>
      <BookingFlow initialState={state} />
    </main>
  );
}
