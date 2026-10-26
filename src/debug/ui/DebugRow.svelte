<script lang="ts">
  import { TONE_COLORS, type Tone } from '../thresholds'

  interface Props {
    label: string
    value: string | number
    /**
     * The color of the value. `accent` marks a debug override, and `muted` a
     * value still at its default.
     */
    tone?: Tone | 'accent' | 'muted'
  }

  let { label, value, tone = 'neutral' }: Props = $props()

  const color = $derived(
    tone === 'accent' || tone === 'muted' ? undefined : TONE_COLORS[tone],
  )
</script>

<div class="info-row">
  <span class="label">{label}:</span>
  <span
    class="value"
    class:accent={tone === 'accent'}
    class:muted={tone === 'muted'}
    style:color
  >
    {value}
  </span>
</div>
