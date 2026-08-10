import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  BINDING_PATH,
  LocalIntegrationActivationError,
  PLANE_PATH,
  REPO_ROOT,
  ROUTES_PATH,
  checkLocalIntegrationActivation,
} from "./check-local-integration-activation.mjs";

const plane = readFileSync(resolve(REPO_ROOT, PLANE_PATH), "utf8");
const routes = readFileSync(resolve(REPO_ROOT, ROUTES_PATH), "utf8");
const binding = readFileSync(resolve(REPO_ROOT, BINDING_PATH), "utf8");

test("mounted activation gate executes loopback and real TLS", () => {
  assert.doesNotThrow(() => checkLocalIntegrationActivation());
});

test("a planted missing MCP mount fails, then the clean activation passes", () => {
  const planted = plane.replace(
    "await integrations.serveMcp(binding, route, req, res, position.origin);",
    "sendJson(binding, res, 404, { error: \"not found\" });",
  );
  assert.notEqual(planted, plane, "mutation did not remove the MCP mount");
  assert.throws(
    () => checkLocalIntegrationActivation({
      plane: planted,
      routes,
      binding,
      runFocusedSuite: false,
    }),
    (error) => {
      assert.ok(error instanceof LocalIntegrationActivationError);
      assert.match(error.message, /integrations\.serveMcp/);
      return true;
    },
  );
  assert.doesNotThrow(() => checkLocalIntegrationActivation({
    plane,
    routes,
    binding,
    runFocusedSuite: false,
  }));
});

test("a planted path-before-position reorder fails", () => {
  const positionLine = "  const position = admitRequestPosition(binding, req);";
  const classifyLine = "  const route = classifyLocalPlaneRequestTarget(req.url, req.method);";
  const planted = plane
    .replace(positionLine, "  // planted position moved below classification")
    .replace(classifyLine, `${classifyLine}\n${positionLine}`);
  assert.notEqual(planted, plane, "mutation did not reorder admission");
  assert.throws(
    () => checkLocalIntegrationActivation({
      plane: planted,
      routes,
      binding,
      runFocusedSuite: false,
    }),
    /position must precede/,
  );
});
