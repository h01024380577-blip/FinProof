"use client";

import { useState, type JSX, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Tabs } from "@/components/ui";

export type WorkbenchDrawerProps = {
  chatNode: ReactNode;
  draftNode: ReactNode;
  filesNode: ReactNode;
  defaultCollapsed?: boolean;
  expanded?: boolean;
};

export function WorkbenchDrawer({
  chatNode,
  draftNode,
  filesNode,
  defaultCollapsed = false,
  expanded = false
}: WorkbenchDrawerProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <section
      className="workbench-drawer"
      data-size={expanded ? "expanded" : "default"}
      aria-label="Workbench bottom drawer"
    >
      <div className="workbench-drawer__head">
        <button
          type="button"
          className="icon-button"
          aria-label={collapsed ? "드로어 펼치기" : "드로어 접기"}
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? (
            <ChevronUp size={16} aria-hidden="true" />
          ) : (
            <ChevronDown size={16} aria-hidden="true" />
          )}
        </button>
      </div>
      {!collapsed ? (
        <Tabs
          ariaLabel="Workbench drawer tabs"
          items={[
            { key: "chat", label: "근거 채팅", panel: chatNode },
            { key: "draft", label: "의견 초안", panel: draftNode },
            { key: "files", label: "파일", panel: filesNode }
          ]}
        />
      ) : null}
    </section>
  );
}
