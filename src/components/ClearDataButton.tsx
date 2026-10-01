"use client";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { clearLocalData } from "@/lib/localStorage";
export function ClearDataButton() {
  const [status, setStatus] = useState("");
  return (
    <div>
      <button
        className="button button-secondary"
        onClick={() => {
          if (
            window.confirm(
              "Delete all saved AutoCheck QC listings, reports, requests and messages from this browser?",
            )
          )
            setStatus(
              clearLocalData()
                ? "Saved AutoCheck QC data has been deleted from this browser."
                : "Unable to clear browser data. Use your browser's site-data settings.",
            );
        }}
      >
        <Trash2 size={18} />
        Delete Saved Data
      </button>
      <p role="status">{status}</p>
    </div>
  );
}
