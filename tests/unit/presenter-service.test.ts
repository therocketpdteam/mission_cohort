import assert from "node:assert/strict";
import test from "node:test";
import { presenterCreateSchema } from "../../src/validators/presenter";

test("normalizes presenter creation input", () => {
  const parsed = presenterCreateSchema.parse({
    firstName: " Peter ",
    lastName: " Liljedahl ",
    shortName: " pl ",
    email: " Peter@example.COM ",
    organization: "",
    phone: " ",
    active: true
  });

  assert.deepEqual(parsed, {
    firstName: "Peter",
    lastName: "Liljedahl",
    shortName: "PL",
    email: "peter@example.com",
    organization: undefined,
    phone: undefined,
    active: true
  });
});
