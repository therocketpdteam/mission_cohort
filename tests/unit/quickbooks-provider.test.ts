import assert from "node:assert/strict";
import test from "node:test";
import { findQuickBooksProject } from "../../src/modules/quickbooks/provider";

test("finds QuickBooks projects by filtering customers client-side", async () => {
  const originalFetch = global.fetch;
  let queryUrl = "";

  global.fetch = (async (input: RequestInfo | URL) => {
    queryUrl = String(input);
    return new Response(JSON.stringify({
      QueryResponse: {
        Customer: [
          { Id: "1", DisplayName: "KM-Fall 2025", Job: false, ParentRef: { value: "99" } },
          { Id: "2", DisplayName: "KM-Fall 2025", Job: true, ParentRef: { value: "42" } },
          { Id: "3", DisplayName: "Other Project", Job: true, ParentRef: { value: "42" } }
        ]
      }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const project = await findQuickBooksProject({
      realmId: "realm",
      accessToken: "token",
      parentCustomerRef: "42",
      projectName: "KM-Fall 2025",
      environment: "sandbox"
    });

    assert.equal(project?.Id, "2");
    assert.equal(new URL(queryUrl).searchParams.get("query"), "select * from Customer startposition 1 maxresults 1000");
  } finally {
    global.fetch = originalFetch;
  }
});
