import { ProjectForm } from "@/components/project-form";
import { projectRootDirectory } from "@/server/project-directory";

export const dynamic = "force-dynamic";

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const errorCode = (await searchParams).error;
  const initialError = errorCode === "create-failed" ? "Unable to create the project." : undefined;
  return <ProjectForm projectsRoot={await projectRootDirectory()} initialError={initialError} />;
}
