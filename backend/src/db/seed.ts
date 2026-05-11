#!/usr/bin/env bun
/**
 * Dev seed. Idempotent — bails if admin@bnr.local exists.
 * Re-seed: `compose down -v` then bring the stack back up.
 *
 * Users + credential accounts are created through better-auth so the
 * password hashing path is identical to what the live login uses.
 * Domain rows (roles, applications, audit) go in afterwards in one tx.
 *
 * NOT for staging or production.
 */

import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import { auth } from "../auth/index.ts";
import { env } from "../env.ts";
import { logger } from "../logger.ts";
import * as schema from "./schema.ts";
import { recordAuditEvent } from "./audit-hash.ts";

const log = logger.child({ component: "seed" });

const DEV_PASSWORD = "bnr-dev-pass";

const ownerUrl = env.DATABASE_OWNER_URL;
if (!ownerUrl) {
  throw new Error("DATABASE_OWNER_URL is required to run the seed.");
}

const client = postgres(ownerUrl, { max: 1 });
const db = drizzle(client, { schema });

type Role = "admin" | "applicant" | "reviewer" | "approver";

async function signUp(email: string, name: string): Promise<string> {
  const res = await auth.api.signUpEmail({
    body: { email, password: DEV_PASSWORD, name },
    headers: new Headers(),
    asResponse: false,
  });
  // better-auth returns either { user, token } or a Response; with asResponse:false we get the object.
  const user = (res as { user: { id: string } }).user;
  return user.id;
}

async function main(): Promise<void> {
  // Idempotency probe before we hit better-auth (which would error on a re-seed).
  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, "admin@bnr.local"))
    .limit(1);

  if (existing) {
    log.info("admin@bnr.local already exists — skipping");
    return;
  }

  // Users via better-auth — same hashing path as live login. autoSignIn:false.
  const ids: Record<Role, string> = {
    admin: await signUp("admin@bnr.local", "Josh Admin"),
    applicant: await signUp("applicant@bnr.local", "Uwimana Applicant"),
    reviewer: await signUp("reviewer@bnr.local", "Jean Reviewer"),
    approver: await signUp("approver@bnr.local", "Kamali Approver"),
  };

  // Domain rows in one tx: a half-applied seed would be worse than none.
  await db.transaction(async (tx) => {
    // admin self-grants admin-role; granted_by NOT NULL otherwise needs a synthetic actor.
    // onConflictDoNothing: better-auth's `applicant` auto-grant hook fires on signUp
    // and already inserted (id, 'applicant', id) for each user.
    await tx
      .insert(schema.userRoles)
      .values([
        { userId: ids.admin, role: "admin", grantedBy: ids.admin },
        { userId: ids.applicant, role: "applicant", grantedBy: ids.admin },
        { userId: ids.reviewer, role: "reviewer", grantedBy: ids.admin },
        { userId: ids.approver, role: "approver", grantedBy: ids.admin },
      ])
      .onConflictDoNothing();

    // version = state-transition count: DRAFT=0, SUBMITTED=1, ..., terminal=4.
    const now = new Date();
    const apps = [
      {
        id: randomUUID(),
        applicantId: ids.applicant,
        institutionName: "Bank of Kigali Plc",
        institutionType: "commercial_bank",
        status: "DRAFT" as const,
        version: 0,
      },
      {
        id: randomUUID(),
        applicantId: ids.applicant,
        institutionName: "KCB Bank Rwanda Plc",
        institutionType: "commercial_bank",
        status: "SUBMITTED" as const,
        version: 1,
        submittedAt: now,
      },
      {
        id: randomUUID(),
        applicantId: ids.applicant,
        institutionName: "Urwego Bank Plc",
        institutionType: "microfinance_bank",
        status: "UNDER_REVIEW" as const,
        version: 2,
        submittedAt: now,
        reviewedBy: ids.reviewer,
      },
      {
        id: randomUUID(),
        applicantId: ids.applicant,
        institutionName: "AB Bank Rwanda Plc",
        institutionType: "commercial_bank",
        status: "RFI_REQUESTED" as const,
        version: 3,
        submittedAt: now,
        reviewedBy: ids.reviewer,
        reviewedAt: now,
      },
      {
        id: randomUUID(),
        applicantId: ids.applicant,
        institutionName: "MTN Mobile Money Rwanda Ltd",
        institutionType: "payment_service_provider",
        status: "READY_FOR_DECISION" as const,
        version: 3,
        submittedAt: now,
        reviewedBy: ids.reviewer,
        reviewedAt: now,
      },
      {
        id: randomUUID(),
        applicantId: ids.applicant,
        institutionName: "I&M Bank (Rwanda) Plc",
        institutionType: "commercial_bank",
        status: "APPROVED" as const,
        version: 4,
        submittedAt: now,
        reviewedBy: ids.reviewer,
        reviewedAt: now,
        decidedBy: ids.approver,
        decidedAt: now,
        decision: "APPROVED" as const,
        decisionReason: "Capital adequacy and governance evidence sufficient.",
      },
      {
        id: randomUUID(),
        applicantId: ids.applicant,
        institutionName: "Letshego Rwanda Plc",
        institutionType: "microfinance_bank",
        status: "REJECTED" as const,
        version: 4,
        submittedAt: now,
        reviewedBy: ids.reviewer,
        reviewedAt: now,
        decidedBy: ids.approver,
        decidedAt: now,
        decision: "REJECTED" as const,
        decisionReason: "Submitted capital adequacy ratios fall short of the regulatory minimum.",
      },
    ];

    await tx.insert(schema.applications).values(apps);

    for (const app of apps) {
      await recordAuditEvent(tx, {
        actorId: ids.admin,
        actorRole: "admin",
        action: "application.seeded",
        resourceType: "application",
        resourceId: app.id,
        afterState: {
          status: app.status,
          version: app.version,
          institution_name: app.institutionName,
        },
        metadata: { source: "seed" },
      });
    }

    // RFI flow: an 'applicant'-visibility note attached to the RFI app so the
    // seed exercises every domain table in one stack-up.
    const rfiApp = apps.find((a) => a.status === "RFI_REQUESTED");
    let reviewNoteCount = 0;
    if (rfiApp) {
      const noteId = randomUUID();
      await tx.insert(schema.reviewNotes).values({
        id: noteId,
        applicationId: rfiApp.id,
        authorId: ids.reviewer,
        authorRole: "reviewer",
        visibility: "applicant",
        body: "Please submit audited capital-adequacy ratios for the most recent three quarters before resubmission.",
      });
      await recordAuditEvent(tx, {
        actorId: ids.reviewer,
        actorRole: "reviewer",
        action: "review_note.created",
        resourceType: "review_note",
        resourceId: noteId,
        afterState: {
          application_id: rfiApp.id,
          visibility: "applicant",
          author_role: "reviewer",
        },
        metadata: { source: "seed" },
      });
      reviewNoteCount = 1;
    }

    log.info(
      {
        users: 4,
        roles: 4,
        applications: apps.length,
        reviewNotes: reviewNoteCount,
        auditRows: apps.length + reviewNoteCount,
      },
      "seed inserted via better-auth",
    );
    log.info({ devPassword: DEV_PASSWORD }, "dev password for every user");
  });
}

try {
  await main();
} finally {
  await client.end({ timeout: 5 });
}
