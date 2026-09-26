import { parseAuditLogQuery } from "@/app/api/v1/admin/audit-logs/query";

describe("parseAuditLogQuery", () => {
  it.each([
    ["unknown event types", "eventType=unknown"],
    ["negative offsets", "offset=-1"],
    ["oversized limits", "limit=101"],
    ["zero limits", "limit=0"],
    ["inverted dates", "startDate=2026-02-01&endDate=2026-01-01"],
  ])("rejects %s", (_name, query) => {
    expect(parseAuditLogQuery(new URLSearchParams(query))).toEqual(
      expect.objectContaining({ error: expect.any(String) })
    );
  });

  it("accepts valid filters and applies the default page size", () => {
    const result = parseAuditLogQuery(
      new URLSearchParams("eventType=gift_claimed&startDate=2026-01-01&limit=100&offset=10")
    );

    expect(result).toMatchObject({
      query: {
        eventType: "gift_claimed",
        limit: 100,
        offset: 10,
      },
    });
  });
});
