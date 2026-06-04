"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { RoleId } from "@/domain/types";

export type DemoUser = {
  name: string;
  role: RoleId;
  userId: string;
};

export type DemoLoginInput = {
  name: string;
  role: RoleId;
  authToken?: string;
};

type StoredDemoSession = {
  currentUser: DemoUser;
};

export type RoleContextValue = {
  currentUser: DemoUser | null;
  isSessionReady: boolean;
  isAuthenticated: boolean;
  activeRole: RoleId;
  login: (input: DemoLoginInput) => DemoUser;
  logout: () => void;
  setActiveRole: (role: RoleId) => void;
  authToken: string;
  setAuthToken: (token: string) => void;
  apiHeaders: (extra?: Record<string, string>) => Record<string, string>;
};

const demoSessionStorageKey = "finproof.demoSession";
const authTokenStorageKey = "finproof.authToken";
const seededDemoUserIds: Record<RoleId, string> = {
  requester: "user-requester-demo",
  reviewer: "user-reviewer-demo",
  compliance_admin: "user-admin-demo"
};

const RoleContext = createContext<RoleContextValue | null>(null);

function isBrowser() {
  return typeof window !== "undefined";
}

function isRoleId(role: unknown): role is RoleId {
  return role === "requester" || role === "reviewer" || role === "compliance_admin";
}

function seededDemoUserIdForRole(role: RoleId) {
  return seededDemoUserIds[role];
}

function headerUserName(currentUser: DemoUser | null): string {
  return currentUser ? encodeURIComponent(currentUser.name) : "";
}

function readStoredDemoUser() {
  if (!isBrowser()) {
    return null;
  }

  const storedSession = window.localStorage.getItem(demoSessionStorageKey);

  if (!storedSession) {
    return null;
  }

  try {
    const parsedSession = JSON.parse(storedSession) as Partial<StoredDemoSession>;
    const currentUser = parsedSession.currentUser;

    if (
      !currentUser ||
      typeof currentUser.name !== "string" ||
      currentUser.name.trim().length === 0 ||
      !isRoleId(currentUser.role)
    ) {
      return null;
    }

    return {
      name: currentUser.name.trim(),
      role: currentUser.role,
      userId: seededDemoUserIdForRole(currentUser.role)
    };
  } catch {
    return null;
  }
}

function persistDemoUser(currentUser: DemoUser | null) {
  if (!isBrowser()) {
    return;
  }

  if (currentUser) {
    window.localStorage.setItem(demoSessionStorageKey, JSON.stringify({ currentUser }));
  } else {
    window.localStorage.removeItem(demoSessionStorageKey);
  }
}

export function RoleProvider({
  children,
  initialRole = "reviewer",
  initialAuthToken = ""
}: {
  children: ReactNode;
  initialRole?: RoleId;
  initialAuthToken?: string;
}) {
  const [fallbackRole, setFallbackRole] = useState<RoleId>(initialRole);
  const [currentUser, setCurrentUser] = useState<DemoUser | null>(null);
  const [authToken, setAuthTokenState] = useState(initialAuthToken);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const exposedCurrentUser = isSessionReady ? currentUser : null;
  const isAuthenticated = exposedCurrentUser !== null;
  const activeRole = exposedCurrentUser?.role ?? fallbackRole;

  useEffect(() => {
    let cancelled = false;

    // Restore the demo session after the first hydration pass so role-specific links
    // do not replace the server-rendered shell while React is still hydrating it.
    const timer = window.setTimeout(() => {
      if (cancelled) {
        return;
      }

      const storedUser = readStoredDemoUser();

      if (storedUser) {
        setCurrentUser(storedUser);
      }

      if (!initialAuthToken && isBrowser()) {
        setAuthTokenState(window.localStorage.getItem(authTokenStorageKey) ?? "");
      }

      setIsSessionReady(true);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [initialAuthToken]);

  const setAuthToken = useCallback((token: string) => {
    setAuthTokenState(token);

    if (!isBrowser()) {
      return;
    }

    if (token.trim().length > 0) {
      window.localStorage.setItem(authTokenStorageKey, token);
    } else {
      window.localStorage.removeItem(authTokenStorageKey);
    }
  }, []);

  const login = useCallback(
    (input: DemoLoginInput) => {
      const name = input.name.trim();
      const nextUser = {
        name,
        role: input.role,
        userId: seededDemoUserIdForRole(input.role)
      };

      setCurrentUser(nextUser);
      setIsSessionReady(true);
      persistDemoUser(nextUser);

      if (input.authToken !== undefined) {
        setAuthToken(input.authToken);
      }

      return nextUser;
    },
    [setAuthToken]
  );

  const logout = useCallback(() => {
    setCurrentUser(null);
    setIsSessionReady(true);
    persistDemoUser(null);
    setAuthToken("");
  }, [setAuthToken]);

  const setActiveRole = useCallback((role: RoleId) => {
    setFallbackRole(role);
    setCurrentUser((previousUser) => {
      if (!previousUser) {
        return previousUser;
      }

      const nextUser = { ...previousUser, role, userId: seededDemoUserIdForRole(role) };
      persistDemoUser(nextUser);

      return nextUser;
    });
  }, []);

  const apiHeaders = useCallback(
    (extra: Record<string, string> = {}) => {
      const token = authToken.trim();
      const userHeaders = exposedCurrentUser
        ? {
            "x-finproof-user-id": exposedCurrentUser.userId,
            "x-finproof-user-name": headerUserName(exposedCurrentUser)
          }
        : {};

      return {
        "x-finproof-role": activeRole,
        ...userHeaders,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...extra
      };
    },
    [activeRole, authToken, exposedCurrentUser]
  );

  const value = useMemo(
    () => ({
      currentUser: exposedCurrentUser,
      isSessionReady,
      isAuthenticated,
      activeRole,
      login,
      logout,
      setActiveRole,
      authToken,
      setAuthToken,
      apiHeaders
    }),
    [
      activeRole,
      apiHeaders,
      authToken,
      exposedCurrentUser,
      isAuthenticated,
      isSessionReady,
      login,
      logout,
      setActiveRole,
      setAuthToken
    ]
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
