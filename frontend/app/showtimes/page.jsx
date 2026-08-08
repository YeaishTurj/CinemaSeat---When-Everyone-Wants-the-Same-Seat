import Link from "next/link";
import { api } from "../lib/api";

export const dynamic = "force-dynamic";

export default async function ShowtimesPage({ searchParams }) {
  const movieId = parseInt(searchParams.movie_id, 10);
  if (!Number.isFinite(movieId)) {
    return <main className="p-8 text-slate-100">movie_id is required</main>;
  }
  const { showtimes } = await api(`/showtimes?movie_id=${movieId}`);
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <h1 className="text-2xl font-bold mb-4">Showtimes</h1>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {showtimes.map((s) => (
          <li
            key={s.id}
            className="rounded-lg bg-slate-900 p-4 ring-1 ring-slate-800"
          >
            <div className="text-lg font-semibold">
              {new Date(s.starts_at).toLocaleString()}
            </div>
            <div className="text-sm text-slate-400">
              {s.theatre_name} · {s.screen_name}
            </div>
            <div className="text-sm text-emerald-400">BDT {s.base_price}</div>
            <Link
              className="mt-3 inline-block rounded bg-emerald-600 px-3 py-1.5 text-sm hover:bg-emerald-500"
              href={`/showtimes/${s.id}/seats`}
            >
              Choose seat →
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
