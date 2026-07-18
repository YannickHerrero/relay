"use client";

import { AlertTriangle, Check, ExternalLink, Play, RefreshCw, Rocket, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Recipe = {
  id: string;
  label: string;
  description?: string | undefined;
  kind: "command" | "git_push";
  commands: string[];
  environment: string;
};
type Deployment = {
  id: string;
  recipeId: string;
  status: string;
  commitSha: string;
  resultUrl: string | null;
  diagnosis: string | null;
};
type Step = { id: string; deploymentId: string; order: number; label: string; status: string };
type PreparedAction = {
  confirmationId: string;
  expiresAt: string;
  action: { label: string; environment: string; commitSha: string; commands: string[] };
};

export function DeploymentActions({
  taskId,
  stage,
  recipes,
  deployments,
  steps,
}: {
  taskId: string;
  stage: string;
  recipes: Recipe[];
  deployments: Deployment[];
  steps: Step[];
}) {
  const router = useRouter();
  const [prepared, setPrepared] = useState<PreparedAction>();
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();

  async function prepare(recipeId: string) {
    setPending(recipeId);
    setError(undefined);
    const response = await fetch(`/api/tasks/${taskId}/deployments/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipeId }),
    });
    const result = (await response.json()) as PreparedAction & { error?: string };
    setPending(undefined);
    if (!response.ok) {
      setError(result.error ?? "Unable to prepare deployment");
      return;
    }
    setPrepared(result);
  }

  async function run() {
    if (!prepared) return;
    setPending("run");
    setError(undefined);
    const response = await fetch(`/api/tasks/${taskId}/deployments/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmationId: prepared.confirmationId }),
    });
    const result = (await response.json()) as { error?: string };
    setPending(undefined);
    if (!response.ok) {
      setError(result.error ?? "Unable to start deployment");
      return;
    }
    setPrepared(undefined);
    router.refresh();
  }

  async function deploymentAction(
    deploymentId: string,
    action: "retry" | "cancel" | "return_to_implementation",
  ) {
    if (
      action === "retry" &&
      !window.confirm("Retry this sensitive deployment recipe against the same SHA?")
    )
      return;
    setPending(action);
    setError(undefined);
    const endpoint =
      action === "retry"
        ? `/api/tasks/${taskId}/deployments/${deploymentId}/retry`
        : `/api/tasks/${taskId}/deployments/${deploymentId}/resolve`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action === "retry" ? {} : { action }),
    });
    const result = (await response.json()) as { error?: string };
    setPending(undefined);
    if (!response.ok) {
      setError(result.error ?? "Deployment action failed");
      return;
    }
    router.refresh();
  }

  return (
    <div className="relay-deploy-actions">
      {stage === "ready_to_deploy" ? (
        <div className="relay-recipe-cards">
          {recipes.map((recipe) => (
            <article className="surface" key={recipe.id}>
              <div>
                <Rocket size={15} />
                <span className="mono">{recipe.environment}</span>
              </div>
              <h3>{recipe.label}</h3>
              <p>
                {recipe.description ??
                  (recipe.kind === "git_push"
                    ? "Push the reviewed task branch to its configured origin."
                    : `${recipe.commands.length} configured command${recipe.commands.length === 1 ? "" : "s"}.`)}
              </p>
              <button
                className="button button-accent"
                onClick={() => prepare(recipe.id)}
                disabled={!!pending}
              >
                {pending === recipe.id ? "Validating…" : "Review and deploy…"}
              </button>
            </article>
          ))}
          {!recipes.length ? (
            <div className="relay-empty-recipe">
              <AlertTriangle size={18} />
              <p>No deployment recipe is configured for this project.</p>
            </div>
          ) : null}
        </div>
      ) : null}
      {deployments.map((deployment) => (
        <article className="relay-deployment-run surface" key={deployment.id}>
          <header>
            <span
              className={`relay-runtime runtime-${deployment.status === "failed" ? "failed" : deployment.status === "running" ? "agent_running" : "idle"}`}
            >
              <i />
              {deployment.status}
            </span>
            <code>{deployment.commitSha.slice(0, 10)}</code>
          </header>
          <h3>{deployment.recipeId}</h3>
          <div className="relay-deployment-steps">
            {steps
              .filter((step) => step.deploymentId === deployment.id)
              .sort((a, b) => a.order - b.order)
              .map((step) => (
                <div key={step.id}>
                  <i className={`step-${step.status}`}>
                    {step.status === "succeeded" ? <Check size={10} /> : null}
                  </i>
                  <span>{step.label}</span>
                  <small>{step.status}</small>
                </div>
              ))}
          </div>
          {deployment.diagnosis ? (
            <div className="relay-deployment-diagnosis">
              <strong>Likely cause</strong>
              <p>{deployment.diagnosis}</p>
            </div>
          ) : null}
          <footer>
            {deployment.resultUrl ? (
              <a className="button" href={deployment.resultUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={12} /> Open result
              </a>
            ) : null}
            {deployment.status === "failed" ? (
              <>
                <button className="button" onClick={() => deploymentAction(deployment.id, "retry")}>
                  <RefreshCw size={12} /> Retry
                </button>
                <button
                  className="button"
                  onClick={() => deploymentAction(deployment.id, "return_to_implementation")}
                >
                  Apply a fix
                </button>
                <button
                  className="button"
                  onClick={() => deploymentAction(deployment.id, "cancel")}
                >
                  Cancel
                </button>
              </>
            ) : null}
          </footer>
        </article>
      ))}
      {error ? (
        <p className="relay-deploy-error" role="alert">
          {error}
        </p>
      ) : null}
      {prepared ? (
        <div
          className="relay-inline-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deploy-confirm-title"
        >
          <div className="relay-confirm-card">
            <header>
              <div>
                <p className="kicker">Protected action</p>
                <h2 id="deploy-confirm-title">Confirm {prepared.action.label}</h2>
              </div>
              <button onClick={() => setPrepared(undefined)} aria-label="Close">
                <X size={16} />
              </button>
            </header>
            <dl>
              <div>
                <dt>Environment</dt>
                <dd>{prepared.action.environment}</dd>
              </div>
              <div>
                <dt>Exact SHA</dt>
                <dd>
                  <code>{prepared.action.commitSha}</code>
                </dd>
              </div>
              <div>
                <dt>Expires</dt>
                <dd>{new Date(prepared.expiresAt).toLocaleTimeString()}</dd>
              </div>
            </dl>
            <div className="relay-confirm-commands">
              {prepared.action.commands.map((command) => (
                <code key={command}>{command}</code>
              ))}
            </div>
            <p>
              <AlertTriangle size={13} /> Relay will execute this only after the button below is
              clicked.
            </p>
            <div className="relay-form-actions">
              <button className="button" onClick={() => setPrepared(undefined)}>
                Cancel
              </button>
              <button className="button button-accent" onClick={run} disabled={pending === "run"}>
                <Play size={12} /> {pending === "run" ? "Starting…" : "Confirm and run"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
