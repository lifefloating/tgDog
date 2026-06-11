import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifyTokenEdge } from "@/lib/auth-edge";

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|login|api/auth|api/avatar).*)",
  ],
};

export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (await verifyTokenEdge(token)) {
    return NextResponse.next();
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}
