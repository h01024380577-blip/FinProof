"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { RoleId } from "@/domain/types";

type RoleContextValue = {
  activeRole: RoleId;
  setActiveRole: (role: RoleId) => void;
};

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({
  children,
  initialRole = "reviewer"
}: {
  children: React.ReactNode;
  initialRole?: RoleId;
}) {
  const [activeRole, setActiveRole] = useState<RoleId>(initialRole);
  const value = useMemo(() => ({ activeRole, setActiveRole }), [activeRole]);

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
