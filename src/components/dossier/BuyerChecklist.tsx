"use client";
import { useState } from "react";
import type { ReportFinding } from "@/types/domain";

export function BuyerChecklist({ items, label }: { items: ReportFinding[]; label: string }) {
  const [completed, setCompleted] = useState<string[]>([]);
  return <div className="buyer-checklist">
    <div className="checklist-register"><span>{label}</span><span role="status">{completed.length} / {items.length} marked done</span></div>
    <p className="fine-print">Your checklist marks are for this visit to the page. Completing a task does not verify vehicle condition.</p>
    {items.map((item, index) => <div className={`checklist-task ${completed.includes(item.title) ? "completed" : ""}`} key={item.title}>
      <label className="task-check"><input type="checkbox" checked={completed.includes(item.title)} onChange={event => setCompleted(current => event.target.checked ? [...current, item.title] : current.filter(title => title !== item.title))} /><span className="sr-only">Mark {item.title} done</span></label>
      <details><summary><span className="task-number">{String(index + 1).padStart(2, "0")}</span><h3>{item.title}</h3></summary><p>{item.detail}</p></details>
    </div>)}
  </div>;
}
