import assert from "node:assert/strict";
import { test } from "node:test";
import { approveLaunch } from "./governor";

test("a funded eleven-person round preserves the reserve", () => {
  assert.equal(approveLaunch({ cpiCents: 750, n: 11, totalCents: 8250 }, { affordable: true }, 10000).ok, true);
  assert.equal(approveLaunch({ cpiCents: 900, n: 10, totalCents: 9000 }, { affordable: true }, 10000).ok, true);
});
test("over-budget rounds propose a smaller quote instead of approving unquoted spending", () => {
  const result = approveLaunch({ cpiCents: 850, n: 11, totalCents: 9350 }, { affordable: true }, 10000);
  assert.equal(result.ok, false); assert.equal(result.n, 10);
  assert.equal(approveLaunch({ cpiCents: 1200, n: 8, totalCents: 9600 }, { affordable: true }, 10000).n, 0);
});
test("provider funding rejection, invalid cents and understated totals never pass", () => {
  const quote = { cpiCents: 750, n: 11, totalCents: 8250 };
  assert.equal(approveLaunch(quote, { affordable: false }, 10000).ok, false);
  for (const bad of [NaN, Infinity, -1, 0, 750.5]) assert.equal(approveLaunch({ ...quote, cpiCents: bad }, { affordable: true }, 10000).ok, false);
  assert.equal(approveLaunch({ ...quote, totalCents: 100 }, { affordable: true }, 10000).ok, false);
});
