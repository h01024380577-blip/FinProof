"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { RoleId } from "@/domain/types";

type RoleContextValue = {
  activeRole: RoleId;
  setActiveRole: (role: RoleId) => void;
  authToken: string;
  setAuthToken: (token: string) => void;
  apiHeaders: (extra?: Record<string, string>) => Record<string, string>;
};

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({
  children,
  initialRole = "reviewer",
  initialAuthToken = ""
}: {
  children: React.ReactNode;
  initialRole?: RoleId;
  initialAuthToken?: string;
}) {
  const [activeRole, setActiveRole] = useState<RoleId>(initialRole);
  const [authToken, setAuthTokenState] = useState(() => {
    if (initialAuthToken || typeof window === "undefined") {
      return initialAuthToken;
    }

    return window.localStorage.getItem("finproof.authToken") ?? "";
  });

  const setAuthToken = useCallback((token: string) => {
    setAuthTokenState(token);

    if (token.trim().length > 0) {
      window.localStorage.setItem("finproof.authToken", token);
    } else {
      window.localStorage.removeItem("finproof.authToken");
    }
  }, []);

  const apiHeaders = useCallback(
    (extra: Record<string, string> = {}) => {
      const token = authToken.trim();

      return {
        "x-finproof-role": activeRole,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...extra
      };
    },
    [activeRole, authToken]
  );

  const value = useMemo(
    () => ({ activeRole, setActiveRole, authToken, setAuthToken, apiHeaders }),
    [activeRole, apiHeaders, authToken, setAuthToken]
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRoleContext() {
  return useContext(RoleContext);
}

export function useRole() {
  const context = useRoleContext();

  if (!context) {
    throw new Error("useRole must be used inside RoleProvider");
  }

  return context;
}
