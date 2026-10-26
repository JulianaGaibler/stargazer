<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    title: string
    /** Whether the section is expanded. Can be bound. */
    open?: boolean
    /** Limits the body to 300 px and scrolls it. */
    maxHeight?: boolean
    /** Content shown next to the title. */
    summary?: Snippet
    children: Snippet
  }

  let {
    title,
    open = $bindable(false),
    maxHeight = false,
    summary,
    children,
  }: Props = $props()
</script>

<details bind:open>
  <summary>
    {title}
    {#if summary}
      {@render summary()}
    {/if}
  </summary>
  <div class="panel-content" class:max-height-300={maxHeight}>
    {@render children()}
  </div>
</details>
