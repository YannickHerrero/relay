"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function RefreshConfigButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function refresh() {
    setPending(true);
    await fetch(`/api/projects/${projectId}/refresh`, { method: "POST" });
    setPending(false);
    router.refresh();
  }
  return (
    <button className="button" onClick={refresh} disabled={pending}>
      <RefreshCw size={13} /> {pending ? "Refreshing…" : "Refresh config"}
    </button>
  );
}
