import { expect, test } from '@playwright/test';

test.describe('external providers', () => {
  test('lists providers, gates cloud ones on consent, and configures one', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/#/settings/providers');
    await expect(page.getByTestId('providers-settings')).toBeVisible();
    // the three built-in providers are listed
    await expect(page.getByTestId('provider-card')).toHaveCount(3);
    const openai = page.locator('[data-provider="openai-compatible"]');
    await expect(openai).toHaveAttribute('data-configured', 'false');

    // a cloud provider cannot be enabled until external processing is allowed
    await expect(openai.locator('[data-action="providers.enable"]')).toBeDisabled();
    await page.locator('[data-action="providers.allowExternal"]').click();
    await expect(openai.locator('[data-action="providers.enable"]')).toBeEnabled();

    // configure it (no real call — just persistence + capability gating)
    await openai.locator('[data-action="providers.enable"]').click();
    await openai.getByTestId('provider-baseurl').fill('https://api.example.com/v1');
    await openai.getByTestId('provider-model').fill('test-model');
    await openai.getByTestId('provider-secret').fill('sk-e2e-key');
    await openai.getByTestId('provider-save').click();
    await expect(openai).toHaveAttribute('data-configured', 'true', { timeout: 15_000 });

    // reloading keeps it configured and never re-shows the secret
    await page.goto('/#/settings/general');
    await page.goto('/#/settings/providers');
    const openai2 = page.locator('[data-provider="openai-compatible"]');
    await expect(openai2).toHaveAttribute('data-configured', 'true');
    await expect(openai2.getByTestId('provider-secret')).toHaveValue('');
  });
});
