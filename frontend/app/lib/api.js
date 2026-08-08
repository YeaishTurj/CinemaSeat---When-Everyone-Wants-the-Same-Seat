// Tiny client wrapper so pages don't repeat fetch boilerplate.
// Next.js rewrites only apply on the client. Server components must use
// an absolute URL derived from the request headers.

function absoluteUrl(path) {
  // Server-side: rewrite using NEXT_PUBLIC_API_URL when available
  // (matches the destination in next.config.js).
  const base = process.env.NEXT_PUBLIC_API_URL || "http://api:3000";
  // Strip a leading "/api" if the caller already added it, then re-add once.
  const stripped = path.startsWith("/api") ? path.slice(4) : path;
  return `${base}${stripped.startsWith("/") ? "" : "/"}${stripped}`;
}

export async function api(path, init) {
  const isServer = typeof window === "undefined";
  const url = isServer
    ? absoluteUrl(path)
    : `/api${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(body?.message || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.code = body?.code;
    throw err;
  }
  return body;
}
