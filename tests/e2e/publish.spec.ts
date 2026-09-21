import { expect, test } from '@playwright/test';

test.describe('publish', () => {
  test('formats a project for a platform and builds a validated package', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('/');
    await page.locator('[data-action="home.newProject"]').click();
    await page.getByTestId('project-name-input').fill('E2E publish');
    await page.getByTestId('project-platform-select').selectOption('youtube');
    await page.locator('[data-action="projects.create.submit"]').click();
    await expect(page.getByTestId('editor')).toBeVisible();

    // Import a clip and add it to the timeline.
    await page.locator('[data-action="editor.import"]').click();
    await page.locator('[data-action="fileBrowser.root"]', { hasText: 'sample-media' }).click();
    await page.locator('[data-action="fileBrowser.toggleFile"]', { hasText: 'clip-10s-720p.mp4' }).click();
    await page.locator('[data-action="fileBrowser.select"]').click();
    const video = page.getByTestId('media-panel-item').filter({ hasText: 'clip-10s-720p.mp4' });
    await expect(video.locator('[data-action="editor.addAsset"]')).toBeEnabled({ timeout: 60_000 });
    await video.locator('[data-action="editor.addAsset"]').click();
    await expect(page.getByTestId('editor-clip-count')).toContainText('1');

    // Publish: the targets show a fit plan for the 16:9 project.
    await page.goto('/#/publish');
    await expect(page.getByTestId('publish-targets')).toBeVisible();
    const tiktok = page.locator('[data-action="publish.toggle"][data-target="tiktok"]');
    await expect(tiktok).toContainText('9:16');

    // Select TikTok, add caption + hashtags, and build a package.
    await tiktok.click();
    await expect(tiktok).toHaveAttribute('data-selected', 'true');
    await page.getByTestId('publish-caption').fill('My trip');
    await page.getByTestId('publish-hashtags').fill('#travel travel #sunset');
    await page.getByTestId('publish-build').click();

    const row = page.getByTestId('publish-row').first();
    await expect(row).toHaveAttribute('data-status', 'done', { timeout: 180_000 });
    await expect(row).toContainText('1080×1920'); // reframed to the vertical canvas
    await expect(page.getByTestId('publish-validation').first().locator('li.text-danger')).toHaveCount(0);
  });
});
