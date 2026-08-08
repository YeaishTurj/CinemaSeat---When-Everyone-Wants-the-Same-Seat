import Link from "next/link";
import { api } from "../lib/api";

export const dynamic = "force-dynamic";

export default async function ShowtimesPage({ searchParams }) {
  const query = await searchParams;
  const movieId = parseInt(query.movie_id, 10);
  if (!Number.isFinite(movieId)) {
    return <main className="p-8 text-slate-100">movie_id is required</main>;
  }
  const { showtimes } = await api(`/showtimes?movie_id=${movieId}`);
  return (
    <main className="page-shell">
      <Link href="/" className="mb-6 inline-flex text-sm text-slate-400 hover:text-emerald-300">
        ← Back to movies
      </Link>
      <div className="mb-8">
        <div className="eyebrow mb-2">Movie #{movieId}</div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Choose a showtime
        </h1>
        <p className="mt-2 text-slate-400">
          Select a theatre and time to view live seat availability.
        </p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {showtimes.map((s) => (
          <li
            key={s.id}
            className="panel p-5 transition hover:-translate-y-0.5 hover:border-emerald-400/30"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">
                  {new Date(s.starts_at).toLocaleDateString([], {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </div>
                <div className="text-2xl font-bold text-emerald-400">
                  {new Date(s.starts_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
              <span className="status-pill">BDT {s.base_price}</span>
            </div>
            <div className="text-sm text-slate-400">
              {s.theatre_name} · {s.screen_name}
            </div>
            <Link
              className="btn-primary mt-5 w-full"
              href={`/showtimes/${s.id}/seats`}
            >
              Choose a seat <span aria-hidden>→</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
