"use client";

import { Search, X } from "lucide-react";

export type FilterOption = { value: string; label: string };

export type FilterGroup = {
  key: string;
  label: string;
  value: string;
  defaultValue?: string;
  options: FilterOption[];
};

export type FilterBarProps = {
  searchValue: string;
  searchPlaceholder: string;
  onSearchChange: (value: string) => void;
  groups: FilterGroup[];
  onGroupChange: (key: string, value: string) => void;
  onReset?: () => void;
};

export function FilterBar({
  searchValue,
  searchPlaceholder,
  onSearchChange,
  groups,
  onGroupChange,
  onReset
}: FilterBarProps): JSX.Element {
  const hasActiveFilter =
    searchValue.length > 0 ||
    groups.some((group) => (group.defaultValue ?? group.options[0]?.value) !== group.value);

  return (
    <div className="filter-bar">
      <label className="filter-bar__search">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">검색</span>
        <input
          aria-label="검색"
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>
      <div className="filter-bar__groups">
        {groups.map((group) => (
          <label key={group.key} className="filter-bar__group">
            <span className="sr-only">{group.label}</span>
            <select
              aria-label={group.label}
              value={group.value}
              onChange={(event) => onGroupChange(group.key, event.target.value)}
            >
              {group.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        {hasActiveFilter && onReset ? (
          <button
            type="button"
            className="filter-bar__reset"
            aria-label="필터 초기화"
            onClick={onReset}
          >
            <X size={14} aria-hidden="true" />
            초기화
          </button>
        ) : null}
      </div>
    </div>
  );
}
