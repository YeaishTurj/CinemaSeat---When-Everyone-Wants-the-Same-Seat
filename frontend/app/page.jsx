import Link from "next/link";
import { api } from "./lib/api";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { movies } = await api("/movies");
  return (
    <main className="page-shell">
      <section className="mb-10 max-w-3xl">
        <div className="eyebrow mb-3">Now showing</div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          Your perfect seat,
          <span className="block text-emerald-400">held safely.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-slate-400 sm:text-lg">
          Browse today&apos;s movies, choose a showtime, and book with a
          concurrency-safe seat hold.
        </p>
      </section>

      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-xl font-semibold">Movies</h2>
          <p className="text-sm text-slate-500">Choose one to see showtimes</p>
        </div>
        <span className="status-pill">{movies.length} titles</span>
      </div>

      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {movies.map((m) => (
          <li
            key={m.id}
            className="panel group overflow-hidden transition duration-300 hover:-translate-y-1 hover:border-emerald-400/30"
          >
            <div className="h-32 bg-gradient-to-br from-emerald-500/20 via-slate-900 to-sky-500/10 p-5">
              <span className="text-5xl font-black text-white/10">
                {String(m.id).padStart(2, "0")}
              </span>
            </div>
            <div className="p-5">
              <div className="min-h-14 text-xl font-semibold leading-7">
                {m.title}
              </div>
              <div className="mt-1 text-sm text-slate-400">
                {m.duration_min} min · Cinema release
              </div>
              <Link
                className="btn-primary mt-5 w-full"
                href={`/showtimes?movie_id=${m.id}`}
              >
                View showtimes <span aria-hidden>→</span>
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
