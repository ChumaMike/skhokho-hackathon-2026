/**
 * Interactive-transaction limits for Skhokholetha (same values the rest of the
 * codebase uses). Prisma's defaults (2s to get a connection, 5s to finish) are
 * too tight against a remote Postgres at ~300ms per round trip under load.
 */
export const TX_OPTIONS = { timeout: 15_000, maxWait: 10_000 } as const
