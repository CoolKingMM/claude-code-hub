import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const serviceTs = readFileSync(resolve(process.cwd(), "src/lib/log-cleanup/service.ts"), "utf-8");
const usersTs = readFileSync(resolve(process.cwd(), "src/actions/users.ts"), "utf-8");
describe("usage_ledger cleanup immunity", () => {
  it("log cleanup service never imports or queries usageLedger", () => {
    expect(serviceTs).not.toMatch(/import\b.*\busageLedger\b/);
    expect(serviceTs).not.toMatch(/from.*schema.*usageLedger/);
    expect(serviceTs).not.toContain("db.delete(usageLedger)");
    expect(serviceTs).not.toContain('from("usage_ledger")');
    expect(serviceTs).not.toContain("FROM usage_ledger");
  });

  it("removeUser does not delete from usageLedger", () => {
    const removeUserMatch = usersTs.match(/export async function removeUser[\s\S]*?^}/m);
    expect(removeUserMatch).not.toBeNull();
    const removeUserBody = removeUserMatch![0];
    expect(removeUserBody).not.toContain("db.delete(usageLedger)");
  });

  it("users actions never delete usageLedger inline", () => {
    expect(usersTs).not.toContain(".delete(usageLedger)");
  });
});
