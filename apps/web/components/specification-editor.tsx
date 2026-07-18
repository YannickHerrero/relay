"use client";

import { Check, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SpecificationEditor({
  taskId,
  content,
  editable,
}: {
  taskId: string;
  content: unknown;
  editable: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(JSON.stringify(content, null, 2));
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  async function save() {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/tasks/${taskId}/specification`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(JSON.parse(value)),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to save specification");
      setEditing(false);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Invalid JSON");
    } finally {
      setPending(false);
    }
  }
  if (!editing)
    return editable ? (
      <button className="button" onClick={() => setEditing(true)}>
        <Pencil size={12} /> Edit structured draft
      </button>
    ) : null;
  return (
    <div className="relay-json-editor">
      <textarea
        className="field mono"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={24}
        spellCheck={false}
      />
      {error ? <p role="alert">{error}</p> : null}
      <div>
        <button className="button" onClick={() => setEditing(false)}>
          <X size={12} /> Cancel
        </button>
        <button className="button button-primary" onClick={save} disabled={pending}>
          <Check size={12} /> {pending ? "Saving…" : "Save draft"}
        </button>
      </div>
    </div>
  );
}
