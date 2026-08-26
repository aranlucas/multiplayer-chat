import type { ReactNode } from "react";

export type MobileTab = "transcript" | "people" | "queue";

interface MobileTabsProps {
  active: MobileTab;
  participants: number;
  queued: number;
  onChange: (tab: MobileTab) => void;
}

export function MobileTabs({ active, participants, queued, onChange }: MobileTabsProps) {
  const tabs: Array<{ id: MobileTab; label: string; count?: ReactNode }> = [
    { id: "transcript", label: "Transcript" },
    { id: "people", label: "People", count: participants },
    { id: "queue", label: "Queue", count: queued },
  ];
  return (
    <nav className="mobile-tabs" aria-label="Session sections">
      {tabs.map((tab) => (
        <button className={active === tab.id ? "is-active" : ""} key={tab.id} type="button" onClick={() => onChange(tab.id)}>
          {tab.label} {tab.count !== undefined ? <span>{tab.count}</span> : null}
        </button>
      ))}
    </nav>
  );
}
