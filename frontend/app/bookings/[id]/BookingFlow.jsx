"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function BookingFlow({ initialState }) {
  const [state, setState] = useState(initialState);
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [devHint, setDevHint] = useState(null);
  const router = useRouter();
  const bookingId = initialState.booking.id;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function loadLatestOtp({ wait = false } = {}) {
    const attempts = wait ? 18 : 1;
    for (let i = 0; i < attempts; i += 1) {
      const res = await fetch(`/api/dev/otp-latest/bk_${bookingId}`, {
        cache: "no-store",
      });
      if (res.status === 404) return null;
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message || `helper returned ${res.status}`);
      }
      if (body.delivered) return String(body.code);
      if (i < attempts - 1) await sleep(1000);
    }
    return "";
  }

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
    setDevHint("Sending OTP…");
    startTransition(async () => {
      try {
        const sent = await fetch(`/api/bookings/${bookingId}/otp/send`, {
          method: "POST",
        });
        const sentBody = await sent.json();
        if (!sent.ok) throw new Error(sentBody.message || "OTP send failed");
        setDevHint("OTP sent. Waiting for delivery…");
        const latest = await loadLatestOtp({ wait: true });
        if (latest) {
          setCode(latest);
          setDevHint(`Latest OTP: ${latest}`);
        } else if (latest === null) {
          setDevHint("OTP sent. Enter the code received on your phone.");
        } else {
          setDevHint("OTP was not delivered. Click Send OTP to try again.");
        }
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
        const paid = await fetch(`/api/bookings/${bookingId}/pay`, {
          method: "POST",
        });
        const paidBody = await paid.json();
        if (!paid.ok) {
          throw new Error(paidBody.message || "payment could not be started");
        }
        const r = await fetch(`/api/bookings/${bookingId}`, {
          cache: "no-store",
        });
        if (r.ok) setState(await r.json());
      } catch (e) {
        setError(e.message);
      }
    });
  }

  // Dev convenience: load the mock gateway's latest OTP through the API.
  // The helper returns 404 when disabled in production.
  async function copyLatestOtp() {
    setError(null);
    setDevHint(null);
    try {
      const latest = await loadLatestOtp();
      if (latest === null) {
        setDevHint("Dev OTP helper is disabled in this environment.");
        return;
      }
      if (!latest) {
        setDevHint("No OTP has been delivered. Click Send OTP first.");
      } else {
        setCode(latest);
        setDevHint(`Latest OTP: ${latest}`);
      }
    } catch (e) {
      setDevHint(`Could not reach dev helper: ${e.message}`);
    }
  }

  const otpStatus = state.otp?.status || "NONE";
  const paymentStatus = state.payment?.status || "NOT_STARTED";
  const steps = [
    { label: "Seat held", done: true },
    { label: "OTP verified", done: otpStatus === "VERIFIED" },
    { label: "Payment", done: state.booking.status === "CONFIRMED" },
  ];

  return (
    <div className="space-y-5">
      <ol className="grid grid-cols-3 gap-2" aria-label="Booking progress">
        {steps.map((step, index) => (
          <li
            key={step.label}
            className={`rounded-xl border px-3 py-3 text-center text-xs font-medium sm:text-sm ${
              step.done
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                : "border-white/10 bg-white/[0.03] text-slate-500"
            }`}
          >
            <span className="mb-1 block text-[10px] uppercase tracking-wider opacity-70">
              Step {index + 1}
            </span>
            {step.done ? "✓ " : ""}
            {step.label}
          </li>
        ))}
      </ol>

      <div className="panel flex items-center justify-between gap-4 p-5">
        <div>
          <div className="text-sm text-slate-400">Order total</div>
          <div className="mt-1 text-3xl font-bold tracking-tight">
            <span className="text-base font-medium text-slate-500">BDT </span>
            {state.booking.total_amount}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Seats
          </div>
          <div className="mt-1 font-semibold text-emerald-400">
            {state.seats
              .map((s) => `${s.row_label}${s.seat_number}`)
              .join(", ") || "—"}
          </div>
        </div>
      </div>

      <div className="panel p-5 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold">OTP verification</div>
            <div className="mt-1 text-sm text-slate-400">
              Confirm the phone number attached to this booking.
            </div>
          </div>
          <span className="status-pill">{otpStatus}</span>
        </div>
        {otpStatus === "NONE" && (
          <button
            disabled={pending}
            onClick={sendOtp}
            className="btn-primary"
          >
            Send OTP
          </button>
        )}
        {otpStatus === "PENDING" && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                disabled={pending}
                onClick={sendOtp}
                className="btn-secondary"
              >
                {state.otp?.attempts > 0 ? "Resend OTP" : "Send OTP"}
              </button>
              <button
                disabled={pending}
                onClick={copyLatestOtp}
                title="Dev helper: load the latest OTP from the mock gateway"
                className="inline-flex items-center justify-center rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-semibold text-amber-950 transition hover:bg-amber-300 disabled:opacity-50"
              >
                Show latest OTP
              </button>
            </div>
            {devHint && (
              <div className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
                {devHint}
              </div>
            )}
            <form onSubmit={verifyOtp} className="flex flex-col gap-2 sm:flex-row">
              <input
                className="field flex-1"
                placeholder="6-digit OTP"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
              <button
                type="submit"
                disabled={pending}
                className="btn-primary"
              >
                Verify
              </button>
            </form>
          </div>
        )}
        {otpStatus === "VERIFIED" && (
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300">
            ✓ Phone number verified successfully
          </div>
        )}
      </div>

      <div className="panel p-5 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold">Payment</div>
            <div className="mt-1 text-sm text-slate-400">
              The final result arrives asynchronously from the gateway.
            </div>
          </div>
          <span className="status-pill">{paymentStatus}</span>
        </div>
        {state.booking.status === "PENDING" &&
          otpStatus === "VERIFIED" &&
          paymentStatus !== "PENDING" && (
            <button
              disabled={pending}
              onClick={pay}
              className="btn-primary w-full sm:w-auto"
            >
              Pay BDT {state.booking.total_amount}
            </button>
          )}
        {paymentStatus === "PENDING" && (
          <div className="flex items-center gap-3 rounded-xl bg-sky-400/10 p-3 text-sm text-sky-300">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-300/30 border-t-sky-300" />
            Payment is processing. This page updates automatically.
          </div>
        )}
        {otpStatus !== "VERIFIED" && (
          <p className="text-sm text-slate-500">Verify OTP to unlock payment.</p>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
