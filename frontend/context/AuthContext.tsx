"use client";

import { AuthUser, LoginResponse, Business } from "@/types/auth";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import Cookies from "js-cookie";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api/axios";

type AuthContextType = {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  role: string | null;
  business: Business | null;
  isSuperuser: boolean;
  isAuthenticated: boolean;

  login: (data: LoginResponse) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

const COOKIE_KEYS = {
  user: "auth_user",
  access: "token",
  refresh: "auth_refresh",
  role: "role",
  business: "business",
  isSuperuser: "is_superuser",
};

function initializeAuth() {
  const storedUser = Cookies.get(COOKIE_KEYS.user);
  const storedAccess = Cookies.get(COOKIE_KEYS.access);
  const storedRefresh = Cookies.get(COOKIE_KEYS.refresh);
  const storedRole = Cookies.get(COOKIE_KEYS.role);
  const storedBusiness = Cookies.get(COOKIE_KEYS.business);
  const storedSuperuser = Cookies.get(COOKIE_KEYS.isSuperuser);

  return {
    user: storedUser ? (JSON.parse(storedUser) as AuthUser) : null,
    access: storedAccess || null,
    refresh: storedRefresh || null,
    role: storedRole || null,
    business: (storedBusiness as Business) || null,
    isSuperuser: storedSuperuser === "true",
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const initialAuth = initializeAuth();
  const [user, setUser] = useState<AuthUser | null>(initialAuth.user);
  const [accessToken, setAccessToken] = useState<string | null>(
    initialAuth.access,
  );
  const [refreshToken, setRefreshToken] = useState<string | null>(
    initialAuth.refresh,
  );
  const [role, setRole] = useState<string | null>(initialAuth.role);
  const [business, setBusiness] = useState<Business | null>(
    initialAuth.business,
  );
  const [isSuperuser, setIsSuperuser] = useState(initialAuth.isSuperuser);
  const [isReady, setIsReady] = useState(false);

  const pathname = usePathname();

  useEffect(() => {
    // eslint-disable-next-line
    setIsReady(true);
  }, []);

  const login = (data: LoginResponse) => {
    const authUser: AuthUser = {
      id: data.user_id,
      role: data.role,
      username: data.username,
      email: data.email,
      business: data.business || null,
      is_superuser: data.is_superuser,
    };

    setUser(authUser);
    setAccessToken(data.access);
    setRefreshToken(data.refresh);
    setRole(data.role);
    setBusiness(data.business || null);
    setIsSuperuser(data.is_superuser);

    Cookies.set(COOKIE_KEYS.user, JSON.stringify(authUser));
    Cookies.set(COOKIE_KEYS.access, data.access);
    Cookies.set(COOKIE_KEYS.refresh, data.refresh);
    Cookies.set(COOKIE_KEYS.role, data.role);
    if (data.business) {
      Cookies.set(COOKIE_KEYS.business, data.business);
    }
    Cookies.set(COOKIE_KEYS.isSuperuser, String(data.is_superuser));
  };

  const logout = useCallback(() => {
    setUser(null);
    setAccessToken(null);
    setRefreshToken(null);
    setRole(null);
    setBusiness(null);
    setIsSuperuser(false);

    Cookies.remove(COOKIE_KEYS.user);
    Cookies.remove(COOKIE_KEYS.access);
    Cookies.remove(COOKIE_KEYS.refresh);
    Cookies.remove(COOKIE_KEYS.role);
    Cookies.remove(COOKIE_KEYS.business);
    Cookies.remove(COOKIE_KEYS.isSuperuser);

    router.push("/");
  }, [router]);

  useEffect(() => {
    const responseInterceptor = api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          logout();
        }
        return Promise.reject(error);
      },
    );

    return () => {
      api.interceptors.response.eject(responseInterceptor);
    };
  }, [logout]);

  useEffect(() => {
    if (!isReady) return;

    const publicRoutes = ["/", "/forgot-password", "/reset-password"];

    const isPublicRoute = publicRoutes.some(
      (route) => pathname === route || pathname.startsWith(`${route}/`),
    );

    // Not logged in
    if (!accessToken) {
      if (!isPublicRoute) {
        router.replace("/");
      }
      return;
    }

    // Logged in
    if (pathname === "/") {
      if (role === "ADMIN") {
        router.replace("/admin");
      } else {
        router.replace("/agent");
      }
      return;
    }

    // Prevent non-admin access
    if (pathname.startsWith("/admin") && role !== "ADMIN") {
      router.replace("/agent");
    }
  }, [accessToken, role, router, isReady, pathname]);
  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        refreshToken,
        role,
        business,
        isSuperuser,
        isAuthenticated: !!accessToken,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}
