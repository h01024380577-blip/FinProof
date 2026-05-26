"use client";

import { useState, type JSX, type ReactNode } from "react";

export type TabItem = { key: string; label: ReactNode; panel: ReactNode; disabled?: boolean };

export type TabsProps = {
  items: TabItem[];
  activeKey?: string;
  defaultActiveKey?: string;
  onChange?: (key: string) => void;
  ariaLabel?: string;
};

export function Tabs({
  items,
  activeKey,
  defaultActiveKey,
  onChange,
  ariaLabel = "탭"
}: TabsProps): JSX.Element {
  const [internalKey, setInternalKey] = useState(defaultActiveKey ?? items[0]?.key);
  const currentKey = activeKey ?? internalKey;
  const activePanel = items.find((item) => item.key === currentKey)?.panel ?? null;

  function selectTab(key: string): void {
    if (activeKey === undefined) {
      setInternalKey(key);
    }
    onChange?.(key);
  }

  return (
    <div className="tabs">
      <div className="tabs__list" role="tablist" aria-label={ariaLabel}>
        {items.map((item) => {
          const isActive = item.key === currentKey;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${item.key}`}
              id={`tab-${item.key}`}
              className="tabs__tab"
              data-active={isActive}
              disabled={item.disabled}
              onClick={() => selectTab(item.key)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div
        className="tabs__panel"
        role="tabpanel"
        id={`tabpanel-${currentKey}`}
        aria-labelledby={`tab-${currentKey}`}
      >
        {activePanel}
      </div>
    </div>
  );
}
