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
    <main className="page-shell">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="mb-6 inline-flex text-sm text-slate-400 hover:text-emerald-300">
          ← Back to movies
        </Link>
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow mb-2">Checkout</div>
            <h1 className="text-3xl font-bold tracking-tight">
              Booking #{bookingId}
            </h1>
            <p className="mt-2 text-slate-400">
              Verify your phone, then complete payment.
            </p>
          </div>
          <span className="status-pill">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            {state.booking.status}
          </span>
        </div>
        <BookingFlow initialState={state} />
      </div>
    </main>
  );
}
