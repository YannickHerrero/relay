"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function TaskLiveRefresh({ taskId, after }: { taskId: string; after: number }) {
  const router = useRouter();
  useEffect(() => {
    const events = new EventSource(`/api/tasks/${taskId}/events?after=${after}`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    events.addEventListener("task", () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 150);
    });
    return () => {
      clearTimeout(timer);
      events.close();
    };
  }, [after, router, taskId]);
  return null;
}
