import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { evaluateImportedRoute, ROUTE_QUALITY_POLICY_VERSION, type RoutePolicyDecision } from "../src/lib/routes/quality-policy";

type Options = { apply: boolean; batch: number; batches: number; after?: string };

function argValue(argv: string[], name: string) {
  return argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

export function parseReclassificationArgs(argv: string[]): Options {
  const batch = Number(argValue(argv, "batch") ?? 250);
  const batches = Number(argValue(argv, "batches") ?? 1);
  if (!Number.isInteger(batch) || batch < 1 || batch > 2_000) throw new Error("--batch must be between 1 and 2000");
  if (!Number.isInteger(batches) || batches < 1 || batches > 100) throw new Error("--batches must be between 1 and 100");
  return { apply: argv.includes("--apply"), batch, batches, after: argValue(argv, "after") };
}

const rank: Record<RoutePolicyDecision["state"], number> = {
  rejected: 0, pending_review: 1, quarantined: 2, approved: 3,
};

function strongest(decisions: RoutePolicyDecision[]) {
  return [...decisions].sort((left, right) => rank[right.state] - rank[left.state] || right.qualityScore - left.qualityScore)[0];
}

function count(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export async function reclassifyRoutes(prisma: PrismaClient, options: Options) {
  let cursor = options.after;
  let processed = 0;
  const bySource = new Map<string, number>();
  const byReason = new Map<string, number>();
  const byState = new Map<string, number>();

  for (let page = 0; page < options.batches; page++) {
    const routes = await prisma.route.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: "asc" },
      take: options.batch,
      include: { sourceRecords: { orderBy: { source: "asc" } } },
    });
    if (!routes.length) break;

    for (const route of routes) {
      cursor = route.id;
      processed++;
      if (!route.sourceRecords.length || route.origin === "legacy_user_created") {
        if (route.moderationLocked) {
          count(bySource, "manual_moderation_override");
          count(byState, route.publicationState);
          count(byReason, "MANUAL_MODERATION_OVERRIDE");
          continue;
        }
        count(bySource, "legacy_user_created");
        count(byState, "quarantined");
        count(byReason, "LEGACY_USER_ROUTE_WITHOUT_OWNER");
        if (options.apply && (route.publicationState !== "quarantined" || route.policyVersion !== ROUTE_QUALITY_POLICY_VERSION)) {
          await prisma.$transaction([
            prisma.route.update({ where: { id: route.id }, data: {
              origin: "legacy_user_created", publicationState: "quarantined", verificationStatus: "unverified",
              verificationReason: "LEGACY_USER_ROUTE_WITHOUT_OWNER", moderationReason: "Preserved for references; not publicly discoverable",
              qualityScore: 0, qualitySignalsJson: { hasRecoverableOwner: false }, policyVersion: ROUTE_QUALITY_POLICY_VERSION, moderatedAt: new Date(),
            } }),
            prisma.routeModerationEvent.create({ data: {
              routeId: route.id, action: "quarantined", fromState: route.publicationState, toState: "quarantined",
              reason: "LEGACY_USER_ROUTE_WITHOUT_OWNER", policyVersion: ROUTE_QUALITY_POLICY_VERSION, qualityScore: 0,
              signalsJson: { hasRecoverableOwner: false },
            } }),
          ]);
        }
        continue;
      }

      const evaluations = route.sourceRecords.map((record) => {
        const raw = record.rawMetadataJson as Record<string, unknown> | null;
        const tags = raw?.tags && typeof raw.tags === "object" ? raw.tags as Record<string, string> : {};
        const decision = evaluateImportedRoute(record.source, {
          externalId: record.externalId,
          externalUrl: record.externalUrl,
          name: record.sourceName || route.name,
          discipline: route.discipline,
          lengthM: record.sourceDistanceM,
          calculatedLengthM: route.calculatedLengthM,
          pathGeojson: record.geometryGeojson as never,
          geometryCompleteness: record.geometryCompleteness,
          officialRef: route.officialRef ?? tags.ref,
          network: route.network ?? tags.network,
          operator: route.operator ?? tags.operator,
          wikidata: tags.wikidata,
          website: tags.website,
          rawMetadata: raw ?? undefined,
        });
        count(bySource, record.source);
        for (const reason of decision.reasons) count(byReason, reason);
        return { record, decision };
      });
      const chosen = strongest(evaluations.map(({ decision }) => decision));
      count(byState, chosen.state);

      if (!options.apply) continue;
      await prisma.$transaction(async (tx) => {
        for (const { record, decision } of evaluations) {
          if (record.inputFingerprint === decision.inputFingerprint && record.policyVersion === decision.policyVersion && record.publicationState === decision.state && record.verificationStatus === decision.verificationStatus) continue;
          await tx.routeSourceRecord.update({ where: { id: record.id }, data: {
            publicationState: decision.state, verificationStatus: decision.verificationStatus,
            decisionReasons: decision.reasons, qualityScore: decision.qualityScore,
            qualitySignalsJson: decision.signals as Prisma.InputJsonValue,
            sourceAuthority: decision.sourceAuthority, policyVersion: decision.policyVersion,
            inputFingerprint: decision.inputFingerprint, evaluatedAt: new Date(),
          } });
        }
        const changed = !route.moderationLocked && (route.origin !== "imported" || route.publicationState !== chosen.state || route.verificationStatus !== chosen.verificationStatus || route.policyVersion !== chosen.policyVersion || route.qualityScore !== chosen.qualityScore);
        if (changed) await tx.route.update({ where: { id: route.id }, data: {
            origin: "imported", publicationState: chosen.state, verificationStatus: chosen.verificationStatus,
            verificationReason: chosen.reasons.join(", "), moderationReason: chosen.reasons.join(", "),
            qualityScore: chosen.qualityScore, qualitySignalsJson: chosen.signals as Prisma.InputJsonValue,
            sourceAuthority: chosen.sourceAuthority, policyVersion: chosen.policyVersion, moderatedAt: new Date(),
          } });
        if (changed) await tx.routeModerationEvent.create({ data: {
          routeId: route.id,
          action: chosen.state === "approved" ? "approved" : chosen.state === "rejected" ? "rejected" : "quarantined",
          fromState: route.publicationState, toState: chosen.state,
          reason: chosen.reasons.join(", "), policyVersion: chosen.policyVersion,
          qualityScore: chosen.qualityScore, signalsJson: chosen.signals as Prisma.InputJsonValue,
        } });
      });
    }
    if (routes.length < options.batch) break;
  }

  return {
    mode: options.apply ? "apply" : "dry-run",
    processed,
    nextCursor: cursor ?? null,
    byState: Object.fromEntries([...byState].sort()),
    bySource: Object.fromEntries([...bySource].sort()),
    byReason: Object.fromEntries([...byReason].sort()),
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const options = parseReclassificationArgs(process.argv.slice(2));
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const report = await reclassifyRoutes(prisma, options);
    console.log(JSON.stringify(report, null, 2));
    if (!options.apply) console.log("Dry run only. Re-run with --apply to persist this bounded batch.");
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
