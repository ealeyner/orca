import { chmodSync, copyFileSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady, waitForActiveWorktree, ensureTerminalVisible } from './helpers/store'
import { getTerminalContent, focusActiveTerminalInput } from './helpers/terminal'

const fixtureDir = mkdtempSync(join(tmpdir(), 'orca-sbx-fixture-'))
const binary = join(fixtureDir, 'sbx')
copyFileSync(resolve('tests/e2e/helpers/sbx-fixture.cjs'), binary)
chmodSync(binary, 0o755)
test.use({
  launchEnv: { ORCA_SBX_BINARY: binary, ORCA_SBX_FIXTURE_STATE: join(fixtureDir, 'state.json') }
})
test.afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }))
test.skip(process.platform === 'win32', 'The executable fixture uses a POSIX shebang.')

test('agent launch provisions a sandbox through native IPC and surfaces it in the IDE', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await orcaPage.evaluate(async () => {
    await window.__store!.getState().updateSettings({
      sbx: { enabled: true },
      experimentalNativeChat: true,
      experimentalStructuredNativeChat: false,
      openAgentTabsInChatByDefault: true,
      agentDefaultArgs: { claude: '' }
    })
  })
  await ensureTerminalVisible(orcaPage)
  await orcaPage.getByRole('button', { name: 'New tab' }).click({ force: true })
  await orcaPage
    .getByRole('menuitem', { name: /^Claude(?:\s|$)/i })
    .first()
    .click({ force: true })
  await expect
    .poll(() => {
      try {
        return JSON.parse(readFileSync(join(fixtureDir, 'state.json'), 'utf8'))[0]?.status
      } catch {
        return null
      }
    })
    .toBe('running')
  await expect(orcaPage.getByPlaceholder('Send a message…', { exact: true })).not.toBeVisible()
  await focusActiveTerminalInput(orcaPage)
  await orcaPage.keyboard.press('Enter')
  await expect
    .poll(
      async () => (await getTerminalContent(orcaPage)).includes('SBX_AGENT_READY orca-claude-'),
      { timeout: 30_000 }
    )
    .toBe(true)
  await orcaPage.evaluate(() => {
    window.__store!.getState().openSettingsTarget({ pane: 'agents', repoId: null })
    window.__store!.getState().openSettingsPage()
  })
  const pane = orcaPage.getByRole('region', { name: 'Docker Sandboxes' })
  await expect(pane.getByText('claude · Orca agent sandbox')).toBeVisible()
  await expect(pane.getByText('running', { exact: true })).toBeVisible()
  await pane.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(pane.getByText('stopped', { exact: true })).toBeVisible()
  await pane.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(pane.getByText('running', { exact: true })).toBeVisible()
  await pane.getByRole('button', { name: 'Shell', exact: true }).click()
  await expect(pane).not.toBeVisible()
  await expect
    .poll(async () => (await getTerminalContent(orcaPage)).includes('SBX_SHELL_READY'), {
      timeout: 30_000
    })
    .toBe(true)
  await orcaPage.evaluate(() => {
    window.__store!.getState().openSettingsTarget({ pane: 'agents', repoId: null })
    window.__store!.getState().openSettingsPage()
  })
  await expect(pane.getByText('claude · Orca agent sandbox')).toBeVisible()
  await orcaPage.screenshot({ path: '/tmp/orca-sbx-inventory.png', animations: 'disabled' })
  await pane.getByRole('button', { name: 'Remove…', exact: true }).click()
  const confirmation = orcaPage.getByRole('dialog')
  await expect(confirmation).toBeVisible()
  const stateFile = join(fixtureDir, 'state.json')
  const rows = JSON.parse(readFileSync(stateFile, 'utf8'))
  rows[0].id = 'replacement-id'
  writeFileSync(stateFile, JSON.stringify(rows))
  await expect(orcaPage.getByText('claude · Existing sandbox', { exact: true })).toBeVisible({
    timeout: 15_000
  })
  await confirmation.getByRole('button', { name: 'Remove sandbox', exact: true }).click()
  await expect(pane.getByRole('alert')).toContainText('Sandbox identity changed')
  expect(JSON.parse(readFileSync(stateFile, 'utf8'))).toHaveLength(1)
  await pane.getByRole('button', { name: 'Remove…', exact: true }).click()
  await confirmation.getByRole('button', { name: 'Remove sandbox', exact: true }).click()
  await expect(pane.getByText('claude · Existing sandbox')).not.toBeVisible()
})
