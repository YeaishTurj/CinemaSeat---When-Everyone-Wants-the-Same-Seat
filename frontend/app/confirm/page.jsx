import { api } from "../lib/api";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ConfirmPage({ searchParams }) {
  const query = await searchParams;
  const bookingId = parseInt(query.booking_id, 10);
  if (!Number.isFinite(bookingId)) {
    return <main className="p-8 text-slate-100">booking_id required</main>;
  }
  const state = await api(`/bookings/${bookingId}`);
  return (
    <main className="page-shell grid place-items-center">
      <div className="panel w-full max-w-lg overflow-hidden text-center">
        <div className="bg-gradient-to-b from-emerald-400/15 to-transparent px-6 pb-6 pt-10">
          <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full bg-emerald-400 text-3xl text-slate-950 shadow-[0_0_40px_rgba(52,211,153,0.3)]">
            ✓
          </div>
          <div className="eyebrow mb-2">Payment successful</div>
          <h1 className="text-3xl font-bold tracking-tight">Booking confirmed</h1>
          <p className="mt-2 text-slate-400">Booking #{bookingId}</p>
        </div>
        <div className="border-t border-white/10 p-6">
          <div className="grid grid-cols-2 gap-3 text-left">
            <div className="rounded-xl bg-white/[0.04] p-4">
              <div className="text-xs uppercase tracking-wider text-slate-500">Seats</div>
              <div className="mt-1 font-semibold text-emerald-400">
                {state.seats
                  .map((s) => `${s.row_label}${s.seat_number}`)
                  .join(", ")}
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-4">
              <div className="text-xs uppercase tracking-wider text-slate-500">Payment</div>
              <div className="mt-1 font-semibold">{state.payment?.status}</div>
            </div>
          </div>
          <p className="mt-5 text-sm leading-6 text-slate-500">
            Your seat is locked in and marked as booked in the cinema ledger.
          </p>
          <Link href="/" className="btn-primary mt-6 w-full">
            Browse more movies
          </Link>
        </div>
      </div>
    </main>
  );
}
