import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/server-auth';
import { verifyProjectOwnership } from '@/lib/storage/project-authority';
import { VercelSandboxRunner } from '@/lib/build/build-runner';
import { NativeBuildRecord, VerificationLevel } from '@/lib/validation/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateRequest(req, { allowDemo: true });
    if (authResult.error || !authResult.user) {
      return NextResponse.json(
        { success: false, error: authResult.error || 'Unauthorized' },
        { status: authResult.status || 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { projectId, framework = 'nextjs', files = {}, mandatory = false } = body;

    if (!projectId || typeof projectId !== 'string') {
      return NextResponse.json(
        { success: false, error: "Validation Error: 'projectId' parameter is required." },
        { status: 400 }
      );
    }

    // Project Ownership Check (SEC-304)
    const ownership = await verifyProjectOwnership(
      projectId,
      authResult.user.id,
      authResult.user.authMode
    );
    if (!ownership.authorized) {
      return NextResponse.json(
        { success: false, error: ownership.error },
        { status: ownership.status }
      );
    }

    // Security Invariant (SEC-400 / GEN-401): Native build verification MUST use isolated container
    const hasVercelSandbox = Boolean(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID);

    if (!hasVercelSandbox) {
      const record: NativeBuildRecord = {
        attempted: false,
        status: 'unavailable',
        framework,
        runner: 'VercelSandboxRunner',
        environment: 'none',
      };

      if (mandatory) {
        return NextResponse.json(
          {
            success: false,
            error: 'Native build verification failed closed: isolated sandbox credentials not configured.',
            verificationLevel: 'VERIFICATION_UNAVAILABLE' as VerificationLevel,
            nativeBuild: record,
          },
          { status: 503 }
        );
      }

      return NextResponse.json({
        success: true,
        verificationLevel: 'VERIFICATION_UNAVAILABLE' as VerificationLevel,
        note: 'Isolated sandbox environment unavailable. Project verified via virtual simulation only.',
        nativeBuild: record,
      });
    }

    // Execute real native build in Vercel Sandbox microVM
    const startTime = Date.now();
    const runner = new VercelSandboxRunner();

    try {
      await runner.prepare(files);
      const installRes = await runner.install(120_000);

      if (!installRes.success) {
        const record: NativeBuildRecord = {
          attempted: true,
          status: 'failed',
          framework,
          runner: runner.name,
          environment: 'vercel_sandbox',
          exitCode: installRes.exitCode,
          durationMs: Date.now() - startTime,
          stdoutSummary: installRes.stdout.slice(0, 1000),
          stderrSummary: installRes.stderr.slice(0, 1000),
        };
        await runner.cleanup().catch(() => {});
        return NextResponse.json({
          success: false,
          error: `Native dependency installation failed: ${installRes.stderr || installRes.stdout}`,
          verificationLevel: 'REJECTED' as VerificationLevel,
          nativeBuild: record,
        });
      }

      const buildRes = await runner.build(180_000);
      const durationMs = Date.now() - startTime;
      await runner.cleanup().catch(() => {});

      if (!buildRes.success) {
        const record: NativeBuildRecord = {
          attempted: true,
          status: 'failed',
          framework,
          runner: runner.name,
          environment: 'vercel_sandbox',
          command: buildRes.command,
          exitCode: buildRes.exitCode,
          durationMs,
          stdoutSummary: buildRes.stdout.slice(0, 1000),
          stderrSummary: buildRes.stderr.slice(0, 1000),
        };
        return NextResponse.json({
          success: false,
          error: `Native ${framework} build failed: ${buildRes.stderr || buildRes.stdout}`,
          verificationLevel: 'REJECTED' as VerificationLevel,
          nativeBuild: record,
        });
      }

      const record: NativeBuildRecord = {
        attempted: true,
        status: 'passed',
        framework,
        runner: runner.name,
        environment: 'vercel_sandbox',
        command: buildRes.command,
        exitCode: 0,
        durationMs,
        stdoutSummary: buildRes.stdout.slice(0, 1000),
        smokeTestPassed: true,
      };

      return NextResponse.json({
        success: true,
        verificationLevel: 'NATIVE_BUILD_VERIFIED' as VerificationLevel,
        nativeBuild: record,
      });
    } catch (runnerErr: any) {
      await runner.cleanup().catch(() => {});
      return NextResponse.json({
        success: false,
        error: runnerErr.message || 'Sandbox execution error',
        verificationLevel: 'REJECTED' as VerificationLevel,
      });
    }
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Server error' },
      { status: 500 }
    );
  }
}
