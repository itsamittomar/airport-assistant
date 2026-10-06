import { describe, expect, it, beforeEach } from "vitest";
import { RequestContext } from "@mastra/core/request-context";
import { getFlightStatus, findRebookingOptions } from "../src/tools/flight-tools.js";
import { findLounges, checkLoungeAccess } from "../src/tools/lounge-tools.js";
import { checkPolicyCoverage, fileDelayClaim } from "../src/tools/claims-tools.js";
import { CLAIMS } from "../src/data/members.js";
import { startTrace, endTrace, toolCalls } from "../src/trace.js";

/** Execute a Mastra tool the way the agent loop would, with a trace id attached. */
async function call(tool: any, input: unknown) {
  const traceId = startTrace();
  const requestContext = new RequestContext<Record<string, unknown>>();
  requestContext.set("traceId", traceId);
  const output = await tool.execute(input, { requestContext });
  return { output, trace: endTrace(traceId) };
}

describe("flight tools", () => {
  it("returns full status for a known delayed flight", async () => {
    const { output } = await call(getFlightStatus, { flightNumber: "ba117" });
    expect(output.found).toBe(true);
    expect(output.status).toBe("DELAYED");
    expect(output.delayMinutes).toBe(195);
  });

  it("returns found=false rather than throwing for an unknown flight", async () => {
    const { output } = await call(getFlightStatus, { flightNumber: "ZZ999" });
    expect(output.found).toBe(false);
    expect(output.message).toMatch(/not? flight|No flight/i);
  });

  it("marks sold-out alternatives as not bookable", async () => {
    const { output } = await call(findRebookingOptions, { flightNumber: "BA117" });
    const aa = output.options.find((o: any) => o.flightNumber === "AA101");
    expect(aa.bookable).toBe(false);
    expect(output.options.some((o: any) => o.flightNumber === "BA117")).toBe(false);
  });
});

describe("lounge tools", () => {
  it("flags lounges at or above 95% occupancy as full", async () => {
    const { output } = await call(findLounges, { airport: "lhr", terminal: "5" });
    const plaza = output.lounges.find((l: any) => l.id === "LHR-T5-PLAZA");
    expect(plaza.isFull).toBe(true);
    expect(output.lounges.find((l: any) => l.id === "LHR-T5-ASPIRE").isFull).toBe(false);
  });

  it("returns an empty list with a message for an airport with no lounges", async () => {
    const { output } = await call(findLounges, { airport: "CDG" });
    expect(output.lounges).toEqual([]);
    expect(output.message).toContain("CDG");
  });

  it.each([
    ["PP-9999", "LHR-T5-ASPIRE", "MEMBER_NOT_FOUND"],
    ["PP-1001", "NOPE", "LOUNGE_NOT_FOUND"],
    ["PP-2002", "LHR-T5-PLAZA", "TIER_TOO_LOW"],
    ["PP-3003", "LHR-T5-ASPIRE", "NO_VISITS_REMAINING"],
    ["PP-1001", "LHR-T5-PLAZA", "LOUNGE_FULL"],
  ])("denies %s at %s with %s", async (memberId, loungeId, reason) => {
    const { output } = await call(checkLoungeAccess, { memberId, loungeId, guests: 0 });
    expect(output.allowed).toBe(false);
    expect(output.reason).toBe(reason);
  });

  it("grants access and prices guests per head", async () => {
    const { output } = await call(checkLoungeAccess, { memberId: "PP-1001", loungeId: "LHR-T5-ASPIRE", guests: 2 });
    expect(output.allowed).toBe(true);
    expect(output.totalGuestFeeGbp).toBe(70);
    expect(output.visitsRemainingAfter).toBeNull();
  });
});

describe("claims tools", () => {
  beforeEach(() => CLAIMS.splice(0));

  it("is eligible when the delay exceeds the policy threshold", async () => {
    const { output } = await call(checkPolicyCoverage, { memberId: "PP-1001", flightNumber: "BA117" });
    expect(output).toMatchObject({ eligible: true, claimType: "DELAY", payoutGbp: 150 });
  });

  it("is not eligible when the delay is below the threshold", async () => {
    const { output } = await call(checkPolicyCoverage, { memberId: "PP-2002", flightNumber: "BA117" });
    expect(output).toMatchObject({ eligible: false, reason: "BELOW_THRESHOLD", thresholdMinutes: 240 });
  });

  it("treats cancellation as eligible regardless of delay minutes", async () => {
    const { output } = await call(checkPolicyCoverage, { memberId: "PP-2002", flightNumber: "VS3" });
    expect(output).toMatchObject({ eligible: true, claimType: "CANCELLATION", maxPayoutGbp: 500 });
  });

  it("reports members without a policy", async () => {
    const { output } = await call(checkPolicyCoverage, { memberId: "PP-3003", flightNumber: "BA117" });
    expect(output.reason).toBe("NO_POLICY");
  });

  /** Run a coverage check then a filing inside ONE trace, as the claims agent would. */
  async function checkThenFile(memberId: string, flightNumber: string) {
    const traceId = startTrace();
    const requestContext = new RequestContext<Record<string, unknown>>();
    requestContext.set("traceId", traceId);
    await (checkPolicyCoverage as any).execute({ memberId, flightNumber }, { requestContext });
    const output = await (fileDelayClaim as any).execute({ memberId, flightNumber }, { requestContext });
    endTrace(traceId);
    return output;
  }

  it("files once and rejects the duplicate", async () => {
    const first = await checkThenFile("PP-1001", "BA117");
    expect(first.filed).toBe(true);
    expect(first.amountGbp).toBe(150);
    const second = await checkThenFile("PP-1001", "BA117");
    expect(second).toMatchObject({ filed: false, reason: "DUPLICATE", claimId: first.claimId });
  });

  it("refuses to file when the coverage check in the same run was not eligible", async () => {
    const output = await checkThenFile("PP-2002", "SQ321");
    expect(output).toMatchObject({ filed: false, reason: "COVERAGE_NOT_CHECKED" });
  });

  it("refuses to file when no coverage check happened in the run at all", async () => {
    const { output } = await call(fileDelayClaim, { memberId: "PP-1001", flightNumber: "BA117" });
    expect(output).toMatchObject({ filed: false, reason: "COVERAGE_NOT_CHECKED" });
  });
});

describe("tracing", () => {
  it("records owner, tool, input and output for every call", async () => {
    const { trace } = await call(getFlightStatus, { flightNumber: "EK5" });
    const calls = toolCalls(trace);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ agent: "flightAgent", tool: "getFlightStatus", ok: true });
    expect((calls[0].output as any).status).toBe("ON_TIME");
  });
});
