<script lang="ts">
  import { diagnostics, type Diagnostic } from '../../diagnostics/Diagnostics'
  import {
    DebugSection,
    DebugSelect,
    Pill,
    type DebugSelectOption,
    type Tone,
  } from '../ui'

  interface Props {
    /** Bumped by the HUD's rAF poll. The list is re-read on each bump. */
    revision: number
  }

  const { revision }: Props = $props()

  type Filter = 'all' | 'error' | 'warn'
  const FILTERS: readonly DebugSelectOption<Filter>[] = [
    { value: 'all', label: 'All' },
    { value: 'warn', label: 'Warnings and errors' },
    { value: 'error', label: 'Errors' },
  ]
  const TONES: Record<Diagnostic['level'], Tone> = {
    error: 'bad',
    warn: 'warn',
    info: 'neutral',
    debug: 'neutral',
  }
  const SHOWN = 50

  let filter = $state<Filter>('all')
  let listOpen = $state(true)

  // The diagnostics list is not reactive, so each HUD tick re-reads it.
  const items = $derived.by(() => {
    void revision
    const all = [...diagnostics.recent].reverse()
    const kept =
      filter === 'all'
        ? all
        : all.filter((d) =>
            filter === 'error' ? d.level === 'error' : d.level !== 'info',
          )
    return kept.slice(0, SHOWN)
  })
  const errors = $derived(items.filter((d) => d.level === 'error').length)

  function clear(): void {
    diagnostics.clear()
  }
</script>

<DebugSection title="Recent" bind:open={listOpen}>
  <div class="debug-controls">
    <DebugSelect
      label="Show"
      value={filter}
      options={FILTERS}
      onChange={(next) => (filter = next)}
    />
    <button class="debug-btn" type="button" onclick={clear}>Clear</button>
  </div>
  {#if items.length === 0}
    <div class="empty-state">Nothing has been reported.</div>
  {:else}
    <div class="summary">
      {items.length} shown{errors > 0 ? `, ${errors} errors` : ''}
    </div>
    <ul class="items">
      {#each items as d (d.time + d.code + d.message)}
        <li class="item" title={d.message}>
          <div class="head">
            <Pill text={d.level} tone={TONES[d.level]} />
            <span class="code">{d.code}</span>
            <span class="area">{d.area}{d.node ? `, ${d.node}` : ''}</span>
            {#if d.count > 1}<span class="count">×{d.count}</span>{/if}
          </div>
          <div class="message">{d.message}</div>
        </li>
      {/each}
    </ul>
  {/if}
</DebugSection>

<style lang="sass">
  .summary
    color: rgba(255, 255, 255, 0.6)
  .items
    list-style: none
    margin: 0
    padding: 0
    display: flex
    flex-direction: column
    gap: 6px
  .item
    padding: 4px 6px
    border-radius: 3px
    background: rgba(255, 255, 255, 0.05)
  .head
    display: flex
    align-items: center
    gap: 6px
  .code
    font-weight: 700
  .area, .count
    color: rgba(255, 255, 255, 0.6)
  .message
    margin-top: 2px
    white-space: pre-wrap
    word-break: break-word
    max-height: 4.2em
    overflow: hidden
</style>
