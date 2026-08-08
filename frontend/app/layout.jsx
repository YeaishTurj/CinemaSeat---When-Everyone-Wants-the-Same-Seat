import "./globals.css";
import Link from "next/link";

export const metadata = {
  title: "CinemaSeat",
  description: "When everyone wants the same seat.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-8">
            <Link
              href="/"
              className="group flex items-center gap-2.5 font-semibold tracking-tight"
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500 text-lg text-slate-950 shadow-lg shadow-emerald-950/40 transition group-hover:rotate-3">
                C
              </span>
              <span>
                Cinema<span className="text-emerald-400">Seat</span>
              </span>
            </Link>
            <div className="status-pill">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
              Concurrency-safe booking
            </div>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
