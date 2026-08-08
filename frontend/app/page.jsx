import Link from "next/link";
import { api } from "./lib/api";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { movies } = await api("/movies");
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <h1 className="text-3xl font-bold mb-6">CinemaSeat</h1>
      <p className="text-slate-400 mb-8">Pick a movie to see showtimes.</p>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {movies.map((m) => (
          <li
            key={m.id}
            className="rounded-lg bg-slate-900 p-4 ring-1 ring-slate-800"
          >
            <div className="text-xl font-semibold">{m.title}</div>
            <div className="text-sm text-slate-400">{m.duration_min} min</div>
            <Link
              className="mt-3 inline-block rounded bg-emerald-600 px-3 py-1.5 text-sm hover:bg-emerald-500"
              href={`/showtimes?movie_id=${m.id}`}
            >
              Showtimes →
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
