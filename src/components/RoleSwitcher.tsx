"use client";

import { useState, type FormEvent } from "react";
import { roles } from "@/domain/reviews";
import type { RoleId } from "@/domain/types";
import { useRoleContext } from "./RoleContext";

const reviewerSecurityCode = "FP-REVIEW-2026";

export function RoleSwitcher() {
  const context = useRoleContext();
  const [fallbackRole, setFallbackRole] = useState<RoleId>("reviewer");
  const [securityCode, setSecurityCode] = useState("");
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [isReviewerGateOpen, setIsReviewerGateOpen] = useState(false);
  const activeRole = context?.activeRole ?? fallbackRole;
  const setActiveRole = context?.setActiveRole ?? setFallbackRole;
  const role = roles.find((item) => item.id === activeRole) ?? roles[0];

  function selectRole(nextRole: RoleId) {
    if (nextRole === "reviewer" && activeRole !== "reviewer") {
      setSecurityCode("");
      setSecurityError(null);
      setIsReviewerGateOpen(true);
      return;
    }

    setIsReviewerGateOpen(false);
    setSecurityError(null);
    setActiveRole(nextRole);
  }

  function submitSecurityCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (securityCode.trim() !== reviewerSecurityCode) {
      setSecurityError("보안코드가 일치하지 않습니다.");
      return;
    }

    setActiveRole("reviewer");
    setIsReviewerGateOpen(false);
    setSecurityCode("");
    setSecurityError(null);
  }

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
            onClick={() => selectRole(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {isReviewerGateOpen ? (
        <form className="role-switcher__security" onSubmit={submitSecurityCode}>
          <label>
            <span>심의자 보안코드</span>
            <input
              aria-label="심의자 보안코드"
              type="password"
              autoComplete="off"
              value={securityCode}
              onChange={(event) => {
                setSecurityCode(event.target.value);
                setSecurityError(null);
              }}
            />
          </label>
          <small>예시 보안코드: {reviewerSecurityCode}</small>
          {securityError ? (
            <span className="role-switcher__security-error" role="alert">
              {securityError}
            </span>
          ) : null}
          <button className="role-switcher__security-submit" type="submit">
            확인
          </button>
        </form>
      ) : null}
    </div>
  );
}
