import { test, expect } from '@playwright/test';

test.describe('Dashboards', () => {
  test('Logs dashboard renders and displays logs', async ({ page }) => {
    // Mock the logs API response
    await page.route('**/api/admin/telemetry/logs*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          summary: { totalLogs: 2, errorLogs: 1 },
          logs: [
            { 
              logId: '1', 
              severity: 'INFO', 
              loggerName: 'test-logger', 
              message: 'Database query successful', 
              occurredAt: new Date().toISOString() 
            },
            { 
              logId: '2', 
              severity: 'ERROR', 
              loggerName: 'test-logger', 
              message: 'Connection timeout', 
              occurredAt: new Date().toISOString() 
            }
          ]
        })
      });
    });

    await page.goto('/#logs');
    
    // Verify tabs are available
    await expect(page.locator('button', { hasText: 'Logs' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'AI Calls' })).toBeVisible();
    
    // Verify mock data rendered
    await expect(page.locator('text=Database query successful')).toBeVisible();
    await expect(page.locator('text=Connection timeout')).toBeVisible();
    await expect(page.locator('text=ERROR')).toBeVisible();
  });

  test('AI Calls dashboard renders and displays AI stats', async ({ page }) => {
    // Mock the AI calls API response
    await page.route('**/api/admin/telemetry/ai*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          summary: { 
            totalCalls: 42, 
            totalCostUsd: 0.154, 
            totalPromptTokens: 100, 
            totalCompletionTokens: 50, 
            errorCalls: 1 
          },
          calls: [
            { 
              callId: '1', 
              callType: 'chat', 
              modelName: 'gpt-4o', 
              provider: 'openai', 
              isError: false, 
              requestJson: 'Summarize this log', 
              responseJson: 'The log indicates a connection timeout', 
              occurredAt: new Date().toISOString() 
            }
          ]
        })
      });
    });

    await page.goto('/#ai');
    
    // Check overview cards
    await expect(page.locator('text=Total Calls')).toBeVisible();
    await expect(page.locator('text=42').first()).toBeVisible();
    await expect(page.locator('text=$0.1540')).toBeVisible();
    
    // Check call row
    await expect(page.locator('text=gpt-4o')).toBeVisible();
    await expect(page.locator('text=openai')).toBeVisible();
    await expect(page.locator('text=Summarize this log')).toBeVisible();
    await expect(page.locator('text=The log indicates a connection timeout')).toBeVisible();
  });
});
