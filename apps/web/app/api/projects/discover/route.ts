import { projects } from "@relay/db";
import { NextResponse } from "next/server";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";
import { scanProjectDirectories } from "@/server/project-directory";

export async function GET() {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const registeredPaths = new Map(
    database()
      .db.select({ id: projects.id, repositoryPath: projects.repositoryPath })
      .from(projects)
      .all()
      .map((project) => [project.repositoryPath, project.id]),
  );
  return NextResponse.json(await scanProjectDirectories(registeredPaths));
}
