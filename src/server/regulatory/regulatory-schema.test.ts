import { readFile } from "node:fs/promises";

describe("regulatory prisma schema", () => {
  it("allows repeated historical content hashes for reverted source snapshots", async () => {
    const [schema, migration, generatedClass, generatedModel] = await Promise.all([
      readFile("prisma/schema.prisma", "utf8"),
      readFile(
        "prisma/migrations/20260531190000_add_regulatory_knowledge_agent/migration.sql",
        "utf8"
      ),
      readFile("src/generated/prisma/internal/class.ts", "utf8"),
      readFile("src/generated/prisma/models/RegulatorySnapshot.ts", "utf8")
    ]);

    expect(schema).not.toContain("regulatory_snapshots_source_hash_unique");
    expect(migration).not.toContain("regulatory_snapshots_source_hash_unique");
    expect(generatedClass).not.toContain("regulatory_snapshots_source_hash_unique");
    expect(generatedModel).not.toContain("sourceId_contentHash");
  });
});
