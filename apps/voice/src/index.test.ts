import { expect, test } from "vitest";

test("package loads", async () => {
  await import("./index.js");
  expect(true).toBe(true);
});
