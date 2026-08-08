"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function HoldForm({ showtimeId, seatId }) {
  const [userRef, setUserRef] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function submit(e) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res1 = await fetch("/api/holds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ showtime_id: showtimeId, seat_id: seatId }),
        });
        const hold = await res1.json();
        if (!res1.ok) throw new Error(hold.message || "hold failed");
        const res2 = await fetch("/api/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hold_id: hold.hold_id,
            user_ref: userRef,
            phone,
          }),
        });
        const booking = await res2.json();
        if (!res2.ok) throw new Error(booking.message || "booking failed");
        router.push(`/bookings/${booking.booking.id}`);
      } catch (err) {
        setError(err.message);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <label className="block space-y-2">
        <span className="text-sm font-medium text-slate-300">Your name</span>
        <input
          className="field"
          placeholder="e.g. Zayan"
          autoComplete="name"
          value={userRef}
          onChange={(e) => setUserRef(e.target.value)}
          required
        />
      </label>
      <label className="block space-y-2">
        <span className="text-sm font-medium text-slate-300">Phone number</span>
        <input
          className="field"
          placeholder="01700000000"
          autoComplete="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
      </label>
      <p className="text-xs leading-5 text-slate-500">
        Your seat is held only after this form succeeds. Complete OTP and
        payment before the hold expires.
      </p>
      <button
        type="submit"
        disabled={pending}
        className="btn-primary w-full"
      >
        {pending ? "Securing your seat…" : "Hold seat & continue"}
      </button>
      {error && (
        <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">
          {error}
        </p>
      )}
    </form>
  );
}
