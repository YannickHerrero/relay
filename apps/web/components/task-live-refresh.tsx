"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function TaskLiveRefresh({
  taskId,
  afterTask,
  afterAgent,
}: {
  taskId: string;
  afterTask: number;
  afterAgent: number;
}) {
  const router = useRouter();
  useEffect(() => {
    const events = new EventSource(
      `/api/tasks/${taskId}/events?afterTask=${afterTask}&afterAgent=${afterAgent}`,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 150);
    };
    events.addEventListener("task", refresh);
    events.addEventListener("agent", refresh);
    return () => {
      clearTimeout(timer);
      events.close();
    };
  }, [afterAgent, afterTask, router, taskId]);
  return null;
}
