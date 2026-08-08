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
    <form onSubmit={submit} className="space-y-3">
      <input
        className="w-full rounded bg-slate-800 p-2 text-slate-100"
        placeholder="Your name or user_ref"
        value={userRef}
        onChange={(e) => setUserRef(e.target.value)}
        required
      />
      <input
        className="w-full rounded bg-slate-800 p-2 text-slate-100"
        placeholder="Phone (+8801XXXXXXXXX)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        required
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-emerald-600 px-3 py-2 text-sm hover:bg-emerald-500 disabled:opacity-50"
      >
        {pending ? "Holding…" : "Hold seat & book"}
      </button>
      {error && <p className="text-rose-400 text-sm">{error}</p>}
    </form>
  );
}
