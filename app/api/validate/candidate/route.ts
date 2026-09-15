import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth/server-auth";
import { commitVerifiedCandidate } from "@/lib/validation/candidate-commit-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateRequest(req);
    if (authResult.error || !authResult.user) {
      return NextResponse.json(
        { success: false, error: authResult.error || "Authentication required. Please sign in to commit candidates." },
        { status: authResult.status || 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const {
      projectId,
      expectedRevision,
      candidateFiles,
      candidateHash,
      validationEvidence,
    } = body;

    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json(
        { success: false, error: "Validation Error: 'projectId' parameter is required." },
        { status: 400 }
      );
    }

    if (typeof expectedRevision !== "number") {
      return NextResponse.json(
        { success: false, error: "Validation Error: 'expectedRevision' must be an integer." },
        { status: 400 }
      );
    }

    if (!candidateFiles || typeof candidateFiles !== "object") {
      return NextResponse.json(
        { success: false, error: "Validation Error: 'candidateFiles' object is required." },
        { status: 400 }
      );
    }

    if (!candidateHash || typeof candidateHash !== "string") {
      return NextResponse.json(
        { success: false, error: "Validation Error: 'candidateHash' string is required." },
        { status: 400 }
      );
    }

    if (!validationEvidence || typeof validationEvidence !== "object") {
      return NextResponse.json(
        { success: false, error: "Validation Error: 'validationEvidence' object is required." },
        { status: 400 }
      );
    }

    const commitResult = await commitVerifiedCandidate({
      projectId,
      expectedRevision,
      candidateFiles,
      candidateHash,
      validationEvidence,
      userId: authResult.user.id,
      authMode: authResult.user.authMode,
    });

    if (!commitResult.success) {
      const status = commitResult.conflict ? 409 : 400;
      return NextResponse.json(commitResult, { status });
    }

    return NextResponse.json(commitResult, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
