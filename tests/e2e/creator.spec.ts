import { expect, test } from '@playwright/test';

test.describe('AI Video Creator', () => {
  test('takes an idea to a scripted, storyboarded animatic assembled onto the editor timeline', async ({ page }) => {
    test.setTimeout(300_000);
    // create a project, then open the Creator for it
    await page.goto('/');
    await page.locator('[data-action="home.newProject"]').click();
    await page.getByTestId('project-name-input').fill('E2E creator');
    await page.getByTestId('project-platform-select').selectOption('tiktok');
    await page.locator('[data-action="projects.create.submit"]').click();
    await expect(page).toHaveURL(/#\/editor\//);
    const projectId = page.url().split('/editor/')[1]!;
    await page.goto(`/#/creator/${projectId}`);
    await expect(page.getByTestId('creator-screen')).toBeVisible();

    // the honest animatic banner is shown (no generation model installed)
    await expect(page.getByTestId('creator-mode-banner')).toBeVisible();

    // brief → script
    await page.getByTestId('creator-idea').fill('قهوة الصباح تمنحك طاقة. جودة عالية وسعر مناسب. زُر متجرنا اليوم.');
    await page.getByTestId('creator-duration').fill('9');
    await page.getByTestId('creator-build').click();
    await expect(page.getByTestId('creator-script')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('creator-scene').first()).toBeVisible();
    const sceneCount = await page.getByTestId('creator-scene').count();
    expect(sceneCount).toBeGreaterThanOrEqual(3);

    // produce: render the storyboard and see real card thumbnails
    await page.getByTestId('creator-stage-produce').click();
    await page.getByTestId('creator-storyboard').click();
    await expect(page.getByTestId('scene-thumb').first()).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('scene-card').first()).toHaveAttribute('data-status', /storyboard|voiced|assembled/);

    // assemble the animatic → lands in the editor with clips and subtitles
    await page.getByTestId('creator-assemble').click();
    await expect(page).toHaveURL(/#\/editor\//, { timeout: 180_000 });
    await expect(page.getByTestId('editor-clip-count')).not.toContainText('0');

    // the Creator marked every scene assembled
    await page.goto(`/#/creator/${projectId}`);
    await page.getByTestId('creator-stage-produce').click();
    await expect(page.getByTestId('scene-card').first()).toHaveAttribute('data-status', 'assembled', { timeout: 30_000 });

    // review reports no errors on the assembled project
    await page.getByTestId('creator-stage-review').click();
    await expect(page.getByTestId('creator-review')).toBeVisible();
    await expect(page.locator('[data-testid="review-issue"][data-severity="error"]')).toHaveCount(0);
  });
});
