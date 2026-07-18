import { taskEvents } from "@relay/db";
import { and, asc, eq, gt } from "drizzle-orm";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const { taskId } = await context.params;
  const encoder = new TextEncoder();
  let after = Number.parseInt(new URL(request.url).searchParams.get("after") ?? "0", 10) || 0;
  let timer: NodeJS.Timeout | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = () => {
        const events = database()
          .db.select()
          .from(taskEvents)
          .where(and(eq(taskEvents.taskId, taskId), gt(taskEvents.id, after)))
          .orderBy(asc(taskEvents.id))
          .all();
        for (const event of events) {
          after = event.id;
          controller.enqueue(
            encoder.encode(`id: ${event.id}\nevent: task\ndata: ${JSON.stringify(event)}\n\n`),
          );
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
