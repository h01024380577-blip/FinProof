"use client";

import { useState } from "react";
import { roles } from "@/domain/reviews";
import type { RoleId } from "@/domain/types";
import { useRoleContext } from "./RoleContext";

export function RoleSwitcher() {
  const context = useRoleContext();
  const [fallbackRole, setFallbackRole] = useState<RoleId>("reviewer");
  const activeRole = context?.activeRole ?? fallbackRole;
  const setActiveRole = context?.setActiveRole ?? setFallbackRole;
  const authToken = context?.authToken ?? "";
  const setAuthToken = context?.setAuthToken;
  const role = roles.find((item) => item.id === activeRole) ?? roles[0];

  return (
    <div className="role-switcher" aria-label="Mock user role">
      <p className="role-switcher__status">
        <span className="role-chip">현재 역할: {role.label}</span>
      </p>
      <div className="role-switcher__buttons">
        {roles.map((item) => (
          <button
            key={item.id}
            type="button"
            className="role-switcher__button"
            aria-pressed={activeRole === item.id}
            title={item.description}
            onClick={() => setActiveRole(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {setAuthToken ? (
        <label className="role-switcher__token">
          <span>JWT</span>
          <input
            aria-label="Bearer JWT"
            type="password"
            value={authToken}
            placeholder="Bearer token"
            onChange={(event) => setAuthToken(event.target.value)}
          />
        </label>
      ) : null}
    </div>
  );
}
