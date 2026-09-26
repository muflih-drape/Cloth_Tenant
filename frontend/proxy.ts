import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function isTokenExpired(token: string) {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map(function (c) {
          return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join(""),
    );

    const payload = JSON.parse(jsonPayload);
    // Add 5 seconds buffer
    if (payload.exp && payload.exp * 1000 <= Date.now() + 5000) {
      return true;
    }
    return false;
  } catch {
    return true; // invalid token
  }
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get("token")?.value;
  const role = request.cookies.get("role")?.value;

  // Expired token cleanup
  if (token && isTokenExpired(token)) {
    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.delete("token");
    response.cookies.delete("role");
    response.cookies.delete("auth_user");
    response.cookies.delete("auth_refresh");
    return response;
  }

  if (pathname.startsWith("/admin") && role !== "ADMIN") {
    return NextResponse.redirect(new URL("/agent", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|forgot-password|reset-password|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
