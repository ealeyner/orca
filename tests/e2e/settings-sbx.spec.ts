import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test('sandbox access settings persist through the native settings boundary', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.openSettingsTarget({ pane: 'agents', repoId: null })
    state.openSettingsPage()
  })
  const pane = orcaPage.getByRole('region', { name: 'Docker Sandboxes' })
  await expect(pane).toBeVisible()
  const toggle = pane.getByRole('switch', { name: 'Start agents in Docker Sandboxes' })
  if ((await toggle.getAttribute('aria-checked')) !== 'true') {
    await toggle.click()
  }
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await pane.getByText('Agent access defaults', { exact: true }).click()
  await pane
    .getByLabel('Blocked network hosts', { exact: true })
    .fill('blocked.example.com, *.private.example.com')
  await pane.getByLabel('CPUs', { exact: true }).fill('2')
  await pane.getByRole('button', { name: 'Save agent access' }).click()
  await expect(pane.getByRole('button', { name: 'Save agent access' })).toBeEnabled()
  await orcaPage.evaluate(async () => {
    window.__store!.setState({ settings: await window.api.settings.get() })
    window.__store!.getState().openSettingsTarget({ pane: 'general', repoId: null })
  })
  await orcaPage.evaluate(() =>
    window.__store!.getState().openSettingsTarget({ pane: 'agents', repoId: null })
  )
  await pane.getByText('Agent access defaults', { exact: true }).click()
  await expect(pane.getByLabel('Blocked network hosts', { exact: true })).toHaveValue(
    'blocked.example.com, *.private.example.com'
  )
  await expect(pane.getByLabel('CPUs', { exact: true })).toHaveValue('2')
  await orcaPage.screenshot({ path: '/tmp/orca-sbx-settings.png' })
})
