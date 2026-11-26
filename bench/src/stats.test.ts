import { expect, test } from "vitest";
import { mean, percentile } from "./stats.js";

test("percentile and mean", () => {
  const xs = [5, 1, 4, 2, 3];
  expect(percentile(xs, 50)).toBe(3);
  expect(percentile(xs, 95)).toBe(5);
  expect(mean(xs)).toBe(3);
  expect(Number.isNaN(percentile([], 50))).toBe(true);
});
