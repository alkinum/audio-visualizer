<script lang="ts">
  import { FileAudio2, Upload } from '@lucide/svelte';

  interface Props {
    onSelect: (file: File) => void;
    busy?: boolean;
    compact?: boolean;
  }

  let { onSelect, busy = false, compact = false }: Props = $props();
  let input: HTMLInputElement;
  let dragging = $state(false);

  function selectFiles(files: FileList | null): void {
    const file = files?.item(0);
    if (file) onSelect(file);
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    dragging = false;
    if (!busy) selectFiles(event.dataTransfer?.files ?? null);
  }

  function openPicker(): void {
    if (!busy) input.click();
  }
</script>

<input
  bind:this={input}
  class="visually-hidden"
  type="file"
  accept="audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.opus"
  onchange={(event) => selectFiles(event.currentTarget.files)}
/>

<button
  class:compact
  class:dragging
  class="file-drop"
  type="button"
  disabled={busy}
  onclick={openPicker}
  ondragenter={(event) => {
    event.preventDefault();
    dragging = true;
  }}
  ondragover={(event) => {
    event.preventDefault();
    dragging = true;
  }}
  ondragleave={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dragging = false;
  }}
  ondrop={handleDrop}
>
  <span class="file-drop-icon" aria-hidden="true">
    {#if busy}
      <FileAudio2 size={compact ? 17 : 25} strokeWidth={1.7} />
    {:else}
      <Upload size={compact ? 17 : 25} strokeWidth={1.7} />
    {/if}
  </span>
  <span class="file-drop-copy">
    <strong>{busy ? 'Decoding audio' : compact ? 'Replace file' : 'Open an audio file'}</strong>
    {#if !compact}
      <small>{busy ? 'Reading waveform data locally' : 'Drop a file here or choose from this device'}</small>
    {/if}
  </span>
  {#if busy}
    <span class="file-drop-progress" aria-hidden="true"></span>
  {/if}
</button>
