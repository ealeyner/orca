import { chmodSync, copyFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady, waitForActiveWorktree, ensureTerminalVisible } from './helpers/store'

const fixtureDir = mkdtempSync(join(tmpdir(), 'orca-sbx-native-fixture-'))
const binary = join(fixtureDir, 'sbx')
const stateFile = join(fixtureDir, 'state.json')
copyFileSync(resolve('tests/e2e/helpers/sbx-fixture.cjs'), binary)
copyFileSync(
  resolve('tests/e2e/helpers/sbx-native-codex-fixture.cjs'),
  join(fixtureDir, 'sbx-native-codex-fixture.cjs')
)
chmodSync(binary, 0o755)
test.use({ launchEnv: { ORCA_SBX_BINARY: binary, ORCA_SBX_FIXTURE_STATE: stateFile } })
test.afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }))
test.skip(process.platform === 'win32', 'The executable fixture uses a POSIX shebang.')

test('native chat provisions and talks through a managed sandbox', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await orcaPage.evaluate(async () => {
    await window.__store!.getState().updateSettings({
      experimentalNativeChat: true,
      experimentalStructuredNativeChat: true,
      openAgentTabsInChatByDefault: true,
      sbx: { enabled: true },
      agentDefaultArgs: { codex: '' }
    })
  })
  await orcaPage.getByRole('button', { name: 'New tab' }).click({ force: true })
  await orcaPage
    .getByRole('menuitem', { name: /^Codex(?:\s|$)/i })
    .first()
    .click({ force: true })
  const composer = orcaPage.getByPlaceholder('Send a message…', { exact: true })
  await expect(composer).toBeEditable({ timeout: 30_000 })
  await composer.fill('Verify sandbox native chat')
  await composer.press('Enter')
  await expect(
    orcaPage.getByText('This reply came from the sandbox transport.', { exact: true })
  ).toBeVisible({ timeout: 30_000 })
  await expect(orcaPage.getByText('Verify sandbox native chat', { exact: true })).toBeVisible()
  const rows = JSON.parse(readFileSync(stateFile, 'utf8'))
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ agent: 'codex', status: 'running' })
  await orcaPage.screenshot({ path: '/tmp/orca-sbx-native-chat.png', animations: 'disabled' })
  await orcaPage.evaluate(() => {
    window.__store!.getState().openSettingsTarget({ pane: 'agents', repoId: null })
    window.__store!.getState().openSettingsPage()
  })
  const pane = orcaPage.getByRole('region', { name: 'Docker Sandboxes' })
  await expect(pane.getByText('codex · Orca agent sandbox')).toBeVisible()
})
