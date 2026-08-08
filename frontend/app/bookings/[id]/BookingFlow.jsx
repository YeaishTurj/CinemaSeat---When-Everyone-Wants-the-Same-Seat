"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function BookingFlow({ initialState }) {
  const [state, setState] = useState(initialState);
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const router = useRouter();
  const bookingId = initialState.booking.id;

  // Poll every 2s while not confirmed/cancelled.
  useEffect(() => {
    if (["CONFIRMED", "CANCELLED", "EXPIRED"].includes(state.booking.status)) {
      if (state.booking.status === "CONFIRMED") {
        router.push(`/confirm?booking_id=${bookingId}`);
      }
      return;
    }
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/bookings/${bookingId}`, {
          cache: "no-store",
        });
        if (res.ok) setState(await res.json());
      } catch (_) {
        /* keep last state */
      }
    }, 2000);
    return () => clearInterval(t);
  }, [state.booking.status, bookingId, router]);

  function sendOtp() {
    setError(null);
    startTransition(async () => {
      try {
        await fetch(`/api/bookings/${bookingId}/otp/send`, { method: "POST" });
        const res = await fetch(`/api/bookings/${bookingId}`, {
          cache: "no-store",
        });
        if (res.ok) setState(await res.json());
      } catch (e) {
        setError(e.message);
      }
    });
  }

  function verifyOtp(e) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/bookings/${bookingId}/otp/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.message || "verify failed");
        const r2 = await fetch(`/api/bookings/${bookingId}`, {
          cache: "no-store",
        });
        if (r2.ok) setState(await r2.json());
      } catch (e) {
        setError(e.message);
      }
    });
  }

  function pay() {
    setError(null);
    startTransition(async () => {
      try {
        await fetch(`/api/bookings/${bookingId}/pay`, { method: "POST" });
        const r = await fetch(`/api/bookings/${bookingId}`, {
          cache: "no-store",
        });
        if (r.ok) setState(await r.json());
      } catch (e) {
        setError(e.message);
      }
    });
  }

  const otpStatus = state.otp?.status || "NONE";

  return (
    <div className="space-y-6 max-w-md">
      <div className="rounded bg-slate-900 p-4 ring-1 ring-slate-800">
        <div className="text-sm text-slate-400">Total</div>
        <div className="text-2xl font-semibold">
          BDT {state.booking.total_amount}
        </div>
        <div className="text-xs text-slate-500">
          Seats:{" "}
          {state.seats
            .map((s) => `${s.row_label}${s.seat_number}`)
            .join(", ") || "—"}
        </div>
      </div>

      <div className="rounded bg-slate-900 p-4 ring-1 ring-slate-800">
        <div className="font-semibold mb-2">OTP verification</div>
        <div className="text-sm text-slate-400 mb-2">Status: {otpStatus}</div>
        {otpStatus === "NONE" && (
          <button
            disabled={pending}
            onClick={sendOtp}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm hover:bg-emerald-500 disabled:opacity-50"
          >
            Send OTP
          </button>
        )}
        {otpStatus === "PENDING" && (
          <div className="space-y-2">
            <button
              disabled={pending}
              onClick={sendOtp}
              className="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600 disabled:opacity-50"
            >
              Resend OTP
            </button>
            <form onSubmit={verifyOtp} className="flex gap-2">
              <input
                className="flex-1 rounded bg-slate-800 p-2"
                placeholder="Enter code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
              <button
                type="submit"
                disabled={pending}
                className="rounded bg-emerald-600 px-3 py-2 text-sm hover:bg-emerald-500 disabled:opacity-50"
              >
                Verify
              </button>
            </form>
          </div>
        )}
        {otpStatus === "VERIFIED" && (
          <div className="text-emerald-400 text-sm">Verified ✓</div>
        )}
      </div>

      <div className="rounded bg-slate-900 p-4 ring-1 ring-slate-800">
        <div className="font-semibold mb-2">Payment</div>
        <div className="text-sm text-slate-400 mb-2">
          Status: {state.payment?.status || "NOT_STARTED"}
        </div>
        {state.booking.status === "PENDING" && otpStatus === "VERIFIED" && (
          <button
            disabled={pending}
            onClick={pay}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm hover:bg-emerald-500 disabled:opacity-50"
          >
            Pay BDT {state.booking.total_amount}
          </button>
        )}
      </div>

      {error && <p className="text-rose-400 text-sm">{error}</p>}
    </div>
  );
}
