// @vitest-environment jsdom
import * as React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TagEditor } from '@/components/tag-editor'
import type { SubscriptionTag } from '@/types/tags'

function renderEditor(
  initial: SubscriptionTag[],
  extra?: { showVisibilityToggle?: boolean }
) {
  const onChange = vi.fn()
  const utils = render(
    <TagEditor
      tags={initial}
      onChange={onChange}
      showVisibilityToggle={extra?.showVisibilityToggle}
    />
  )
  return { ...utils, onChange }
}

describe('TagEditor — default (showVisibilityToggle unspecified == true)', () => {
  it('renders the add-row visibility toggle button', () => {
    renderEditor([])
    expect(
      screen.queryByRole('button', { name: /toggle tag visibility/i })
    ).not.toBeNull()
  })

  it('renders the per-chip visibility toggle for existing tags', () => {
    renderEditor([{ label: 'Family', visibility: 'public' }])
    expect(
      screen.queryByRole('button', { name: /toggle visibility for family/i })
    ).not.toBeNull()
  })

  it('add-row defaults to private — emits private when user types + Enters', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor([])
    const input = screen.getByPlaceholderText(/e.g./i)
    await user.type(input, 'Visa 1234{Enter}')
    expect(onChange).toHaveBeenCalledWith([
      { label: 'Visa 1234', visibility: 'private' },
    ])
  })

  it('toggling add-row visibility flips emitted tag to public', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor([])
    await user.click(
      screen.getByRole('button', { name: /toggle tag visibility/i })
    )
    const input = screen.getByPlaceholderText(/e.g./i)
    await user.type(input, 'Family{Enter}')
    expect(onChange).toHaveBeenCalledWith([
      { label: 'Family', visibility: 'public' },
    ])
  })
})

describe('TagEditor — showVisibilityToggle=false', () => {
  it('does not render the add-row visibility toggle button', () => {
    renderEditor([], { showVisibilityToggle: false })
    expect(
      screen.queryByRole('button', { name: /toggle tag visibility/i })
    ).toBeNull()
  })

  it('does not render per-chip visibility toggles', () => {
    renderEditor(
      [
        { label: 'Family', visibility: 'public' },
        { label: 'Visa', visibility: 'private' },
      ],
      { showVisibilityToggle: false }
    )
    expect(
      screen.queryByRole('button', { name: /toggle visibility for family/i })
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: /toggle visibility for visa/i })
    ).toBeNull()
  })

  it('emits private tags on add (no way to produce public)', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor([], { showVisibilityToggle: false })
    const input = screen.getByPlaceholderText(/e.g./i)
    await user.type(input, 'Visa 1234{Enter}')
    expect(onChange).toHaveBeenCalledWith([
      { label: 'Visa 1234', visibility: 'private' },
    ])
  })

  it('remove button still works (X button) — core CRUD unaffected', () => {
    const { onChange } = renderEditor(
      [
        { label: 'Family', visibility: 'private' },
        { label: 'Visa', visibility: 'private' },
      ],
      { showVisibilityToggle: false }
    )
    const removeBtn = screen.getByRole('button', { name: /remove family/i })
    fireEvent.click(removeBtn)
    expect(onChange).toHaveBeenCalledWith([
      { label: 'Visa', visibility: 'private' },
    ])
  })
})

describe('TagEditor — prop flipped mid-session (draftVisibility staleness)', () => {
  /**
   * Regression guard: in the new-sub form, a user can
   *   1. pick Shared mode   — visibility toggle appears
   *   2. toggle draft to Public
   *   3. switch to Personal mode — toggle disappears, BUT the internal
   *      draftVisibility state is still 'public'
   *   4. type a label and submit
   * The emitted tag must be 'private' regardless of stale draft state,
   * because the user has no way to observe/change the hidden toggle.
   */
  function ControlledEditor({
    initialShow,
  }: {
    initialShow: boolean
  }) {
    const [show, setShow] = React.useState(initialShow)
    const [tags, setTags] = React.useState<SubscriptionTag[]>([])
    return (
      <>
        <button type="button" onClick={() => setShow(false)}>
          hide-toggle
        </button>
        <TagEditor
          tags={tags}
          onChange={setTags}
          showVisibilityToggle={show}
        />
        <output data-testid="latest">{JSON.stringify(tags)}</output>
      </>
    )
  }

  it("flipping showVisibilityToggle from true to false after user set public forces private on next add", async () => {
    const user = userEvent.setup()
    render(<ControlledEditor initialShow={true} />)

    // Step 1: user is in shared mode, flips draft visibility to public
    await user.click(
      screen.getByRole('button', { name: /toggle tag visibility/i })
    )

    // Step 2: host flips showVisibilityToggle to false (simulating mode
    // switch on the new-sub page)
    await user.click(screen.getByRole('button', { name: /hide-toggle/i }))

    // Step 3: user types a label and hits Enter. Must come out private.
    const input = screen.getByPlaceholderText(/e.g./i)
    await user.type(input, 'Visa 1234{Enter}')

    const latest = JSON.parse(
      screen.getByTestId('latest').textContent ?? '[]'
    )
    expect(latest).toEqual([{ label: 'Visa 1234', visibility: 'private' }])
  })
})
