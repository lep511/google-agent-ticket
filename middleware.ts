import { next } from "@vercel/edge";

export const config = {
  matcher: "/api/:path*",
};

export default function middleware(request: Request) {
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    return new Response("BACKEND_URL not configured", { status: 502 });
  }

  const url = new URL(request.url);
  const destination = new URL(`${url.pathname}${url.search}`, backendUrl);

  return next({
    rewrite: destination,
  });
}
