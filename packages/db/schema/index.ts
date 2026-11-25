import { pgTable, text, timestamp, integer, doublePrecision, numeric, jsonb, pgEnum, index } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

export const sandboxStatusEnum = pgEnum('sandbox_status', [
    'CREATING',
    'RUNNING',
    'STOPPED',
    'DESTROYED',
    'FAILED'
]);

export const runStatusEnum = pgEnum('run_status', [
    'QUEUED',
    'RUNNING',
    'AWAITING_APPROVAL',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
    'INTERRUPTED'
]);

export const organization = pgTable('organization', {
    id: text('id').primaryKey().$defaultFn(() => sql`cuid()`), // Note: Ensure you handle cuid generation via SQL default or JS
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

export const sandbox = pgTable('sandbox', {
    id: text('id').primaryKey().$defaultFn(() => sql`cuid()`),
    organizationId: text('organization_id').notNull().references(() => organization.id),
    name: text('name').notNull(),
    provider: text('provider').default('docker').notNull(),
    resourceId: text('resource_id'),
    status: sandboxStatusEnum('status').default('CREATING').notNull(),
    memoryMb: integer('memory_mb').default(512).notNull(),
    cpu: doublePrecision('cpu').default(1.0).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
    index('sandbox_org_created_idx').on(table.organizationId, table.createdAt)
]);

export const agentRun = pgTable('agent_run', {
    id: text('id').primaryKey().$defaultFn(() => sql`cuid()`),
    organizationId: text('organization_id').notNull().references(() => organization.id),
    sandboxId: text('sandbox_id').notNull().references(() => sandbox.id),
    task: text('task').notNull(),
    status: runStatusEnum('status').default('QUEUED').notNull(),
    result: jsonb('result'),
    error: text('error'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull().$onUpdate(() => new Date()),
    startedAt: timestamp('started_at', { mode: 'date' }),
    completedAt: timestamp('completed_at', { mode: 'date' }),
}, (table) => [
    index('agent_run_org_created_idx').on(table.organizationId, table.createdAt),
    index('agent_run_status_created_idx').on(table.status, table.createdAt)
]);

export const agentEvent = pgTable('agent_event', {
    id: text('id').primaryKey().$defaultFn(() => sql`cuid()`),
    runId: text('run_id').notNull().references(() => agentRun.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
}, (table) => [
    index('agent_event_run_created_idx').on(table.runId, table.createdAt)
]);

export const apiKey = pgTable('api_key', {
    id: text('id').primaryKey().$defaultFn(() => sql`cuid()`),
    organizationId: text('organization_id').notNull().references(() => organization.id),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').unique().notNull(),
    scopes: text('scopes').array().notNull(), // maps to String[]
    revokedAt: timestamp('revoked_at', { mode: 'date' }),
    expiresAt: timestamp('expires_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

export const usageEvent = pgTable('usage_event', {
    id: text('id').primaryKey().$defaultFn(() => sql`cuid()`),
    organizationId: text('organization_id').notNull().references(() => organization.id),
    metric: text('metric').notNull(),
    quantity: numeric('quantity', { precision: 20, scale: 6 }).notNull(), // maps to Decimal(20,6)
    unit: text('unit').notNull(),
    idempotencyKey: text('idempotency_key').unique().notNull(),
    metadata: jsonb('metadata'),
    occurredAt: timestamp('occurred_at', { mode: 'date' }).defaultNow().notNull(),
}, (table) => [
    index('usage_event_org_occurred_idx').on(table.organizationId, table.occurredAt)
]);


export const organizationRelations = relations(organization, ({ many }) => ({
    sandboxes: many(sandbox),
    runs: many(agentRun),
    apiKeys: many(apiKey),
    usage: many(usageEvent),
}));

export const sandboxRelations = relations(sandbox, ({ one, many }) => ({
    organization: one(organization, {
        fields: [sandbox.organizationId],
        references: [organization.id],
    }),
    runs: many(agentRun),
}));

export const agentRunRelations = relations(agentRun, ({ one, many }) => ({
    organization: one(organization, {
        fields: [agentRun.organizationId],
        references: [organization.id],
    }),
    sandbox: one(sandbox, {
        fields: [agentRun.sandboxId],
        references: [sandbox.id],
    }),
    events: many(agentEvent),
}));

export const agentEventRelations = relations(agentEvent, ({ one }) => ({
    run: one(agentRun, {
        fields: [agentEvent.runId],
        references: [agentRun.id],
    }),
}));

export const apiKeyRelations = relations(apiKey, ({ one }) => ({
    organization: one(organization, {
        fields: [apiKey.organizationId],
        references: [organization.id],
    }),
}));

export const usageEventRelations = relations(usageEvent, ({ one }) => ({
    organization: one(organization, {
        fields: [usageEvent.organizationId],
        references: [organization.id],
    }),
}));
