import { agentEvents, taskEvents } from "@relay/db";
import { and, asc, eq, gt } from "drizzle-orm";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const { taskId } = await context.params;
  const encoder = new TextEncoder();
  const url = new URL(request.url);
  let afterTask = Number.parseInt(url.searchParams.get("afterTask") ?? "0", 10) || 0;
  let afterAgent = Number.parseInt(url.searchParams.get("afterAgent") ?? "0", 10) || 0;
  let timer: NodeJS.Timeout | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = () => {
        const taskRows = database()
          .db.select()
          .from(taskEvents)
          .where(and(eq(taskEvents.taskId, taskId), gt(taskEvents.id, afterTask)))
          .orderBy(asc(taskEvents.id))
          .all();
        for (const event of taskRows) {
          afterTask = event.id;
          controller.enqueue(encoder.encode(`event: task\ndata: ${JSON.stringify(event)}\n\n`));
        }
        const agentRows = database()
          .db.select()
          .from(agentEvents)
          .where(and(eq(agentEvents.taskId, taskId), gt(agentEvents.id, afterAgent)))
          .orderBy(asc(agentEvents.id))
          .all();
        for (const event of agentRows) {
          afterAgent = event.id;
          controller.enqueue(encoder.encode(`event: agent\ndata: ${JSON.stringify(event)}\n\n`));
        }
        controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
      };
      send();
      timer = setInterval(send, 750);
      request.signal.addEventListener(
        "abort",
        () => {
          if (timer) clearInterval(timer);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        },
        { once: true },
      );
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
