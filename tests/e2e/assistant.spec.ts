import { expect, test, type Page } from '@playwright/test';

/** Creates a project, imports one fixture through the in-app browser and adds it to the timeline. */
async function projectWithClip(page: Page, name: string, file: string, platform = 'youtube') {
  await page.goto('/');
  await page.locator('[data-action="home.newProject"]').click();
  await page.getByTestId('project-name-input').fill(name);
  await page.getByTestId('project-platform-select').selectOption(platform);
  await page.locator('[data-action="projects.create.submit"]').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.locator('[data-action="editor.import"]').click();
  await page.locator('[data-action="fileBrowser.root"]', { hasText: 'sample-media' }).click();
  await page.locator('[data-action="fileBrowser.toggleFile"]', { hasText: file }).click();
  await page.locator('[data-action="fileBrowser.select"]').click();
  const item = page.getByTestId('media-panel-item').filter({ hasText: file });
  await expect(item.locator('[data-action="editor.addAsset"]')).toBeEnabled({ timeout: 60_000 });
  await item.locator('[data-action="editor.addAsset"]').click();
  await expect(page.getByTestId('editor-clip-count')).toContainText('1');
}

test.describe('AI assistant', () => {
  test('turns an Arabic command into a plan, applies it and verifies each step against the document', async ({ page }) => {
    test.setTimeout(420_000);
    await projectWithClip(page, 'E2E assistant', 'face-pan-4s.mp4');
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:04:00');
    await page.locator('[data-action="app.assistant"]').click();
    await expect(page.getByTestId('assistant-panel')).toBeVisible();

    // trim (edit), blur the face (privacy, needs the worker + YuNet) and a black-and-white look (colour) in one request
    await page.getByTestId('assistant-input').fill('احذف أول ثانية، طمس الوجه، وخليه أبيض وأسود');
    await page.getByTestId('assistant-send').click();

    const plan = page.getByTestId('assistant-plan').last();
    await expect(plan).toBeVisible({ timeout: 30_000 });
    await expect(plan.getByTestId('plan-step')).toHaveCount(3);
    await expect(plan.locator('[data-type="trimStart"][data-feasible="true"]')).toBeVisible();
    await expect(plan.locator('[data-type="blurFaces"][data-feasible="true"]')).toBeVisible();
    await expect(plan.locator('[data-type="applyLook"][data-feasible="true"]')).toBeVisible();

    await plan.getByTestId('plan-apply').click();
    const result = page.getByTestId('assistant-result').last();
    await expect(result).toBeVisible({ timeout: 300_000 });
    await expect(result).toHaveAttribute('data-failed', '0');
    await expect(result).toHaveAttribute('data-done', '3');
    // every applied step reports a verified outcome
    await expect(plan.locator('[data-type="trimStart"][data-outcome="done"]')).toBeVisible();
    await expect(plan.locator('[data-type="blurFaces"][data-outcome="done"]')).toBeVisible();
    // the edit really changed the document: duration dropped by ~1s and a mask exists
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:03:00');
    await page.getByTestId('tool-tab-privacy').click();
    await expect(page.getByTestId('mask-item').first()).toBeVisible();
  });

  test('gates an operation that needs a missing model with an honest reason instead of pretending', async ({ page }) => {
    test.setTimeout(180_000);
    await projectWithClip(page, 'E2E assistant gate', 'clip-10s-720p.mp4');
    await page.locator('[data-action="app.assistant"]').click();
    await page.getByTestId('assistant-input').fill('أضف ترجمة عربية');
    await page.getByTestId('assistant-send').click();
    const plan = page.getByTestId('assistant-plan').last();
    await expect(plan.locator('[data-type="generateSubtitles"]')).toBeVisible({ timeout: 30_000 });
    await expect(plan.locator('[data-type="generateSubtitles"][data-feasible="false"]')).toBeVisible();
    // no apply button when nothing can run; the reason is shown
    await expect(plan.getByTestId('plan-blocked')).toBeVisible();
    await expect(plan.getByTestId('plan-apply')).toHaveCount(0);
  });

  test('answers a clarifying question before running an ambiguous request', async ({ page }) => {
    test.setTimeout(180_000);
    await projectWithClip(page, 'E2E assistant clarify', 'clip-10s-720p.mp4');
    await page.locator('[data-action="app.assistant"]').click();
    await page.getByTestId('assistant-input').fill('خلي الفيديو 4 ثواني');
    await page.getByTestId('assistant-send').click();
    let plan = page.getByTestId('assistant-plan').last();
    await expect(plan.getByTestId('assistant-clarify')).toBeVisible({ timeout: 30_000 });
    await expect(plan.getByTestId('plan-apply')).toHaveCount(0);
    // choosing an option produces a runnable plan
    await plan.getByTestId('clarify-option').first().click();
    plan = page.getByTestId('assistant-plan').last();
    await expect(plan.getByTestId('plan-apply')).toBeVisible({ timeout: 30_000 });
    await plan.getByTestId('plan-apply').click();
    await expect(page.getByTestId('assistant-result').last()).toHaveAttribute('data-done', '1', { timeout: 120_000 });
    await expect(page.getByTestId('timecode')).toContainText('/ 00:00:04:00');
  });
});
