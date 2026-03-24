import type { ToolCondition } from "@/lib/db/schema";

/**
 * Evaluate conditions against actual tool call parameters.
 * With "and" logic (default): returns true only when ALL conditions pass.
 * With "or" logic: returns true when ANY condition passes.
 * Returns true if conditions array is empty.
 */
export function evaluateConditions(
  conditions: ToolCondition[],
  params: Record<string, unknown>,
  logic: "and" | "or" = "and",
): boolean {
  if (conditions.length === 0) return true;
  return logic === "or"
    ? conditions.some((condition) => evaluateSingle(condition, params))
    : conditions.every((condition) => evaluateSingle(condition, params));
}

function evaluateSingle(condition: ToolCondition, params: Record<string, unknown>): boolean {
  const value = params[condition.parameterName];

  switch (condition.parameterType) {
    case "string":
      return evaluateString(condition.operator, value, condition.value);
    case "number":
      return evaluateNumber(condition.operator, value, condition.value);
    case "boolean":
      return evaluateBoolean(condition.operator, value);
    case "array":
      return evaluateArray(condition.operator, value, condition.value);
    default:
      return false;
  }
}

function evaluateString(
  operator: "startsWith" | "endsWith" | "contains" | "equals" | "regex",
  actual: unknown,
  expected: string,
): boolean {
  if (typeof actual !== "string") return false;
  switch (operator) {
    case "startsWith":
      return actual.startsWith(expected);
    case "endsWith":
      return actual.endsWith(expected);
    case "contains":
      return actual.includes(expected);
    case "equals":
      return actual === expected;
    case "regex":
      try {
        return new RegExp(expected).test(actual);
      } catch {
        return false;
      }
  }
}

function evaluateNumber(
  operator: "gt" | "gte" | "lt" | "lte" | "regex",
  actual: unknown,
  expected: number | string,
): boolean {
  if (operator === "regex") {
    if (typeof expected !== "string") return false;
    try {
      return new RegExp(expected).test(String(actual));
    } catch {
      return false;
    }
  }

  const num = typeof actual === "number" ? actual : Number(actual);
  if (Number.isNaN(num)) return false;
  if (typeof expected !== "number") return false;

  switch (operator) {
    case "gt":
      return num > expected;
    case "gte":
      return num >= expected;
    case "lt":
      return num < expected;
    case "lte":
      return num <= expected;
  }
}

function evaluateBoolean(operator: "isTrue" | "isFalse", actual: unknown): boolean {
  if (typeof actual !== "boolean") return false;
  switch (operator) {
    case "isTrue":
      return actual === true;
    case "isFalse":
      return actual === false;
  }
}

function evaluateArray(
  operator: "contains" | "equals" | "lengthGt" | "lengthLt" | "lengthGte" | "lengthLte",
  actual: unknown,
  expected: string | string[] | number,
): boolean {
  if (!Array.isArray(actual)) return false;

  switch (operator) {
    case "contains":
      return actual.includes(expected);
    case "equals": {
      if (!Array.isArray(expected)) return false;
      if (actual.length !== expected.length) return false;
      return actual.every((item, i) => item === expected[i]);
    }
    case "lengthGt":
      return typeof expected === "number" && actual.length > expected;
    case "lengthLt":
      return typeof expected === "number" && actual.length < expected;
    case "lengthGte":
      return typeof expected === "number" && actual.length >= expected;
    case "lengthLte":
      return typeof expected === "number" && actual.length <= expected;
  }
}
