import { db } from "./db";
import {
  approval,
  executionPolicy,
  agentRun,
  agentSession,
} from "../schema/index";
import { and, eq, sql } from "drizzle-orm";
import { tokenDigest } from "./security";

export async function evaluateAction(
  organizationId: string,
  tool: string,
  args: Record<string, unknown>,
  sandboxId: string,
  runId?: string,
  options: { userApproved?: boolean } = {},
) {
  return db.transaction(async (tx) => {
    const [policy] = await tx
      .select()
      .from(executionPolicy)
      .where(eq(executionPolicy.organizationId, organizationId))
      .limit(1);
    if (!policy || !policy.allowedTools.includes(tool))
      return { allowed: false, reason: "TOOL_PERMISSION_DENIED" };
    if (
      tool === "execute_command" &&
      policy.allowedCommands.length &&
      !policy.allowedCommands.includes(String(args.command))
    )
      return { allowed: false, reason: "COMMAND_NOT_ALLOWED" };
    // Resolve the setting from the run's own organization-scoped session.
    // It skips consent only; the policy restrictions above still apply.
    let autoApprove = false;
    if (runId) {
      const [session] = await tx
        .select({ approvalType: agentSession.approvalType })
        .from(agentRun)
        .innerJoin(
          agentSession,
          and(
            eq(agentSession.id, agentRun.sessionId),
            eq(agentSession.organizationId, organizationId),
          ),
        )
        .where(
          and(
            eq(agentRun.id, runId),
            eq(agentRun.sandboxId, sandboxId),
            eq(agentRun.organizationId, organizationId),
          ),
        )
        .limit(1);
      autoApprove = session?.approvalType === "APPROVE_FOR_ME";
    }
    if (
      autoApprove ||
      options.userApproved ||
      !policy.requireApproval.includes(tool)
    )
      return { allowed: true };
    const action = { tool, args, sandboxId, runId: runId ?? null };
    const actionHash = tokenDigest(JSON.stringify(action));
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${organizationId + actionHash}))`,
    );
    const [record] = await tx
      .select()
      .from(approval)
      .where(
        and(
          eq(approval.organizationId, organizationId),
          eq(approval.actionHash, actionHash),
          sql`${approval.expiresAt} > now()`,
          sql`${approval.status} in ('APPROVED','PENDING','REJECTED')`,
        ),
      )
      .limit(1);
    if (record?.status === "APPROVED") {
      await tx
        .update(approval)
        .set({ status: "USED" })
        .where(eq(approval.id, record.id));
      return { allowed: true };
    }
    if (record?.status === "REJECTED")
      return { allowed: false, reason: "ACTION_REJECTED" };
    if (record)
      return {
        allowed: false,
        reason: "APPROVAL_REQUIRED",
        approvalId: record.id,
      };
    const [created] = await tx
      .insert(approval)
      .values({
        organizationId,
        runId,
        actionHash,
        action,
        expiresAt: new Date(Date.now() + 3600000),
      })
      .returning();
    return {
      allowed: false,
      reason: "APPROVAL_REQUIRED",
      approvalId: created!.id,
    };
  });
}
