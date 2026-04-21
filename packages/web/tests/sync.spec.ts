import { expect, test } from "@playwright/test";

/**
 * Pseudo-coherence smoke test. Two browser contexts open the same
 * workspace and channel. The first sends a message, the second is
 * expected to render it within a short window.
 *
 * The actual backend wiring is exercised by the Python integration
 * suite (`app/tests/integration/sync/test_multi_client_coherence.py`);
 * this test guards the happy path through the real DOM.
 */
test("two clients see the same message @smoke", async ({ browser }) => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, "Requires running web server");

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await pageA.goto("/w/w_demo/c/c_general");
  await pageB.goto("/w/w_demo/c/c_general");

  await pageA.getByLabel("Message composer").fill("hello from A");
  await pageA.getByRole("button", { name: "Send" }).click();

  await expect(pageB.getByTestId("message").last()).toContainText("hello from A");
});
