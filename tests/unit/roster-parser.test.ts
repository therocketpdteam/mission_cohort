import assert from "node:assert/strict";
import test from "node:test";
import { parseRosterText } from "../../src/lib/rosterParser";

test("parses comma-separated roster rows", () => {
  const result = parseRosterText("Ada Lovelace, ada@example.com, Math Coach\nGrace Hopper, grace@example.com");

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.participants.length, 2);
  assert.deepEqual(result.participants[0], {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    title: "Math Coach"
  });
});

test("parses preferred name title email roster rows", () => {
  const result = parseRosterText("Ada Lovelace, Math Coach, ada@example.com\nGrace Hopper, Principal, grace@example.com");

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.participants[0], {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    title: "Math Coach"
  });
  assert.deepEqual(result.participants[1], {
    firstName: "Grace",
    lastName: "Hopper",
    email: "grace@example.com",
    title: "Principal"
  });
});

test("keeps participant rows with missing title as warnings", () => {
  const result = parseRosterText("Ada Lovelace, , ada@example.com\nGrace Hopper, grace@example.com");

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 2);
  assert.equal(result.participants.length, 2);
  assert.equal(result.participants[0].email, "ada@example.com");
  assert.equal(result.participants[0].title, undefined);
});

test("parses first last email spreadsheet rows", () => {
  const result = parseRosterText("Katherine\tJohnson\tkatherine@example.com\tTeacher\t555-0101");

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.participants[0], {
    firstName: "Katherine",
    lastName: "Johnson",
    email: "katherine@example.com",
    title: "Teacher",
    phone: "555-0101"
  });
});

test("dedupes and reports invalid roster rows", () => {
  const result = parseRosterText("Ada Lovelace ada@example.com\nAda Again ada@example.com\nBroken Person");

  assert.equal(result.participants.length, 1);
  assert.equal(result.errors.length, 2);
  assert.equal(result.warnings.length, 1);
  assert.match(result.errors[0], /repeats/);
  assert.match(result.errors[1], /valid email/);
});
