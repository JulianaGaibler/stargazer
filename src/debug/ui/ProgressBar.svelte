<script lang="ts">
  interface Props {
    /** From 0 to 100. Values outside the range are clamped. */
    percentage: number
    /** A CSS color. */
    color?: string
    /** Height in CSS px. */
    height?: number
  }

  let { percentage, color = '#60a5fa', height = 8 }: Props = $props()

  const clamped = $derived(Math.max(0, Math.min(100, percentage)))
</script>

<div class="progress-bar" style:height="{height}px">
  <div
    class="progress-fill"
    style:width="{clamped}%"
    style:background={color}
  ></div>
</div>

<style lang="sass">
  .progress-bar
    position: relative
    width: 100%
    background: rgba(255, 255, 255, 0.1)
    border-radius: 4px
    overflow: hidden

  .progress-fill
    position: absolute
    top: 0
    left: 0
    height: 100%
    border-radius: 4px
    transition: width 0.05s linear
</style>
