import { describe, test, expect } from "bun:test";
import { evaluateConditions } from "./conditions";
import type { ToolCondition } from "@/lib/db/schema";

describe("evaluateConditions", () => {
  test("returns true for empty conditions array", () => {
    expect(evaluateConditions([], { foo: "bar" })).toBe(true);
  });

  test("returns false when parameter is missing", () => {
    const conditions: ToolCondition[] = [
      { parameterName: "missing", parameterType: "string", operator: "equals", value: "x" },
    ];
    expect(evaluateConditions(conditions, {})).toBe(false);
  });

  // --- String conditions ---
  describe("string conditions", () => {
    test("startsWith", () => {
      const c: ToolCondition[] = [
        { parameterName: "to", parameterType: "string", operator: "startsWith", value: "admin" },
      ];
      expect(evaluateConditions(c, { to: "admin@example.com" })).toBe(true);
      expect(evaluateConditions(c, { to: "user@example.com" })).toBe(false);
    });

    test("endsWith", () => {
      const c: ToolCondition[] = [
        {
          parameterName: "to",
          parameterType: "string",
          operator: "endsWith",
          value: "@example.com",
        },
      ];
      expect(evaluateConditions(c, { to: "test@example.com" })).toBe(true);
      expect(evaluateConditions(c, { to: "test@other.com" })).toBe(false);
    });

    test("contains", () => {
      const c: ToolCondition[] = [
        {
          parameterName: "subject",
          parameterType: "string",
          operator: "contains",
          value: "urgent",
        },
      ];
      expect(evaluateConditions(c, { subject: "This is urgent!" })).toBe(true);
      expect(evaluateConditions(c, { subject: "Nothing here" })).toBe(false);
    });

    test("equals", () => {
      const c: ToolCondition[] = [
        {
          parameterName: "to",
          parameterType: "string",
          operator: "equals",
          value: "alice@test.com",
        },
      ];
      expect(evaluateConditions(c, { to: "alice@test.com" })).toBe(true);
      expect(evaluateConditions(c, { to: "bob@test.com" })).toBe(false);
    });

    test("regex", () => {
      const c: ToolCondition[] = [
        {
          parameterName: "to",
          parameterType: "string",
          operator: "regex",
          value: "^[a-z]+@example\\.com$",
        },
      ];
      expect(evaluateConditions(c, { to: "alice@example.com" })).toBe(true);
      expect(evaluateConditions(c, { to: "ALICE@example.com" })).toBe(false);
      expect(evaluateConditions(c, { to: "alice@other.com" })).toBe(false);
    });

    test("regex with invalid pattern returns false", () => {
      const c: ToolCondition[] = [
        { parameterName: "to", parameterType: "string", operator: "regex", value: "[invalid" },
      ];
      expect(evaluateConditions(c, { to: "anything" })).toBe(false);
    });

    test("returns false for non-string actual value", () => {
      const c: ToolCondition[] = [
        { parameterName: "to", parameterType: "string", operator: "equals", value: "test" },
      ];
      expect(evaluateConditions(c, { to: 123 })).toBe(false);
    });
  });

  // --- Number conditions ---
  describe("number conditions", () => {
    test("gt", () => {
      const c: ToolCondition[] = [
        { parameterName: "amount", parameterType: "number", operator: "gt", value: 100 },
      ];
      expect(evaluateConditions(c, { amount: 150 })).toBe(true);
      expect(evaluateConditions(c, { amount: 100 })).toBe(false);
      expect(evaluateConditions(c, { amount: 50 })).toBe(false);
    });

    test("gte", () => {
      const c: ToolCondition[] = [
        { parameterName: "amount", parameterType: "number", operator: "gte", value: 100 },
      ];
      expect(evaluateConditions(c, { amount: 100 })).toBe(true);
      expect(evaluateConditions(c, { amount: 99 })).toBe(false);
    });

    test("lt", () => {
      const c: ToolCondition[] = [
        { parameterName: "amount", parameterType: "number", operator: "lt", value: 100 },
      ];
      expect(evaluateConditions(c, { amount: 50 })).toBe(true);
      expect(evaluateConditions(c, { amount: 100 })).toBe(false);
    });

    test("lte", () => {
      const c: ToolCondition[] = [
        { parameterName: "amount", parameterType: "number", operator: "lte", value: 100 },
      ];
      expect(evaluateConditions(c, { amount: 100 })).toBe(true);
      expect(evaluateConditions(c, { amount: 101 })).toBe(false);
    });

    test("regex on number", () => {
      const c: ToolCondition[] = [
        { parameterName: "amount", parameterType: "number", operator: "regex", value: "^\\d{3}$" },
      ];
      expect(evaluateConditions(c, { amount: 123 })).toBe(true);
      expect(evaluateConditions(c, { amount: 12 })).toBe(false);
    });

    test("returns false for non-number actual value", () => {
      const c: ToolCondition[] = [
        { parameterName: "amount", parameterType: "number", operator: "gt", value: 100 },
      ];
      expect(evaluateConditions(c, { amount: "not-a-number" })).toBe(false);
    });
  });

  // --- Boolean conditions ---
  describe("boolean conditions", () => {
    test("isTrue", () => {
      const c: ToolCondition[] = [
        { parameterName: "urgent", parameterType: "boolean", operator: "isTrue" },
      ];
      expect(evaluateConditions(c, { urgent: true })).toBe(true);
      expect(evaluateConditions(c, { urgent: false })).toBe(false);
    });

    test("isFalse", () => {
      const c: ToolCondition[] = [
        { parameterName: "draft", parameterType: "boolean", operator: "isFalse" },
      ];
      expect(evaluateConditions(c, { draft: false })).toBe(true);
      expect(evaluateConditions(c, { draft: true })).toBe(false);
    });

    test("returns false for non-boolean actual value", () => {
      const c: ToolCondition[] = [
        { parameterName: "flag", parameterType: "boolean", operator: "isTrue" },
      ];
      expect(evaluateConditions(c, { flag: "true" })).toBe(false);
      expect(evaluateConditions(c, { flag: 1 })).toBe(false);
    });
  });

  // --- Array conditions ---
  describe("array conditions", () => {
    test("contains", () => {
      const c: ToolCondition[] = [
        { parameterName: "tags", parameterType: "array", operator: "contains", value: "urgent" },
      ];
      expect(evaluateConditions(c, { tags: ["urgent", "work"] })).toBe(true);
      expect(evaluateConditions(c, { tags: ["work", "personal"] })).toBe(false);
    });

    test("equals", () => {
      const c: ToolCondition[] = [
        { parameterName: "tags", parameterType: "array", operator: "equals", value: ["a", "b"] },
      ];
      expect(evaluateConditions(c, { tags: ["a", "b"] })).toBe(true);
      expect(evaluateConditions(c, { tags: ["b", "a"] })).toBe(false);
      expect(evaluateConditions(c, { tags: ["a"] })).toBe(false);
    });

    test("lengthGt", () => {
      const c: ToolCondition[] = [
        { parameterName: "tags", parameterType: "array", operator: "lengthGt", value: 2 },
      ];
      expect(evaluateConditions(c, { tags: ["a", "b", "c"] })).toBe(true);
      expect(evaluateConditions(c, { tags: ["a", "b"] })).toBe(false);
    });

    test("lengthLt", () => {
      const c: ToolCondition[] = [
        { parameterName: "tags", parameterType: "array", operator: "lengthLt", value: 3 },
      ];
      expect(evaluateConditions(c, { tags: ["a", "b"] })).toBe(true);
      expect(evaluateConditions(c, { tags: ["a", "b", "c"] })).toBe(false);
    });

    test("lengthGte", () => {
      const c: ToolCondition[] = [
        { parameterName: "tags", parameterType: "array", operator: "lengthGte", value: 2 },
      ];
      expect(evaluateConditions(c, { tags: ["a", "b"] })).toBe(true);
      expect(evaluateConditions(c, { tags: ["a"] })).toBe(false);
    });

    test("lengthLte", () => {
      const c: ToolCondition[] = [
        { parameterName: "tags", parameterType: "array", operator: "lengthLte", value: 2 },
      ];
      expect(evaluateConditions(c, { tags: ["a", "b"] })).toBe(true);
      expect(evaluateConditions(c, { tags: ["a", "b", "c"] })).toBe(false);
    });

    test("returns false for non-array actual value", () => {
      const c: ToolCondition[] = [
        { parameterName: "tags", parameterType: "array", operator: "contains", value: "x" },
      ];
      expect(evaluateConditions(c, { tags: "not-an-array" })).toBe(false);
    });
  });

  // --- Multiple conditions (AND logic) ---
  describe("multiple conditions (AND logic)", () => {
    test("all pass → true", () => {
      const conditions: ToolCondition[] = [
        {
          parameterName: "to",
          parameterType: "string",
          operator: "endsWith",
          value: "@example.com",
        },
        {
          parameterName: "subject",
          parameterType: "string",
          operator: "contains",
          value: "report",
        },
      ];
      expect(
        evaluateConditions(conditions, { to: "test@example.com", subject: "Daily report" }),
      ).toBe(true);
    });

    test("one fails → false", () => {
      const conditions: ToolCondition[] = [
        {
          parameterName: "to",
          parameterType: "string",
          operator: "endsWith",
          value: "@example.com",
        },
        {
          parameterName: "subject",
          parameterType: "string",
          operator: "contains",
          value: "report",
        },
      ];
      expect(
        evaluateConditions(conditions, { to: "test@other.com", subject: "Daily report" }),
      ).toBe(false);
    });

    test("mixed types all pass → true", () => {
      const conditions: ToolCondition[] = [
        {
          parameterName: "to",
          parameterType: "string",
          operator: "endsWith",
          value: "@example.com",
        },
        { parameterName: "tags", parameterType: "array", operator: "contains", value: "approved" },
      ];
      expect(
        evaluateConditions(conditions, { to: "test@example.com", tags: ["approved", "work"] }),
      ).toBe(true);
    });
  });

  describe("OR logic", () => {
    test("one condition passes → true", () => {
      const conditions: ToolCondition[] = [
        {
          parameterName: "to",
          parameterType: "string",
          operator: "endsWith",
          value: "@example.com",
        },
        {
          parameterName: "subject",
          parameterType: "string",
          operator: "contains",
          value: "urgent",
        },
      ];
      expect(
        evaluateConditions(conditions, { to: "test@other.com", subject: "This is urgent" }, "or"),
      ).toBe(true);
    });

    test("no conditions pass → false", () => {
      const conditions: ToolCondition[] = [
        {
          parameterName: "to",
          parameterType: "string",
          operator: "endsWith",
          value: "@example.com",
        },
        {
          parameterName: "subject",
          parameterType: "string",
          operator: "contains",
          value: "urgent",
        },
      ];
      expect(
        evaluateConditions(conditions, { to: "test@other.com", subject: "Hello World" }, "or"),
      ).toBe(false);
    });

    test("all conditions pass → true", () => {
      const conditions: ToolCondition[] = [
        {
          parameterName: "to",
          parameterType: "string",
          operator: "endsWith",
          value: "@example.com",
        },
        {
          parameterName: "subject",
          parameterType: "string",
          operator: "contains",
          value: "report",
        },
      ];
      expect(
        evaluateConditions(
          conditions,
          { to: "test@example.com", subject: "Daily report" },
          "or",
        ),
      ).toBe(true);
    });

    test("empty conditions → true", () => {
      expect(evaluateConditions([], {}, "or")).toBe(true);
    });

    test("mixed types — one passes → true", () => {
      const conditions: ToolCondition[] = [
        {
          parameterName: "priority",
          parameterType: "number",
          operator: "gte",
          value: 5,
        },
        {
          parameterName: "urgent",
          parameterType: "boolean",
          operator: "isTrue",
        },
      ];
      expect(
        evaluateConditions(conditions, { priority: 3, urgent: true }, "or"),
      ).toBe(true);
    });
  });
});
