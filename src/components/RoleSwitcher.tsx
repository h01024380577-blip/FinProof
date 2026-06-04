"use client";

import { useState, type FormEvent } from "react";
import { roles } from "@/domain/reviews";
import type { RoleId } from "@/domain/types";
import { useRoleContext, type RoleContextValue } from "./RoleContext";

type DemoLoginRole = Extract<RoleId, "requester" | "reviewer">;

const fallbackRoleLabels: Record<RoleId, string> = {
  requester: "요청자",
  reviewer: "심의자",
  compliance_admin: "관리자"
};

const loginRoleOptions = roles.filter(
  (role): role is { id: DemoLoginRole; label: string; description: string } =>
    role.id === "requester" || role.id === "reviewer"
);

function getRoleLabel(role: RoleId) {
  return roles.find((item) => item.id === role)?.label ?? fallbackRoleLabels[role];
}

export function RoleSwitcher() {
  const context = useRoleContext();

  if (!context) {
    return (
      <div className="role-switcher" aria-label="Demo user session">
        <button className="role-switcher__button" type="button">
          로그인
        </button>
      </div>
    );
  }

  return <RoleSessionControl context={context} />;
}

function RoleSessionControl({ context }: { context: RoleContextValue }) {
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [loginRole, setLoginRole] = useState<DemoLoginRole>("requester");
  const [name, setName] = useState("");
  const [securityCode, setSecurityCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const currentUser = context.currentUser;

  function openLogin() {
    setIsLoginOpen(true);
    setFormError(null);
  }

  function closeLogin() {
    setIsLoginOpen(false);
    setName("");
    setSecurityCode("");
    setFormError(null);
    setLoginRole("requester");
  }

  function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = name.trim();

    if (!trimmedName) {
      setFormError("이름을 입력해 주세요.");
      return;
    }

    if (loginRole === "reviewer" && securityCode.trim().length === 0) {
      setFormError("심의자 보안코드를 입력해 주세요.");
      return;
    }

    if (loginRole === "reviewer" && securityCode.trim() !== "admin") {
      setFormError("심의자 보안코드를 확인해 주세요.");
      return;
    }

    context.login({ name: trimmedName, role: loginRole });
    closeLogin();
  }

  function logout() {
    context.logout();
    setIsProfileOpen(false);
  }

  if (currentUser) {
    const roleLabel = getRoleLabel(currentUser.role);

    return (
      <div className="role-switcher" aria-label="Demo user session">
        <button
          className="role-switcher__button"
          type="button"
          aria-haspopup="menu"
          aria-expanded={isProfileOpen}
          onClick={() => setIsProfileOpen((isOpen) => !isOpen)}
        >
          {currentUser.name} {roleLabel}
        </button>
        {isProfileOpen ? (
          <div className="role-switcher__security" role="menu" aria-label="프로필">
            <div role="none">
              <strong>{currentUser.name}</strong>
              <span>{roleLabel}</span>
            </div>
            <button
              className="role-switcher__security-submit"
              type="button"
              role="menuitem"
              onClick={logout}
            >
              로그아웃
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="role-switcher" aria-label="Demo user session">
      <button className="role-switcher__button" type="button" onClick={openLogin}>
        로그인
      </button>
      {isLoginOpen ? (
        <form
          className="role-switcher__security"
          role="dialog"
          aria-label="데모 로그인"
          onSubmit={submitLogin}
        >
          <fieldset>
            <legend>역할</legend>
            {loginRoleOptions.map((role) => (
              <label key={role.id}>
                <input
                  type="radio"
                  name="demo-role"
                  value={role.id}
                  checked={loginRole === role.id}
                  onChange={() => {
                    setLoginRole(role.id);
                    setSecurityCode("");
                    setFormError(null);
                  }}
                />
                <span>{role.label}</span>
              </label>
            ))}
          </fieldset>
          <label>
            <span>이름</span>
            <input
              aria-label="이름"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setFormError(null);
              }}
            />
          </label>
          {loginRole === "reviewer" ? (
            <label>
              <span>심의자 보안코드</span>
              <input
                aria-label="심의자 보안코드"
                type="password"
                autoComplete="off"
                value={securityCode}
                onChange={(event) => {
                  setSecurityCode(event.target.value);
                  setFormError(null);
                }}
              />
            </label>
          ) : null}
          {formError ? (
            <span className="role-switcher__security-error" role="alert">
              {formError}
            </span>
          ) : null}
          <button className="role-switcher__security-submit" type="submit">
            시작하기
          </button>
          <button className="role-switcher__button" type="button" onClick={closeLogin}>
            취소
          </button>
        </form>
      ) : null}
    </div>
  );
}
