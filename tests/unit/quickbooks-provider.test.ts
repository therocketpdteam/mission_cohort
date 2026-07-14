import assert from "node:assert/strict";
import test from "node:test";
import { createQuickBooksBill, createQuickBooksProject, findQuickBooksProject } from "../../src/modules/quickbooks/provider";

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

test("creates QuickBooks projects as customer jobs under the parent customer", async () => {
  const originalFetch = global.fetch;
  let requestBody: Record<string, any> = {};

  global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({
      Customer: {
        Id: "88",
        DisplayName: requestBody.DisplayName,
        Job: requestBody.Job,
        ParentRef: requestBody.ParentRef,
        BillWithParent: requestBody.BillWithParent
      }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const project = await createQuickBooksProject({
      realmId: "realm",
      accessToken: "token",
      parentCustomerRef: "42",
      projectName: "KM-Fall 2025",
      environment: "sandbox"
    });

    assert.equal(requestBody.DisplayName, "KM-Fall 2025");
    assert.equal(requestBody.Job, true);
    assert.equal(requestBody.BillWithParent, false);
    assert.deepEqual(requestBody.ParentRef, { value: "42" });
    assert.equal(project.Id, "88");
  } finally {
    global.fetch = originalFetch;
  }
});

test("creates QuickBooks bills with vendor, expense account, and project refs", async () => {
  const originalFetch = global.fetch;
  let requestBody: Record<string, any> = {};
  let requestUrl = "";

  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({
      Bill: {
        Id: "bill-88",
        DocNumber: requestBody.DocNumber,
        VendorRef: requestBody.VendorRef,
        Line: requestBody.Line
      }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const bill = await createQuickBooksBill({
      realmId: "realm",
      accessToken: "token",
      environment: "sandbox",
      bill: {
        VendorRef: { value: "vendor-42" },
        DocNumber: "MC-PAYOUT-ABC123",
        Line: [
          {
            Amount: 1200,
            DetailType: "AccountBasedExpenseLineDetail",
            Description: "TL payout for KM Fall 2025",
            AccountBasedExpenseLineDetail: {
              AccountRef: { value: "expense-77" },
              CustomerRef: { value: "project-99" },
              BillableStatus: "NotBillable"
            }
          }
        ]
      }
    });

    assert.match(requestUrl, /\/bill\?minorversion=75$/);
    assert.deepEqual(requestBody.VendorRef, { value: "vendor-42" });
    assert.equal(requestBody.Line[0].Amount, 1200);
    assert.deepEqual(requestBody.Line[0].AccountBasedExpenseLineDetail.AccountRef, { value: "expense-77" });
    assert.deepEqual(requestBody.Line[0].AccountBasedExpenseLineDetail.CustomerRef, { value: "project-99" });
    assert.equal(bill.Id, "bill-88");
  } finally {
    global.fetch = originalFetch;
  }
});
