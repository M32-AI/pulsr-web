import { NextRequest, NextResponse } from "next/server";

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/admin")) {
    // Auth is stored in localStorage by zustand/persist ("pulsr-auth").
    // Middleware runs on the server/edge and can't read localStorage, so we
    // use a cookie mirror. The LoginPage sets this cookie on success and the
    // SignOut action clears it.
    const isAuthenticated = req.cookies.has("pulsr-authed");

    if (!isAuthenticated) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
